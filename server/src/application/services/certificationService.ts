import { randomUUID } from "node:crypto";
import { pool } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

// Real template selection (process-specific with a tenant-wide fallback —
// never "the first row in the table"), a real validity policy, and idempotent
// issuance (UNIQUE on qualification_case_id — a second call for the same
// case returns the existing certificate rather than creating a duplicate).
// Rendering the actual PDF/QR artifact and computing its checksum happens in
// the worker process (see workers/certificateRenderer.ts) — issuance here is
// synchronous and authoritative, rendering is async and retryable.
export async function issueCertificate(qualificationCaseId: string, currentUser: CurrentUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const qcase = await client.query(
      `SELECT qc.*, w.company_id AS worker_company_id FROM qualification_case qc JOIN worker w ON w.worker_id = qc.worker_id WHERE qc.qualification_case_id = $1 FOR UPDATE`,
      [qualificationCaseId]
    );
    if (!qcase.rows[0]) throw new ApiError(404, "Qualification case not found");
    if (currentUser.companyId && currentUser.companyId !== qcase.rows[0].company_id) throw new ApiError(403, "Cross-company access is not permitted");
    if (qcase.rows[0].status !== "APPROVED") throw new ApiError(422, `Cannot certify from status ${qcase.rows[0].status}`);

    const existing = await client.query(`SELECT * FROM certificate WHERE qualification_case_id = $1`, [qualificationCaseId]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0]; // idempotent — already issued
    }

    const template = await client.query(
      `SELECT certificate_template_id FROM certificate_template
       WHERE company_id = $1 AND certificate_type = 'COMPETENCY_CARD' AND is_active AND (process_id = $2 OR process_id IS NULL)
       ORDER BY process_id NULLS LAST LIMIT 1`,
      [qcase.rows[0].company_id, qcase.rows[0].process_id]
    );
    if (!template.rows[0]) throw new ApiError(422, "No active certificate template configured for this company/process");

    const policy = await client.query(
      `SELECT validity_months FROM certificate_policy WHERE company_id = $1 AND certificate_type = 'COMPETENCY_CARD' AND (process_id = $2 OR process_id IS NULL)
       ORDER BY process_id NULLS LAST LIMIT 1`,
      [qcase.rows[0].company_id, qcase.rows[0].process_id]
    );
    const validityMonths = policy.rows[0]?.validity_months ?? 24;

    const result = await client.query(`SELECT * FROM qualification_result WHERE qualification_case_id = $1 ORDER BY decided_at DESC LIMIT 1`, [qualificationCaseId]);
    const primaryLevel = await client.query(`SELECT primary_level_id FROM process_level WHERE process_level_id = $1`, [qcase.rows[0].target_process_level_id]);

    const certNumber = `CWE-CERT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const cert = await client.query(
      `INSERT INTO certificate (
         assessment_outcome_id, worker_id, process_id, skill_level_id, certificate_template_id, certificate_type,
         certificate_number, qr_verification_token, valid_from, valid_to, status,
         qualification_case_id, previous_process_level_id, certified_process_level_id, primary_level_id,
         approver_user_id, weighted_score_pct
       ) VALUES (
         NULL, $1, $2, NULL, $3, 'COMPETENCY_CARD',
         $4, $5, CURRENT_DATE, CURRENT_DATE + ($6 || ' months')::interval, 'active',
         $7, $8, $9, $10, $11, $12
       ) RETURNING *`,
      [
        qcase.rows[0].worker_id, qcase.rows[0].process_id, template.rows[0].certificate_template_id,
        certNumber, randomUUID().replace(/-/g, ""), validityMonths,
        qualificationCaseId, qcase.rows[0].from_process_level_id, qcase.rows[0].target_process_level_id, primaryLevel.rows[0]?.primary_level_id ?? null,
        currentUser.userId, result.rows[0]?.weighted_score_pct ?? null,
      ]
    );

    await client.query(`UPDATE qualification_case SET status = 'CERTIFIED', updated_at = now() WHERE qualification_case_id = $1`, [qualificationCaseId]);
    await recordAudit(client, { entityName: "certificate", entityId: cert.rows[0].certificate_id, action: "INSERT", actorUserId: currentUser.userId, after: cert.rows[0] });
    await recordAudit(client, { entityName: "qualification_case", entityId: qualificationCaseId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { status: "CERTIFIED" } });

    await client.query("COMMIT");
    return cert.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeCertificate(certificateId: string, reason: string, currentUser: CurrentUser) {
  if (!reason) throw new ApiError(400, "A revocation reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cert = await client.query(`SELECT * FROM certificate WHERE certificate_id = $1 FOR UPDATE`, [certificateId]);
    if (!cert.rows[0]) throw new ApiError(404, "Certificate not found");
    await client.query(`UPDATE certificate SET status = 'revoked', revoked_reason = $1 WHERE certificate_id = $2`, [reason, certificateId]);
    await recordAudit(client, { entityName: "certificate", entityId: certificateId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { status: cert.rows[0].status }, after: { status: "revoked" }, reason });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function effectiveCertificateStatus(cert: { status: string; valid_to: string | null }): "active" | "expired" | "revoked" {
  if (cert.status === "revoked") return "revoked";
  if (cert.valid_to && new Date(cert.valid_to) < new Date()) return "expired";
  return "active";
}

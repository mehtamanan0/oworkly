// Per-worker process_sub_level progress. Sign-off is a supervisory act: a
// worker's own EMPLOYEE self-token can never mark their sub-levels complete
// (mirrors the spec rule that self-assessment never advances a worker). The
// mandatory-sub-level completeness summary here is what
// qualificationCaseService.finalizeAttempt gates on.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

// Roles allowed to sign off sub-level progress. EMPLOYEE (worker self-token)
// is deliberately absent.
const SIGN_OFF_ROLES = ["SUPERVISOR", "ASSESSOR", "TRAINER", "HOD", "LND_TEAM", "ADMIN"];
const STATUSES = ["not_started", "in_progress", "completed"];

export async function markProgress(
  workerId: string,
  subLevelId: string,
  body: { status?: string; percentComplete?: number; notes?: string; evidenceFileId?: string | null },
  currentUser: CurrentUser
) {
  if (!currentUser.roles.some((r) => SIGN_OFF_ROLES.includes(r))) {
    throw new ApiError(403, "Only a Supervisor, Trainer, Assessor or HOD may sign off sub-level progress");
  }

  const worker = await queryOne<{ company_id: string }>(`SELECT company_id FROM worker WHERE worker_id = $1`, [workerId]);
  if (!worker) throw new ApiError(404, "Worker not found");
  if (currentUser.companyId && currentUser.companyId !== worker.company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }

  const subLevel = await queryOne<any>(
    `SELECT psl.process_sub_level_id, pl.company_id AS level_company_id
     FROM process_sub_level psl JOIN process_level pl ON pl.process_level_id = psl.process_level_id
     WHERE psl.process_sub_level_id = $1 AND psl.is_active`,
    [subLevelId]
  );
  if (!subLevel) throw new ApiError(404, "Sub-level not found");
  if (currentUser.companyId && currentUser.companyId !== subLevel.level_company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }

  const status = body.status ?? "completed";
  if (!STATUSES.includes(status)) throw new ApiError(422, `status must be one of ${STATUSES.join(", ")}`);
  const percent = status === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(Number(body.percentComplete ?? 0))));
  const completedAt = status === "completed" ? new Date() : null;

  const row = await queryOne<any>(
    `INSERT INTO worker_process_sub_level_progress
       (worker_id, process_sub_level_id, status, percent_complete, completed_at, signed_off_by_user_id, evidence_file_id, notes, updated_at)
     VALUES ($1,$2,$3::varchar,$4,$5,$6,$7,$8, now())
     ON CONFLICT (worker_id, process_sub_level_id) DO UPDATE SET
       status = EXCLUDED.status,
       percent_complete = EXCLUDED.percent_complete,
       completed_at = EXCLUDED.completed_at,
       signed_off_by_user_id = EXCLUDED.signed_off_by_user_id,
       evidence_file_id = EXCLUDED.evidence_file_id,
       notes = EXCLUDED.notes,
       updated_at = now()
     RETURNING *`,
    [workerId, subLevelId, status, percent, completedAt, currentUser.userId, body.evidenceFileId ?? null, body.notes ?? null]
  );
  await recordAudit(pool, {
    entityName: "worker_process_sub_level_progress", entityId: row.worker_process_sub_level_progress_id,
    action: "UPDATE", actorUserId: currentUser.userId, after: row,
  });
  return row;
}

export async function listProgress(workerId: string, currentUser: CurrentUser) {
  const worker = await queryOne<{ company_id: string }>(`SELECT company_id FROM worker WHERE worker_id = $1`, [workerId]);
  if (!worker) throw new ApiError(404, "Worker not found");
  if (currentUser.companyId && currentUser.companyId !== worker.company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
  return query(
    `SELECT wpslp.*, psl.code AS sub_level_code, psl.name AS sub_level_name,
            psl.process_level_id, psl.is_mandatory, psl.weight_pct, psl.min_score_pct,
            u.display_name AS signed_off_by_name
     FROM worker_process_sub_level_progress wpslp
     JOIN process_sub_level psl ON psl.process_sub_level_id = wpslp.process_sub_level_id
     LEFT JOIN app_user u ON u.user_id = wpslp.signed_off_by_user_id
     WHERE wpslp.worker_id = $1
     ORDER BY psl.process_level_id, psl.sequence`,
    [workerId]
  );
}

// Used by qualificationCaseService.finalizeAttempt to gate on sub-level
// completion. `db` accepts the pool or an in-transaction PoolClient.
export async function mandatorySubLevelStatus(
  db: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  workerId: string,
  processLevelId: string
) {
  const res = await db.query(
    `SELECT psl.process_sub_level_id, psl.code, psl.name,
            COALESCE(wpslp.status, 'not_started') AS status
     FROM process_sub_level psl
     LEFT JOIN worker_process_sub_level_progress wpslp
       ON wpslp.process_sub_level_id = psl.process_sub_level_id AND wpslp.worker_id = $2
     WHERE psl.process_level_id = $1 AND psl.is_active AND psl.is_mandatory`,
    [processLevelId, workerId]
  );
  const incomplete = res.rows.filter((r: any) => r.status !== "completed");
  return { total: res.rows.length, completed: res.rows.length - incomplete.length, incomplete };
}

import type { PoolClient } from "pg";
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

// Called atomically with the PASS decision (from qualificationCaseService),
// inside the same transaction — the approval chain always exists the moment a
// case becomes PENDING_APPROVAL, never as a separate step that could be
// skipped.
export async function initiateApproval(client: PoolClient, qualificationCaseId: string) {
  const qcase = await client.query(`SELECT process_id, company_id FROM qualification_case WHERE qualification_case_id = $1`, [qualificationCaseId]);
  const policy = await client.query(
    `SELECT approval_policy_id FROM approval_policy WHERE company_id = $1 AND (process_id = $2 OR process_id IS NULL) AND is_active
     ORDER BY process_id NULLS LAST LIMIT 1`,
    [qcase.rows[0].company_id, qcase.rows[0].process_id]
  );
  if (!policy.rows[0]) throw new ApiError(422, "No approval policy configured for this process/company");
  const instance = await client.query(
    `INSERT INTO qualification_approval_instance (qualification_case_id, approval_policy_id) VALUES ($1,$2) RETURNING *`,
    [qualificationCaseId, policy.rows[0].approval_policy_id]
  );
  return instance.rows[0];
}

export async function getApprovalStatus(qualificationCaseId: string) {
  const instance = await queryOne<any>(
    `SELECT * FROM qualification_approval_instance WHERE qualification_case_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [qualificationCaseId]
  );
  if (!instance) return null;
  const stages = await query<any>(
    `SELECT aps.*, r.role_name,
            qaa.action, qaa.remarks, qaa.acted_at, qaa.resolved_approver_user_id,
            u.display_name AS approver_display_name
     FROM approval_policy_stage aps
     JOIN role r ON r.role_id = aps.role_id
     LEFT JOIN qualification_approval_action qaa ON qaa.qualification_approval_instance_id = $1 AND qaa.approval_policy_stage_id = aps.approval_policy_stage_id
     LEFT JOIN app_user u ON u.user_id = qaa.resolved_approver_user_id
     WHERE aps.approval_policy_id = $2 ORDER BY aps.sequence_no`,
    [instance.qualification_approval_instance_id, instance.approval_policy_id]
  );
  return { instance, stages };
}

export async function actOnApproval(qualificationCaseId: string, stageSequence: number, action: "approved" | "returned", currentUser: CurrentUser, remarks: string | undefined, idempotencyKey: string | undefined) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const qcase = await client.query(`SELECT * FROM qualification_case WHERE qualification_case_id = $1 FOR UPDATE`, [qualificationCaseId]);
    if (!qcase.rows[0]) throw new ApiError(404, "Qualification case not found");
    if (currentUser.companyId && currentUser.companyId !== qcase.rows[0].company_id) throw new ApiError(403, "Cross-company access is not permitted");
    if (!["PENDING_APPROVAL", "RETURNED_FOR_REVIEW"].includes(qcase.rows[0].status)) {
      throw new ApiError(422, `Cannot act on approval from status ${qcase.rows[0].status}`);
    }

    const instance = await client.query(
      `SELECT * FROM qualification_approval_instance WHERE qualification_case_id = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [qualificationCaseId]
    );
    if (!instance.rows[0]) throw new ApiError(422, "No in-progress approval instance for this case");

    const stage = await client.query(
      `SELECT aps.*, r.role_code FROM approval_policy_stage aps JOIN role r ON r.role_id = aps.role_id
       WHERE aps.approval_policy_id = $1 AND aps.sequence_no = $2`,
      [instance.rows[0].approval_policy_id, stageSequence]
    );
    if (!stage.rows[0]) throw new ApiError(404, "Approval stage not found");
    if (!currentUser.roles.includes(stage.rows[0].role_code)) {
      throw new ApiError(403, `Requires role ${stage.rows[0].role_code} to act on this stage`);
    }
    if (currentUser.workerId && currentUser.workerId === qcase.rows[0].worker_id) {
      throw new ApiError(403, "Self-approval is not permitted");
    }

    // Sequential ordering: every earlier required stage must already be approved.
    const priorStages = await client.query(
      `SELECT aps.sequence_no, aps.is_required, qaa.action FROM approval_policy_stage aps
       LEFT JOIN qualification_approval_action qaa ON qaa.qualification_approval_instance_id = $1 AND qaa.approval_policy_stage_id = aps.approval_policy_stage_id
       WHERE aps.approval_policy_id = $2 AND aps.sequence_no < $3`,
      [instance.rows[0].qualification_approval_instance_id, instance.rows[0].approval_policy_id, stageSequence]
    );
    const unmet = priorStages.rows.find((p) => p.is_required && p.action !== "approved");
    if (unmet) throw new ApiError(422, `Stage ${unmet.sequence_no} must be approved first`);

    // Idempotent: acting again on an already-resolved stage with the same key
    // (or at all) just returns the existing action rather than erroring.
    const existingAction = await client.query(
      `SELECT * FROM qualification_approval_action WHERE qualification_approval_instance_id = $1 AND approval_policy_stage_id = $2`,
      [instance.rows[0].qualification_approval_instance_id, stage.rows[0].approval_policy_stage_id]
    );
    if (existingAction.rows[0]) {
      await client.query("COMMIT");
      return existingAction.rows[0];
    }

    const actionRow = await client.query(
      `INSERT INTO qualification_approval_action (qualification_approval_instance_id, approval_policy_stage_id, resolved_approver_user_id, action, remarks, acted_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,now(),$6) RETURNING *`,
      [instance.rows[0].qualification_approval_instance_id, stage.rows[0].approval_policy_stage_id, currentUser.userId, action, remarks ?? null, idempotencyKey ?? null]
    );
    await recordAudit(client, { entityName: "qualification_approval_action", entityId: actionRow.rows[0].qualification_approval_action_id, action: "INSERT", actorUserId: currentUser.userId, after: actionRow.rows[0] });

    if (action === "returned") {
      await client.query(`UPDATE qualification_approval_instance SET status = 'returned', completed_at = now() WHERE qualification_approval_instance_id = $1`, [instance.rows[0].qualification_approval_instance_id]);
      await client.query(`UPDATE qualification_case SET status = 'RETURNED_FOR_REVIEW', updated_at = now() WHERE qualification_case_id = $1`, [qualificationCaseId]);
      await recordAudit(client, { entityName: "qualification_case", entityId: qualificationCaseId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { status: "RETURNED_FOR_REVIEW" } });
    } else {
      const allStages = await client.query(`SELECT count(*) AS cnt FROM approval_policy_stage WHERE approval_policy_id = $1 AND is_required`, [instance.rows[0].approval_policy_id]);
      const approvedCount = await client.query(
        `SELECT count(*) AS cnt FROM qualification_approval_action WHERE qualification_approval_instance_id = $1 AND action = 'approved'`,
        [instance.rows[0].qualification_approval_instance_id]
      );
      if (Number(approvedCount.rows[0].cnt) >= Number(allStages.rows[0].cnt)) {
        await client.query(`UPDATE qualification_approval_instance SET status = 'approved', completed_at = now() WHERE qualification_approval_instance_id = $1`, [instance.rows[0].qualification_approval_instance_id]);
        await client.query(`UPDATE qualification_case SET status = 'APPROVED', updated_at = now() WHERE qualification_case_id = $1`, [qualificationCaseId]);
        await recordAudit(client, { entityName: "qualification_case", entityId: qualificationCaseId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { status: "APPROVED" } });
      }
    }

    await client.query("COMMIT");
    return actionRow.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// M9: configurable self-assessment visibility. A company configures what a
// worker/supervisor/trainer/admin can see about a self-assessment result,
// scoped to a company-wide default or narrowed to one process / process
// level / assessment template. resolvePolicy() is the single place every
// enforcement point (checkItem, finalizeAttempt, the result-viewing routes)
// consults -- most-specific-match-wins, falling back to a hard-locked-down
// default when a company hasn't configured anything at all.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const RELEASE_POLICIES = ["ON_SUBMISSION", "AFTER_SUPERVISOR_REVIEW", "NEVER"] as const;
type ReleasePolicy = (typeof RELEASE_POLICIES)[number];

export interface ResolvedVisibilityPolicy {
  policyId: string | null;
  name: string;
  answersVisibleToWorker: boolean;
  answersVisibleToSupervisor: boolean;
  answersVisibleToTrainer: boolean;
  answersVisibleToAdmin: boolean;
  showCorrectAnswersToWorker: boolean;
  showScoreToWorker: boolean;
  showFeedbackToWorker: boolean;
  releasePolicy: ReleasePolicy;
  isDefault: boolean;
}

const HARD_DEFAULT: ResolvedVisibilityPolicy = {
  policyId: null,
  name: "System default (locked down)",
  answersVisibleToWorker: false,
  answersVisibleToSupervisor: true,
  answersVisibleToTrainer: true,
  answersVisibleToAdmin: true,
  showCorrectAnswersToWorker: false,
  showScoreToWorker: true,
  showFeedbackToWorker: false,
  releasePolicy: "ON_SUBMISSION",
  isDefault: true,
};

function toResolved(row: any): ResolvedVisibilityPolicy {
  return {
    policyId: row.self_assessment_visibility_policy_id,
    name: row.name,
    answersVisibleToWorker: row.answers_visible_to_worker,
    answersVisibleToSupervisor: row.answers_visible_to_supervisor,
    answersVisibleToTrainer: row.answers_visible_to_trainer,
    answersVisibleToAdmin: row.answers_visible_to_admin,
    showCorrectAnswersToWorker: row.show_correct_answers_to_worker,
    showScoreToWorker: row.show_score_to_worker,
    showFeedbackToWorker: row.show_feedback_to_worker,
    releasePolicy: row.release_policy,
    isDefault: false,
  };
}

export async function resolvePolicy(
  companyId: string,
  ctx: { processId?: string | null; processLevelId?: string | null; assessmentTemplateId?: string | null }
): Promise<ResolvedVisibilityPolicy> {
  if (ctx.assessmentTemplateId) {
    const row = await queryOne<any>(
      `SELECT * FROM self_assessment_visibility_policy WHERE company_id = $1 AND assessment_template_id = $2 AND is_active`,
      [companyId, ctx.assessmentTemplateId]
    );
    if (row) return toResolved(row);
  }
  if (ctx.processLevelId) {
    const row = await queryOne<any>(
      `SELECT * FROM self_assessment_visibility_policy WHERE company_id = $1 AND process_level_id = $2 AND is_active`,
      [companyId, ctx.processLevelId]
    );
    if (row) return toResolved(row);
  }
  if (ctx.processId) {
    const row = await queryOne<any>(
      `SELECT * FROM self_assessment_visibility_policy WHERE company_id = $1 AND process_id = $2 AND is_active`,
      [companyId, ctx.processId]
    );
    if (row) return toResolved(row);
  }
  const fallback = await queryOne<any>(
    `SELECT * FROM self_assessment_visibility_policy
     WHERE company_id = $1 AND process_id IS NULL AND process_level_id IS NULL AND assessment_template_id IS NULL AND is_active`,
    [companyId]
  );
  if (fallback) return toResolved(fallback);
  return HARD_DEFAULT;
}

function assertCompanyScope(currentUser: CurrentUser, companyId: string) {
  if (currentUser.companyId && currentUser.companyId !== companyId) throw new ApiError(403, "Cross-company access is not permitted");
}

export async function listPolicies(companyId: string, currentUser: CurrentUser, includeInactive = false) {
  assertCompanyScope(currentUser, companyId);
  return query<any>(
    `SELECT sp.*, p.name AS process_name, pl.name AS process_level_name, tpl.process_level_id AS template_process_level_id, tpl_level.name AS template_level_name
     FROM self_assessment_visibility_policy sp
     LEFT JOIN process p ON p.process_id = sp.process_id
     LEFT JOIN process_level pl ON pl.process_level_id = sp.process_level_id
     LEFT JOIN assessment_template tpl ON tpl.assessment_template_id = sp.assessment_template_id
     LEFT JOIN process_level tpl_level ON tpl_level.process_level_id = tpl.process_level_id
     WHERE sp.company_id = $1 ${includeInactive ? "" : "AND sp.is_active"}
     ORDER BY sp.created_at DESC`,
    [companyId]
  );
}

async function loadPolicy(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM self_assessment_visibility_policy WHERE self_assessment_visibility_policy_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Policy not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

async function validateScope(companyId: string, body: { processId?: string; processLevelId?: string; assessmentTemplateId?: string }) {
  const narrowing = [body.processId, body.processLevelId, body.assessmentTemplateId].filter((v) => v != null);
  if (narrowing.length > 1) throw new ApiError(422, "A policy can narrow to only one of process, process level, or assessment template");
  if (body.processId) {
    const row = await queryOne<{ company_id: string }>(`SELECT company_id FROM process WHERE process_id = $1`, [body.processId]);
    if (!row || row.company_id !== companyId) throw new ApiError(422, "Unknown processId for this company");
  }
  if (body.processLevelId) {
    const row = await queryOne<{ company_id: string }>(`SELECT company_id FROM process_level WHERE process_level_id = $1`, [body.processLevelId]);
    if (!row || row.company_id !== companyId) throw new ApiError(422, "Unknown processLevelId for this company");
  }
  if (body.assessmentTemplateId) {
    const row = await queryOne<{ company_id: string }>(`SELECT company_id FROM assessment_template WHERE assessment_template_id = $1`, [body.assessmentTemplateId]);
    if (!row || row.company_id !== companyId) throw new ApiError(422, "Unknown assessmentTemplateId for this company");
  }
}

interface PolicyBody {
  name?: string;
  processId?: string;
  processLevelId?: string;
  assessmentTemplateId?: string;
  answersVisibleToWorker?: boolean;
  answersVisibleToSupervisor?: boolean;
  answersVisibleToTrainer?: boolean;
  answersVisibleToAdmin?: boolean;
  showCorrectAnswersToWorker?: boolean;
  showScoreToWorker?: boolean;
  showFeedbackToWorker?: boolean;
  releasePolicy?: string;
}

export async function createPolicy(companyId: string, body: PolicyBody, currentUser: CurrentUser) {
  assertCompanyScope(currentUser, companyId);
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const releasePolicy = body.releasePolicy ?? "ON_SUBMISSION";
  if (!RELEASE_POLICIES.includes(releasePolicy as ReleasePolicy)) throw new ApiError(422, `releasePolicy must be one of ${RELEASE_POLICIES.join(", ")}`);
  await validateScope(companyId, body);
  try {
    const row = await queryOne<any>(
      `INSERT INTO self_assessment_visibility_policy
        (company_id, process_id, process_level_id, assessment_template_id, name,
         answers_visible_to_worker, answers_visible_to_supervisor, answers_visible_to_trainer, answers_visible_to_admin,
         show_correct_answers_to_worker, show_score_to_worker, show_feedback_to_worker, release_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        companyId, body.processId ?? null, body.processLevelId ?? null, body.assessmentTemplateId ?? null, name,
        !!body.answersVisibleToWorker, body.answersVisibleToSupervisor !== false, body.answersVisibleToTrainer !== false, body.answersVisibleToAdmin !== false,
        !!body.showCorrectAnswersToWorker, body.showScoreToWorker !== false, !!body.showFeedbackToWorker, releasePolicy,
      ]
    );
    await recordAudit(pool, { entityName: "self_assessment_visibility_policy", entityId: row.self_assessment_visibility_policy_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, "An active policy already exists for this scope");
    throw e;
  }
}

export async function updatePolicy(id: string, body: PolicyBody, currentUser: CurrentUser) {
  const before = await loadPolicy(id, currentUser);
  const releasePolicy = body.releasePolicy ?? before.release_policy;
  if (!RELEASE_POLICIES.includes(releasePolicy as ReleasePolicy)) throw new ApiError(422, `releasePolicy must be one of ${RELEASE_POLICIES.join(", ")}`);
  const row = await queryOne<any>(
    `UPDATE self_assessment_visibility_policy SET
       name = $1, answers_visible_to_worker = $2, answers_visible_to_supervisor = $3, answers_visible_to_trainer = $4, answers_visible_to_admin = $5,
       show_correct_answers_to_worker = $6, show_score_to_worker = $7, show_feedback_to_worker = $8, release_policy = $9
     WHERE self_assessment_visibility_policy_id = $10 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() || before.name : before.name,
      body.answersVisibleToWorker != null ? !!body.answersVisibleToWorker : before.answers_visible_to_worker,
      body.answersVisibleToSupervisor != null ? !!body.answersVisibleToSupervisor : before.answers_visible_to_supervisor,
      body.answersVisibleToTrainer != null ? !!body.answersVisibleToTrainer : before.answers_visible_to_trainer,
      body.answersVisibleToAdmin != null ? !!body.answersVisibleToAdmin : before.answers_visible_to_admin,
      body.showCorrectAnswersToWorker != null ? !!body.showCorrectAnswersToWorker : before.show_correct_answers_to_worker,
      body.showScoreToWorker != null ? !!body.showScoreToWorker : before.show_score_to_worker,
      body.showFeedbackToWorker != null ? !!body.showFeedbackToWorker : before.show_feedback_to_worker,
      releasePolicy,
      id,
    ]
  );
  await recordAudit(pool, { entityName: "self_assessment_visibility_policy", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function archivePolicy(id: string, currentUser: CurrentUser) {
  const before = await loadPolicy(id, currentUser);
  const row = await queryOne<any>(`UPDATE self_assessment_visibility_policy SET is_active = FALSE WHERE self_assessment_visibility_policy_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "self_assessment_visibility_policy", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: false } });
  return row;
}

export async function restorePolicy(id: string, currentUser: CurrentUser) {
  const before = await loadPolicy(id, currentUser);
  try {
    const row = await queryOne<any>(`UPDATE self_assessment_visibility_policy SET is_active = TRUE WHERE self_assessment_visibility_policy_id = $1 RETURNING *`, [id]);
    await recordAudit(pool, { entityName: "self_assessment_visibility_policy", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: true } });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, "An active policy already exists for this scope — archive it first");
    throw e;
  }
}

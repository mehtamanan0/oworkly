// CRUD for the level-configuration pieces added in migration 0014:
// process_level_criterion rows and the scoring/gating attributes on
// process_sub_level. Every mutation is company-scoped (resolved from the
// parent process_level) and audited. Sub-level weights are validated so the
// active sub-levels of one level never sum past 100%.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const CATEGORIES = ["KNOWLEDGE", "PRACTICAL", "BEHAVIOUR", "EXPERIENCE"];

interface ScopedLevel {
  process_level_id: string;
  company_id: string;
  process_id: string;
}

async function loadLevelScoped(processLevelId: string, currentUser: CurrentUser): Promise<ScopedLevel> {
  const level = await queryOne<ScopedLevel>(
    `SELECT process_level_id, company_id, process_id FROM process_level WHERE process_level_id = $1`,
    [processLevelId]
  );
  if (!level) throw new ApiError(404, "Process level not found");
  if (currentUser.companyId && currentUser.companyId !== level.company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
  return level;
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------
export async function listCriteria(processLevelId: string, currentUser: CurrentUser) {
  await loadLevelScoped(processLevelId, currentUser);
  return query(
    `SELECT * FROM process_level_criterion
     WHERE process_level_id = $1 AND is_active
     ORDER BY category, sequence, created_at`,
    [processLevelId]
  );
}

export async function createCriterion(
  processLevelId: string,
  body: { category?: string; text?: string; sequence?: number },
  currentUser: CurrentUser
) {
  const level = await loadLevelScoped(processLevelId, currentUser);
  const category = String(body.category ?? "").toUpperCase();
  if (!CATEGORIES.includes(category)) throw new ApiError(422, `category must be one of ${CATEGORIES.join(", ")}`);
  const text = String(body.text ?? "").trim();
  if (!text) throw new ApiError(422, "text is required");
  const row = await queryOne<any>(
    `INSERT INTO process_level_criterion (company_id, process_level_id, category, text, sequence)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [level.company_id, processLevelId, category, text, Number(body.sequence ?? 1)]
  );
  await recordAudit(pool, {
    entityName: "process_level_criterion", entityId: row.process_level_criterion_id,
    action: "INSERT", actorUserId: currentUser.userId, after: row,
  });
  return row;
}

async function loadCriterionScoped(criterionId: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM process_level_criterion WHERE process_level_criterion_id = $1`, [criterionId]);
  if (!row) throw new ApiError(404, "Criterion not found");
  if (currentUser.companyId && currentUser.companyId !== row.company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
  return row;
}

export async function updateCriterion(
  criterionId: string,
  body: { category?: string; text?: string; sequence?: number },
  currentUser: CurrentUser
) {
  const before = await loadCriterionScoped(criterionId, currentUser);
  const category = body.category != null ? String(body.category).toUpperCase() : before.category;
  if (!CATEGORIES.includes(category)) throw new ApiError(422, `category must be one of ${CATEGORIES.join(", ")}`);
  const text = body.text != null ? String(body.text).trim() : before.text;
  if (!text) throw new ApiError(422, "text is required");
  const row = await queryOne<any>(
    `UPDATE process_level_criterion SET category = $1, text = $2, sequence = $3
     WHERE process_level_criterion_id = $4 RETURNING *`,
    [category, text, Number(body.sequence ?? before.sequence), criterionId]
  );
  await recordAudit(pool, {
    entityName: "process_level_criterion", entityId: criterionId,
    action: "UPDATE", actorUserId: currentUser.userId, before, after: row,
  });
  return row;
}

export async function deleteCriterion(criterionId: string, currentUser: CurrentUser) {
  const before = await loadCriterionScoped(criterionId, currentUser);
  await query(`UPDATE process_level_criterion SET is_active = FALSE WHERE process_level_criterion_id = $1`, [criterionId]);
  await recordAudit(pool, {
    entityName: "process_level_criterion", entityId: criterionId,
    action: "DELETE", actorUserId: currentUser.userId, before,
  });
  return { status: "deleted" };
}

// ---------------------------------------------------------------------------
// Sub-levels
// ---------------------------------------------------------------------------
export async function listSubLevels(processLevelId: string, currentUser: CurrentUser) {
  await loadLevelScoped(processLevelId, currentUser);
  return query(
    `SELECT * FROM process_sub_level
     WHERE process_level_id = $1 AND is_active
     ORDER BY sequence, code`,
    [processLevelId]
  );
}

async function assertWeightSum(processLevelId: string, addWeight: number, excludeSubLevelId?: string) {
  const rows = await query<{ weight_pct: string }>(
    `SELECT weight_pct FROM process_sub_level
     WHERE process_level_id = $1 AND is_active ${excludeSubLevelId ? "AND process_sub_level_id <> $2" : ""}`,
    excludeSubLevelId ? [processLevelId, excludeSubLevelId] : [processLevelId]
  );
  const existing = rows.reduce((sum, r) => sum + Number(r.weight_pct ?? 0), 0);
  if (existing + addWeight > 100.0001) {
    throw new ApiError(422, `Sub-level weights for this level would sum to ${(existing + addWeight).toFixed(2)}% (max 100%)`);
  }
}

export async function createSubLevel(
  processLevelId: string,
  body: { code?: string; name?: string; description?: string; sequence?: number; requiredCriteria?: string; minScorePct?: number; weightPct?: number; isMandatory?: boolean },
  currentUser: CurrentUser
) {
  const level = await loadLevelScoped(processLevelId, currentUser);
  const code = String(body.code ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!code) throw new ApiError(422, "code is required");
  if (!name) throw new ApiError(422, "name is required");
  const weightPct = Number(body.weightPct ?? 0);
  if (!Number.isFinite(weightPct) || weightPct < 0 || weightPct > 100) throw new ApiError(422, "weightPct must be between 0 and 100");
  await assertWeightSum(processLevelId, weightPct);
  const nextSeq = body.sequence ?? (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence),0) + 1 AS n FROM process_sub_level WHERE process_level_id = $1`, [processLevelId]
  ))?.n ?? 1;
  const row = await queryOne<any>(
    `INSERT INTO process_sub_level (company_id, process_level_id, code, name, description, sequence, required_criteria, min_score_pct, weight_pct, is_mandatory)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      level.company_id, processLevelId, code, name, body.description ?? null, Number(nextSeq),
      body.requiredCriteria ?? null,
      body.minScorePct != null ? Number(body.minScorePct) : null,
      weightPct,
      body.isMandatory ?? true,
    ]
  );
  await recordAudit(pool, {
    entityName: "process_sub_level", entityId: row.process_sub_level_id,
    action: "INSERT", actorUserId: currentUser.userId, after: row,
  });
  return row;
}

async function loadSubLevelScoped(subLevelId: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT psl.*, pl.company_id AS level_company_id
     FROM process_sub_level psl JOIN process_level pl ON pl.process_level_id = psl.process_level_id
     WHERE psl.process_sub_level_id = $1`,
    [subLevelId]
  );
  if (!row) throw new ApiError(404, "Sub-level not found");
  if (currentUser.companyId && currentUser.companyId !== row.level_company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
  return row;
}

export async function updateSubLevel(
  subLevelId: string,
  body: { code?: string; name?: string; description?: string; sequence?: number; requiredCriteria?: string; minScorePct?: number | null; weightPct?: number; isMandatory?: boolean },
  currentUser: CurrentUser
) {
  const before = await loadSubLevelScoped(subLevelId, currentUser);
  const weightPct = body.weightPct != null ? Number(body.weightPct) : Number(before.weight_pct);
  if (!Number.isFinite(weightPct) || weightPct < 0 || weightPct > 100) throw new ApiError(422, "weightPct must be between 0 and 100");
  if (body.weightPct != null) await assertWeightSum(before.process_level_id, weightPct, subLevelId);
  const row = await queryOne<any>(
    `UPDATE process_sub_level SET
       code = $1, name = $2, description = $3, sequence = $4, required_criteria = $5,
       min_score_pct = $6, weight_pct = $7, is_mandatory = $8
     WHERE process_sub_level_id = $9 RETURNING *`,
    [
      body.code != null ? String(body.code).trim() : before.code,
      body.name != null ? String(body.name).trim() : before.name,
      body.description !== undefined ? body.description : before.description,
      Number(body.sequence ?? before.sequence),
      body.requiredCriteria !== undefined ? body.requiredCriteria : before.required_criteria,
      body.minScorePct !== undefined ? (body.minScorePct != null ? Number(body.minScorePct) : null) : before.min_score_pct,
      weightPct,
      body.isMandatory ?? before.is_mandatory,
      subLevelId,
    ]
  );
  await recordAudit(pool, {
    entityName: "process_sub_level", entityId: subLevelId,
    action: "UPDATE", actorUserId: currentUser.userId, before, after: row,
  });
  return row;
}

export async function deleteSubLevel(subLevelId: string, currentUser: CurrentUser) {
  const before = await loadSubLevelScoped(subLevelId, currentUser);
  await query(`UPDATE process_sub_level SET is_active = FALSE WHERE process_sub_level_id = $1`, [subLevelId]);
  await recordAudit(pool, {
    entityName: "process_sub_level", entityId: subLevelId,
    action: "DELETE", actorUserId: currentUser.userId, before,
  });
  return { status: "deleted" };
}

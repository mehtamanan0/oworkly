// Process + process-level authoring, and the generic level-progression-rule
// CRUD. Mirrors processConfigService.ts's scoped-load/validate/audit pattern.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const RULE_TYPES = ["MIN_TENURE_MONTHS", "REQUIRED_PRIOR_LEVEL", "CUSTOM"];

function assertCompanyScope(currentUser: CurrentUser, companyId: string) {
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}

// ===========================================================================
// Process
// ===========================================================================
export async function createProcess(
  companyId: string,
  body: { orgUnitId?: string; code?: string; name?: string; description?: string; isCritical?: boolean },
  currentUser: CurrentUser
) {
  assertCompanyScope(currentUser, companyId);
  const orgUnitId = String(body.orgUnitId ?? "");
  if (!orgUnitId) throw new ApiError(422, "orgUnitId is required");
  const orgUnit = await queryOne<{ company_id: string }>(`SELECT company_id FROM org_unit WHERE org_unit_id = $1 AND is_active`, [orgUnitId]);
  if (!orgUnit) throw new ApiError(422, "Unknown or archived orgUnitId");
  if (orgUnit.company_id !== companyId) throw new ApiError(422, "orgUnitId belongs to a different company");
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw new ApiError(422, "code is required");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let process;
    try {
      process = await client.query(
        `INSERT INTO process (org_unit_id, company_id, code, name, is_critical) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [orgUnitId, companyId, code, name, body.isCritical ?? false]
      );
    } catch (e: any) {
      if (e?.code === "23505") throw new ApiError(409, `Process code "${code}" already exists in this org unit`);
      throw e;
    }
    const processId = process.rows[0].process_id;
    // Every new process starts with two configurable levels — editable
    // immediately after, never hardcoded into the qualification engine.
    const defaults = [
      { code: "E1", name: "Entry", ordinal: 1, minScorePct: 65 },
      { code: "E2", name: "Skilled", ordinal: 2, minScorePct: 70 },
    ];
    const levels = [];
    for (const d of defaults) {
      const lvl = await client.query(
        `INSERT INTO process_level (company_id, process_id, code, name, ordinal, min_qualification_score_pct)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [companyId, processId, d.code, d.name, d.ordinal, d.minScorePct]
      );
      levels.push(lvl.rows[0]);
    }
    await client.query("COMMIT");
    await recordAudit(pool, { entityName: "process", entityId: processId, action: "INSERT", actorUserId: currentUser.userId, after: { ...process.rows[0], defaultLevels: levels } });
    return { ...process.rows[0], levels };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function loadProcess(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM process WHERE process_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Process not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

export async function updateProcess(id: string, body: { name?: string; description?: string; isCritical?: boolean }, currentUser: CurrentUser) {
  const before = await loadProcess(id, currentUser);
  const row = await queryOne<any>(
    `UPDATE process SET name = $1, is_critical = $2 WHERE process_id = $3 RETURNING *`,
    [body.name != null ? String(body.name).trim() || before.name : before.name, body.isCritical ?? before.is_critical, id]
  );
  await recordAudit(pool, { entityName: "process", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function archiveProcess(id: string, currentUser: CurrentUser) {
  const before = await loadProcess(id, currentUser);
  const openCases = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM qualification_case WHERE process_id = $1 AND status NOT IN ('CERTIFIED','CANCELLED','EXPIRED')`,
    [id]
  );
  if (Number(openCases?.n ?? 0) > 0) throw new ApiError(409, `${openCases!.n} qualification case(s) still in progress for this process`);
  const row = await queryOne<any>(`UPDATE process SET is_active = FALSE WHERE process_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "process", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: false } });
  return row;
}

// ===========================================================================
// Process levels
// ===========================================================================
export async function createProcessLevel(
  processId: string,
  body: { code?: string; name?: string; description?: string; ordinal?: number; minQualificationScorePct?: number; budgetedHeadcount?: number; selfAssessmentEnabled?: boolean },
  currentUser: CurrentUser
) {
  const process = await loadProcess(processId, currentUser);
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw new ApiError(422, "code is required");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const nextOrdinal = body.ordinal ?? (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM process_level WHERE process_id = $1`, [processId]
  ))?.n ?? 1;
  try {
    const row = await queryOne<any>(
      `INSERT INTO process_level (company_id, process_id, code, name, description, ordinal, min_qualification_score_pct, budgeted_headcount, self_assessment_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [process.company_id, processId, code, name, body.description ?? null, Number(nextOrdinal), body.minQualificationScorePct ?? null, body.budgetedHeadcount ?? null, body.selfAssessmentEnabled ?? false]
    );
    await recordAudit(pool, { entityName: "process_level", entityId: row.process_level_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, `Level code "${code}" already exists on this process`);
    throw e;
  }
}

async function loadProcessLevel(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM process_level WHERE process_level_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Process level not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

export async function updateProcessLevel(
  id: string,
  body: { name?: string; description?: string; minQualificationScorePct?: number | null; budgetedHeadcount?: number | null; selfAssessmentEnabled?: boolean },
  currentUser: CurrentUser
) {
  const before = await loadProcessLevel(id, currentUser);
  const row = await queryOne<any>(
    `UPDATE process_level SET name = $1, description = $2, min_qualification_score_pct = $3, budgeted_headcount = $4, self_assessment_enabled = $5
     WHERE process_level_id = $6 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() || before.name : before.name,
      body.description !== undefined ? body.description : before.description,
      body.minQualificationScorePct !== undefined ? body.minQualificationScorePct : before.min_qualification_score_pct,
      body.budgetedHeadcount !== undefined ? body.budgetedHeadcount : before.budgeted_headcount,
      body.selfAssessmentEnabled ?? before.self_assessment_enabled,
      id,
    ]
  );
  await recordAudit(pool, { entityName: "process_level", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function archiveProcessLevel(id: string, currentUser: CurrentUser) {
  const before = await loadProcessLevel(id, currentUser);
  const linkedTemplate = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM assessment_template WHERE process_level_id = $1 AND is_active`, [id]);
  if (Number(linkedTemplate?.n ?? 0) > 0) throw new ApiError(409, "An active assessment template is still linked to this level — deactivate it first");
  const referenced = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM worker_process_enrollment WHERE current_process_level_id = $1 OR target_process_level_id = $1`,
    [id]
  );
  if (Number(referenced?.n ?? 0) > 0) throw new ApiError(409, `${referenced!.n} worker enrollment(s) still reference this level`);
  const row = await queryOne<any>(`UPDATE process_level SET is_active = FALSE WHERE process_level_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "process_level", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: false } });
  return row;
}

export async function restoreProcessLevel(id: string, currentUser: CurrentUser) {
  const before = await loadProcessLevel(id, currentUser);
  const row = await queryOne<any>(`UPDATE process_level SET is_active = TRUE WHERE process_level_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "process_level", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: true } });
  return row;
}

// ===========================================================================
// Level progression rules
// ===========================================================================
function validateRuleParams(ruleType: string, severity: string, params: any) {
  if (!RULE_TYPES.includes(ruleType)) throw new ApiError(422, `ruleType must be one of ${RULE_TYPES.join(", ")}`);
  if (!["BLOCKING", "ADVISORY"].includes(severity)) throw new ApiError(422, "severity must be BLOCKING or ADVISORY");
  if (ruleType === "CUSTOM" && severity !== "ADVISORY") {
    throw new ApiError(422, "A CUSTOM rule is never automatically evaluated, so it cannot be BLOCKING");
  }
  if (ruleType === "MIN_TENURE_MONTHS") {
    const months = Number(params?.months);
    if (!Number.isFinite(months) || months <= 0) throw new ApiError(422, "MIN_TENURE_MONTHS requires params.months > 0");
  }
  if (ruleType === "REQUIRED_PRIOR_LEVEL") {
    if (!params?.requiredProcessLevelId) throw new ApiError(422, "REQUIRED_PRIOR_LEVEL requires params.requiredProcessLevelId");
  }
}

export async function listProgressionRules(processLevelId: string, currentUser: CurrentUser) {
  await loadProcessLevel(processLevelId, currentUser);
  return query<any>(
    `SELECT * FROM process_level_progression_rule WHERE process_level_id = $1 AND is_active ORDER BY sequence, created_at`,
    [processLevelId]
  );
}

export async function createProgressionRule(
  processLevelId: string,
  body: { ruleType?: string; label?: string; params?: unknown; severity?: string; sequence?: number },
  currentUser: CurrentUser
) {
  const level = await loadProcessLevel(processLevelId, currentUser);
  const ruleType = String(body.ruleType ?? "");
  const severity = body.severity ?? "BLOCKING";
  const params = body.params ?? {};
  validateRuleParams(ruleType, severity, params);
  const label = String(body.label ?? "").trim();
  if (!label) throw new ApiError(422, "label is required");
  const nextSeq = body.sequence ?? (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM process_level_progression_rule WHERE process_level_id = $1`, [processLevelId]
  ))?.n ?? 1;
  const row = await queryOne<any>(
    `INSERT INTO process_level_progression_rule (company_id, process_level_id, rule_type, label, params_json, severity, sequence)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [level.company_id, processLevelId, ruleType, label, JSON.stringify(params), severity, Number(nextSeq)]
  );
  await recordAudit(pool, { entityName: "process_level_progression_rule", entityId: row.process_level_progression_rule_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

async function loadRule(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM process_level_progression_rule WHERE process_level_progression_rule_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Progression rule not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

export async function updateProgressionRule(
  id: string,
  body: { label?: string; params?: unknown; severity?: string; sequence?: number },
  currentUser: CurrentUser
) {
  const before = await loadRule(id, currentUser);
  const severity = body.severity ?? before.severity;
  const params = body.params !== undefined ? body.params : before.params_json;
  validateRuleParams(before.rule_type, severity, params);
  const row = await queryOne<any>(
    `UPDATE process_level_progression_rule SET label = $1, params_json = $2, severity = $3, sequence = $4 WHERE process_level_progression_rule_id = $5 RETURNING *`,
    [body.label != null ? String(body.label).trim() || before.label : before.label, JSON.stringify(params), severity, Number(body.sequence ?? before.sequence), id]
  );
  await recordAudit(pool, { entityName: "process_level_progression_rule", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function deleteProgressionRule(id: string, currentUser: CurrentUser) {
  const before = await loadRule(id, currentUser);
  await query(`UPDATE process_level_progression_rule SET is_active = FALSE WHERE process_level_progression_rule_id = $1`, [id]);
  await recordAudit(pool, { entityName: "process_level_progression_rule", entityId: id, action: "DELETE", actorUserId: currentUser.userId, before });
  return { status: "deleted" };
}

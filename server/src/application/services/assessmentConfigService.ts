// M4 — assessment authoring. CRUD for the library (assessments + questions)
// and for a process level's assessment template (the grouping + per-link
// weight / gate / criticality). The one hard invariant lives here:
// activating a template requires its non-self-assessment weights to sum to
// exactly 100%.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const ASSESSMENT_TYPES = ["THEORY", "PRACTICAL", "BEHAVIOURAL", "SELF_ASSESSMENT", "ADD_ON"];
const QUESTION_TYPES = [
  "MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "RATING_1_5",
  "CHECKLIST_PASS_FAIL", "EVIDENCE_OBSERVATION", "FREE_TEXT_REMARK",
  "VIDEO", "AUDIO", "IMAGE",
];
const MCQ_TYPES = ["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"];
const EVALUATOR_CAPACITIES = ["SELF", "SUPERVISOR_ASSESSOR", "TRAINER", "SYSTEM"];

function scopeCompany(currentUser: CurrentUser, rowCompanyId: string) {
  if (currentUser.companyId && currentUser.companyId !== rowCompanyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}
function requiredCompany(currentUser: CurrentUser): string {
  if (!currentUser.companyId) throw new ApiError(400, "A company-scoped user is required");
  return currentUser.companyId;
}

// ===========================================================================
// Assessments (library)
// ===========================================================================
export async function createAssessment(
  body: { name?: string; assessmentType?: string; description?: string; addOnSubtype?: string },
  currentUser: CurrentUser
) {
  const companyId = requiredCompany(currentUser);
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const assessmentType = String(body.assessmentType ?? "").toUpperCase();
  if (!ASSESSMENT_TYPES.includes(assessmentType)) throw new ApiError(422, `assessmentType must be one of ${ASSESSMENT_TYPES.join(", ")}`);
  const addOnSubtype = assessmentType === "ADD_ON" ? (body.addOnSubtype ?? null) : null;
  const row = await queryOne<any>(
    `INSERT INTO assessment (company_id, name, description, assessment_type, add_on_subtype)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [companyId, name, body.description ?? null, assessmentType, addOnSubtype]
  );
  await recordAudit(pool, { entityName: "assessment", entityId: row.assessment_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

async function loadAssessment(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM assessment WHERE assessment_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Assessment not found");
  scopeCompany(currentUser, row.company_id);
  return row;
}

export async function updateAssessment(id: string, body: { name?: string; description?: string; assessmentType?: string; addOnSubtype?: string }, currentUser: CurrentUser) {
  const before = await loadAssessment(id, currentUser);
  const assessmentType = body.assessmentType != null ? String(body.assessmentType).toUpperCase() : before.assessment_type;
  if (!ASSESSMENT_TYPES.includes(assessmentType)) throw new ApiError(422, `assessmentType must be one of ${ASSESSMENT_TYPES.join(", ")}`);
  const row = await queryOne<any>(
    `UPDATE assessment SET name = $1, description = $2, assessment_type = $3,
       add_on_subtype = CASE WHEN $3 = 'ADD_ON' THEN $4 ELSE NULL END
     WHERE assessment_id = $5 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() : before.name,
      body.description !== undefined ? body.description : before.description,
      assessmentType,
      body.addOnSubtype !== undefined ? body.addOnSubtype : before.add_on_subtype,
      id,
    ]
  );
  await recordAudit(pool, { entityName: "assessment", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function deleteAssessment(id: string, currentUser: CurrentUser) {
  const before = await loadAssessment(id, currentUser);
  const linked = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM assessment_template_assessment ata
     JOIN assessment_template t ON t.assessment_template_id = ata.assessment_template_id
     WHERE ata.assessment_id = $1 AND t.is_active`,
    [id]
  );
  if (Number(linked?.n ?? 0) > 0) throw new ApiError(409, "This assessment is linked to an active template — remove the link first");
  await query(`UPDATE assessment SET is_active = FALSE WHERE assessment_id = $1`, [id]);
  await recordAudit(pool, { entityName: "assessment", entityId: id, action: "DELETE", actorUserId: currentUser.userId, before });
  return { status: "deleted" };
}

// ===========================================================================
// Questions
// ===========================================================================
function validateQuestionShape(questionType: string, body: any) {
  if (!QUESTION_TYPES.includes(questionType)) throw new ApiError(422, `questionType must be one of ${QUESTION_TYPES.join(", ")}`);
  if (MCQ_TYPES.includes(questionType)) {
    if (questionType !== "TRUE_FALSE" && (!Array.isArray(body.optionsJson) || body.optionsJson.length < 2)) {
      throw new ApiError(422, "MCQ questions need an optionsJson array of at least 2 options");
    }
    if (!Array.isArray(body.correctAnswerJson) || body.correctAnswerJson.length === 0) {
      throw new ApiError(422, "MCQ questions need a non-empty correctAnswerJson array");
    }
  }
  if (body.evaluatorCapacity != null && !EVALUATOR_CAPACITIES.includes(body.evaluatorCapacity)) {
    throw new ApiError(422, `evaluatorCapacity must be one of ${EVALUATOR_CAPACITIES.join(", ")}`);
  }
}

export async function addQuestion(assessmentId: string, body: any, currentUser: CurrentUser) {
  await loadAssessment(assessmentId, currentUser);
  const questionType = String(body.questionType ?? "").toUpperCase();
  validateQuestionShape(questionType, body);
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) throw new ApiError(422, "prompt is required");
  const nextSeq = (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM question WHERE assessment_id = $1`, [assessmentId]
  ))?.n ?? 1;
  const maxScore = body.maxScore != null ? Number(body.maxScore) : questionType === "RATING_1_5" ? 5 : 1;
  const row = await queryOne<any>(
    `INSERT INTO question
       (assessment_id, question_type, prompt, options_json, correct_answer_json, explanation, max_score,
        rating_scale_max, is_mandatory, is_critical, requires_assessor_remark, evaluator_capacity, sequence_no)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      assessmentId, questionType, prompt,
      body.optionsJson ? JSON.stringify(body.optionsJson) : null,
      body.correctAnswerJson ? JSON.stringify(body.correctAnswerJson) : null,
      body.explanation ?? null, maxScore,
      questionType === "RATING_1_5" ? Number(body.ratingScaleMax ?? 5) : null,
      body.isMandatory ?? true, body.isCritical ?? false, body.requiresAssessorRemark ?? false,
      String(body.evaluatorCapacity ?? "SUPERVISOR_ASSESSOR"), Number(nextSeq),
    ]
  );
  await recordAudit(pool, { entityName: "question", entityId: row.question_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

async function loadQuestion(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT q.*, a.company_id FROM question q JOIN assessment a ON a.assessment_id = q.assessment_id WHERE q.question_id = $1`,
    [id]
  );
  if (!row) throw new ApiError(404, "Question not found");
  scopeCompany(currentUser, row.company_id);
  return row;
}

export async function updateQuestion(id: string, body: any, currentUser: CurrentUser) {
  const before = await loadQuestion(id, currentUser);
  const questionType = body.questionType != null ? String(body.questionType).toUpperCase() : before.question_type;
  validateQuestionShape(questionType, {
    optionsJson: body.optionsJson ?? before.options_json,
    correctAnswerJson: body.correctAnswerJson ?? before.correct_answer_json,
    evaluatorCapacity: body.evaluatorCapacity,
  });
  const row = await queryOne<any>(
    `UPDATE question SET
       question_type = $1, prompt = $2, options_json = $3, correct_answer_json = $4, explanation = $5,
       max_score = $6, rating_scale_max = $7, is_mandatory = $8, is_critical = $9,
       requires_assessor_remark = $10, evaluator_capacity = $11
     WHERE question_id = $12 RETURNING *`,
    [
      questionType,
      body.prompt != null ? String(body.prompt).trim() : before.prompt,
      body.optionsJson !== undefined ? (body.optionsJson ? JSON.stringify(body.optionsJson) : null) : before.options_json,
      body.correctAnswerJson !== undefined ? (body.correctAnswerJson ? JSON.stringify(body.correctAnswerJson) : null) : before.correct_answer_json,
      body.explanation !== undefined ? body.explanation : before.explanation,
      body.maxScore != null ? Number(body.maxScore) : before.max_score,
      questionType === "RATING_1_5" ? Number(body.ratingScaleMax ?? before.rating_scale_max ?? 5) : null,
      body.isMandatory ?? before.is_mandatory,
      body.isCritical ?? before.is_critical,
      body.requiresAssessorRemark ?? before.requires_assessor_remark,
      String(body.evaluatorCapacity ?? before.evaluator_capacity),
      id,
    ]
  );
  await recordAudit(pool, { entityName: "question", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function deleteQuestion(id: string, currentUser: CurrentUser) {
  const before = await loadQuestion(id, currentUser);
  await query(`UPDATE question SET is_active = FALSE WHERE question_id = $1`, [id]);
  await recordAudit(pool, { entityName: "question", entityId: id, action: "DELETE", actorUserId: currentUser.userId, before });
  return { status: "deleted" };
}

export async function reorderQuestions(assessmentId: string, orderedIds: string[], currentUser: CurrentUser) {
  await loadAssessment(assessmentId, currentUser);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) throw new ApiError(422, "orderedIds must be a non-empty array");
  const owned = await query<{ question_id: string }>(`SELECT question_id FROM question WHERE assessment_id = $1`, [assessmentId]);
  const ownedSet = new Set(owned.map((r) => r.question_id));
  if (!orderedIds.every((id) => ownedSet.has(id))) throw new ApiError(422, "orderedIds contains a question not in this assessment");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE question SET sequence_no = $1 WHERE question_id = $2`, [i + 1, orderedIds[i]]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { status: "reordered", count: orderedIds.length };
}

// ===========================================================================
// Templates + template<->assessment links
// ===========================================================================
async function loadLevelForTemplate(processLevelId: string, currentUser: CurrentUser) {
  const level = await queryOne<any>(`SELECT process_level_id, company_id FROM process_level WHERE process_level_id = $1`, [processLevelId]);
  if (!level) throw new ApiError(404, "Process level not found");
  scopeCompany(currentUser, level.company_id);
  return level;
}

export async function createTemplate(processLevelId: string, currentUser: CurrentUser) {
  const level = await loadLevelForTemplate(processLevelId, currentUser);
  const nextVersion = (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM assessment_template WHERE process_level_id = $1`, [processLevelId]
  ))?.n ?? 1;
  const row = await queryOne<any>(
    `INSERT INTO assessment_template (company_id, process_level_id, version, is_active)
     VALUES ($1,$2,$3, FALSE) RETURNING *`,
    [level.company_id, processLevelId, Number(nextVersion)]
  );
  await recordAudit(pool, { entityName: "assessment_template", entityId: row.assessment_template_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

async function loadTemplate(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM assessment_template WHERE assessment_template_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Template not found");
  scopeCompany(currentUser, row.company_id);
  return row;
}

export async function deleteTemplate(id: string, currentUser: CurrentUser) {
  const before = await loadTemplate(id, currentUser);
  await query(`UPDATE assessment_template SET is_active = FALSE, effective_to = CURRENT_DATE WHERE assessment_template_id = $1`, [id]);
  await recordAudit(pool, { entityName: "assessment_template", entityId: id, action: "DELETE", actorUserId: currentUser.userId, before });
  return { status: "deleted" };
}

async function templateWeightSum(templateId: string): Promise<number> {
  const rows = await query<{ weight_pct: string }>(
    `SELECT weight_pct FROM assessment_template_assessment WHERE assessment_template_id = $1 AND NOT self_assessment_enabled`,
    [templateId]
  );
  return rows.reduce((s, r) => s + Number(r.weight_pct ?? 0), 0);
}

export async function activateTemplate(id: string, currentUser: CurrentUser) {
  const tpl = await loadTemplate(id, currentUser);
  const links = await query<any>(`SELECT * FROM assessment_template_assessment WHERE assessment_template_id = $1`, [id]);
  if (links.length === 0) throw new ApiError(422, "Add at least one assessment before activating");
  const sum = await templateWeightSum(id);
  if (Math.abs(sum - 100) > 0.01) {
    throw new ApiError(422, `Non-self-assessment weights must sum to 100% before activating (currently ${sum.toFixed(2)}%)`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // one active template per level
    await client.query(
      `UPDATE assessment_template SET is_active = FALSE, effective_to = CURRENT_DATE
       WHERE process_level_id = $1 AND assessment_template_id <> $2 AND is_active`,
      [tpl.process_level_id, id]
    );
    await client.query(
      `UPDATE assessment_template SET is_active = TRUE, effective_from = CURRENT_DATE, effective_to = NULL WHERE assessment_template_id = $1`,
      [id]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await recordAudit(pool, { entityName: "assessment_template", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { is_active: true, weightSum: sum } });
  return { status: "active", weightSum: sum };
}

export async function addTemplateAssessment(templateId: string, body: any, currentUser: CurrentUser) {
  const tpl = await loadTemplate(templateId, currentUser);
  const assessment = await loadAssessment(String(body.assessmentId ?? ""), currentUser);
  const weightPct = Number(body.weightPct ?? 0);
  if (!Number.isFinite(weightPct) || weightPct < 0 || weightPct > 100) throw new ApiError(422, "weightPct must be between 0 and 100");
  const nextSeq = (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM assessment_template_assessment WHERE assessment_template_id = $1`, [templateId]
  ))?.n ?? 1;
  const row = await queryOne<any>(
    `INSERT INTO assessment_template_assessment
       (assessment_template_id, assessment_id, sequence_no, weight_pct, min_gate_pct, is_mandatory,
        self_assessment_enabled, is_critical, auto_fail_on_gate_miss)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (assessment_template_id, assessment_id) DO UPDATE SET
       weight_pct = EXCLUDED.weight_pct, min_gate_pct = EXCLUDED.min_gate_pct, is_mandatory = EXCLUDED.is_mandatory,
       self_assessment_enabled = EXCLUDED.self_assessment_enabled, is_critical = EXCLUDED.is_critical,
       auto_fail_on_gate_miss = EXCLUDED.auto_fail_on_gate_miss
     RETURNING *`,
    [
      templateId, assessment.assessment_id, Number(body.sequenceNo ?? nextSeq), weightPct,
      body.minGatePct != null ? Number(body.minGatePct) : null,
      body.isMandatory ?? true,
      body.selfAssessmentEnabled ?? false,
      body.isCritical ?? false,
      body.autoFailOnGateMiss ?? true,
    ]
  );
  await recordAudit(pool, { entityName: "assessment_template_assessment", entityId: row.assessment_template_assessment_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  // touch the template so an activate re-checks
  void tpl;
  return row;
}

async function loadLink(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT ata.*, t.company_id FROM assessment_template_assessment ata
     JOIN assessment_template t ON t.assessment_template_id = ata.assessment_template_id
     WHERE ata.assessment_template_assessment_id = $1`,
    [id]
  );
  if (!row) throw new ApiError(404, "Template link not found");
  scopeCompany(currentUser, row.company_id);
  return row;
}

export async function updateTemplateAssessment(id: string, body: any, currentUser: CurrentUser) {
  const before = await loadLink(id, currentUser);
  const weightPct = body.weightPct != null ? Number(body.weightPct) : Number(before.weight_pct);
  if (!Number.isFinite(weightPct) || weightPct < 0 || weightPct > 100) throw new ApiError(422, "weightPct must be between 0 and 100");
  const row = await queryOne<any>(
    `UPDATE assessment_template_assessment SET
       weight_pct = $1, min_gate_pct = $2, is_mandatory = $3, self_assessment_enabled = $4,
       is_critical = $5, auto_fail_on_gate_miss = $6, sequence_no = $7
     WHERE assessment_template_assessment_id = $8 RETURNING *`,
    [
      weightPct,
      body.minGatePct !== undefined ? (body.minGatePct != null ? Number(body.minGatePct) : null) : before.min_gate_pct,
      body.isMandatory ?? before.is_mandatory,
      body.selfAssessmentEnabled ?? before.self_assessment_enabled,
      body.isCritical ?? before.is_critical,
      body.autoFailOnGateMiss ?? before.auto_fail_on_gate_miss,
      Number(body.sequenceNo ?? before.sequence_no),
      id,
    ]
  );
  await recordAudit(pool, { entityName: "assessment_template_assessment", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function removeTemplateAssessment(id: string, currentUser: CurrentUser) {
  const before = await loadLink(id, currentUser);
  const referenced = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM assessment_attempt_section WHERE assessment_template_assessment_id = $1`, [id]
  );
  if (Number(referenced?.n ?? 0) > 0) throw new ApiError(409, "This assessment has already been used in an attempt and cannot be unlinked");
  await query(`DELETE FROM assessment_template_assessment WHERE assessment_template_assessment_id = $1`, [id]);
  await recordAudit(pool, { entityName: "assessment_template_assessment", entityId: id, action: "DELETE", actorUserId: currentUser.userId, before });
  return { status: "removed" };
}

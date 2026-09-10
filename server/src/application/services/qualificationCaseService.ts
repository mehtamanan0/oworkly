// The deterministic result engine and qualification-case state machine.
// Pass/fail is always rule-based here — nothing in this file calls an AI
// provider, and nothing outside this file is allowed to decide a result.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import { assertEvaluatorCapacity } from "../../middleware/authorization/index.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";
import { initiateApproval } from "./approvalService.js";
import { mandatorySubLevelStatus } from "./subLevelProgressService.js";

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["READY_FOR_ASSESSMENT", "NOT_ELIGIBLE", "CANCELLED"],
  READY_FOR_ASSESSMENT: ["ASSESSMENT_IN_PROGRESS", "CANCELLED"],
  ASSESSMENT_IN_PROGRESS: ["PENDING_APPROVAL", "FAILED", "CANCELLED"],
  FAILED: ["RETEST_COOLING", "CANCELLED"],
  RETEST_COOLING: ["ASSESSMENT_IN_PROGRESS", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "RETURNED_FOR_REVIEW", "CANCELLED"],
  RETURNED_FOR_REVIEW: ["ASSESSMENT_IN_PROGRESS", "PENDING_APPROVAL", "CANCELLED"],
  APPROVED: ["CERTIFIED"],
  CERTIFIED: ["EXPIRED", "RENEWAL_IN_PROGRESS"],
};

async function transitionCase(db: PoolClient, caseId: string, toStatus: string, actorUserId: string | null, correlationId?: string) {
  const current = await db.query(`SELECT status FROM qualification_case WHERE qualification_case_id = $1 FOR UPDATE`, [caseId]);
  if (!current.rows[0]) throw new ApiError(404, "Qualification case not found");
  const from = current.rows[0].status;
  if (from !== toStatus && !(VALID_TRANSITIONS[from] ?? []).includes(toStatus)) {
    throw new ApiError(422, `Invalid qualification case transition: ${from} -> ${toStatus}`);
  }
  await db.query(`UPDATE qualification_case SET status = $1, updated_at = now() WHERE qualification_case_id = $2`, [toStatus, caseId]);
  await recordAudit(db, { entityName: "qualification_case", entityId: caseId, action: "STATUS_CHANGE", actorUserId, before: { status: from }, after: { status: toStatus }, correlationId });
}

export async function createOrGetCase(workerId: string, processId: string, targetProcessLevelId: string, currentUser: CurrentUser) {
  const worker = await queryOne<{ company_id: string }>(`SELECT company_id FROM worker WHERE worker_id = $1`, [workerId]);
  if (!worker) throw new ApiError(404, "Worker not found");
  if (currentUser.companyId && currentUser.companyId !== worker.company_id) throw new ApiError(403, "Cross-company access is not permitted");

  const open = await queryOne(
    `SELECT * FROM qualification_case WHERE worker_id = $1 AND process_id = $2 AND target_process_level_id = $3
     AND status NOT IN ('CERTIFIED','CANCELLED','EXPIRED') ORDER BY created_at DESC LIMIT 1`,
    [workerId, processId, targetProcessLevelId]
  );
  if (open) return open;

  const current = await queryOne<{ current_process_level_id: string | null }>(
    `SELECT current_process_level_id FROM worker_process_enrollment WHERE worker_id = $1 AND process_id = $2`,
    [workerId, processId]
  );
  const activePackage = await queryOne<{ assessment_template_id: string }>(
    `SELECT assessment_template_id FROM assessment_template WHERE process_level_id = $1 AND is_active ORDER BY version DESC LIMIT 1`,
    [targetProcessLevelId]
  );
  if (!activePackage) throw new ApiError(422, "No active assessment package configured for this process level");

  // Minimal real eligibility gate for this pass (the full configurable rules
  // engine is out of scope): the worker must already be enrolled in the
  // process. A fuller engine would check tenure/OJT/training here and
  // transition to NOT_ELIGIBLE / TRAINING_REQUIRED instead.
  const enrolled = await queryOne(`SELECT 1 FROM worker_process_enrollment WHERE worker_id = $1 AND process_id = $2`, [workerId, processId]);
  const status = enrolled ? "READY_FOR_ASSESSMENT" : "NOT_ELIGIBLE";

  const qualificationNumber = `QID-${randomUUID().slice(0, 8).toUpperCase()}`;
  const created = await queryOne(
    `INSERT INTO qualification_case (company_id, worker_id, process_id, from_process_level_id, target_process_level_id, assessment_template_id, status, qualification_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [worker.company_id, workerId, processId, current?.current_process_level_id ?? null, targetProcessLevelId, activePackage.assessment_template_id, status, qualificationNumber]
  );
  await recordAudit(pool, {
    entityName: "qualification_case", entityId: created!.qualification_case_id, action: "INSERT", actorUserId: currentUser.userId, after: created,
  });
  return created;
}

export async function startAttempt(qualificationCaseId: string, currentUser: CurrentUser, clientIdempotencyKey?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const qcase = await client.query(`SELECT * FROM qualification_case WHERE qualification_case_id = $1 FOR UPDATE`, [qualificationCaseId]);
    if (!qcase.rows[0]) throw new ApiError(404, "Qualification case not found");
    if (currentUser.companyId && currentUser.companyId !== qcase.rows[0].company_id) throw new ApiError(403, "Cross-company access is not permitted");
    if (!["READY_FOR_ASSESSMENT", "RETEST_COOLING", "RETURNED_FOR_REVIEW"].includes(qcase.rows[0].status)) {
      throw new ApiError(422, `Cannot start an attempt from status ${qcase.rows[0].status}`);
    }

    // An EMPLOYEE-role token is only ever issued by the Worker Self-Assessment
    // Portal (see workerPortal.ts), to the worker themselves. Per the spec's
    // most safety-critical rule, self-assessment must NEVER touch
    // qualification_case.status — so this branch must be decided here, at
    // start time, not inferred later from which components got scored.
    const isSelfAssessmentStart = currentUser.roles.includes("EMPLOYEE");

    const priorCount = await client.query(`SELECT count(*) AS cnt FROM assessment_attempt WHERE qualification_case_id = $1`, [qualificationCaseId]);
    const attempt = await client.query(
      `INSERT INTO assessment_attempt (qualification_case_id, assessment_template_id, worker_id, attempt_no, status, client_idempotency_key, started_at)
       VALUES ($1,$2,$3,$4,'in_progress',$5,now()) RETURNING *`,
      [qualificationCaseId, qcase.rows[0].assessment_template_id, qcase.rows[0].worker_id, Number(priorCount.rows[0].cnt) + 1, clientIdempotencyKey ?? null]
    );

    // A self-assessment start only ever gets the self-assessment-enabled
    // component(s) — the worker has no evaluator capacity over the
    // Practical/Theory/Behavioural components anyway (assertEvaluatorCapacity
    // would reject any attempt to score them), so there is no reason to
    // create pending rows for them here.
    const components = await client.query(
      `SELECT assessment_template_assessment_id FROM assessment_template_assessment
       WHERE assessment_template_id = $1 ${isSelfAssessmentStart ? "AND self_assessment_enabled" : ""}
       ORDER BY sequence_no`,
      [qcase.rows[0].assessment_template_id]
    );
    for (const c of components.rows) {
      await client.query(
        `INSERT INTO assessment_attempt_section (assessment_attempt_id, assessment_template_assessment_id, status) VALUES ($1,$2,'pending')`,
        [attempt.rows[0].assessment_attempt_id, c.assessment_template_assessment_id]
      );
    }

    if (!isSelfAssessmentStart) {
      await transitionCase(client, qualificationCaseId, "ASSESSMENT_IN_PROGRESS", currentUser.userId);
    }
    await recordAudit(client, { entityName: "assessment_attempt", entityId: attempt.rows[0].assessment_attempt_id, action: "INSERT", actorUserId: currentUser.userId, after: { ...attempt.rows[0], selfAssessmentStart: isSelfAssessmentStart } });
    await client.query("COMMIT");
    return attempt.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface ItemResponseInput {
  questionId: string;
  responseJson?: unknown;
  score: number;
  assessorRemark?: string;
  evidenceFileId?: string;
}

// VIDEO / AUDIO / IMAGE questions (ERD ask #5): human-graded like
// EVIDENCE_OBSERVATION (no correct_answer_json), but the response MUST carry a
// confirmed evidence_file — a media question scored with no captured artifact
// is rejected.
const MEDIA_TYPES = new Set(["VIDEO", "AUDIO", "IMAGE"]);

// MCQ_SINGLE/MCQ_MULTI/TRUE_FALSE items with a correct_answer_json are
// objectively gradable — the score must be computed here, from the
// worker/assessor's actual responseJson, never trusted from the client's
// submitted `score` field. Without this, a tampered client could submit full
// marks for every question regardless of which option was actually chosen.
// Rating-type items (assessor judgment, no single correct answer) still use
// the submitted score as before.
const AUTO_GRADED_TYPES = new Set(["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"]);

function computeObjectiveScore(
  item: { question_type: string; correct_answer_json: unknown; max_score: number | string },
  responseJson: unknown
): { scoreNum: number; isCorrect: boolean } | null {
  if (!AUTO_GRADED_TYPES.has(item.question_type) || item.correct_answer_json == null) return null;
  const correctKeys = new Set((Array.isArray(item.correct_answer_json) ? item.correct_answer_json : [item.correct_answer_json]).map(String));
  const resp = (responseJson ?? {}) as { chosen?: string; chosenKeys?: string[] };
  const chosenKeys = new Set<string>(
    item.question_type === "MCQ_MULTI" ? (resp.chosenKeys ?? []).map(String) : resp.chosen != null ? [String(resp.chosen)] : []
  );
  const isCorrect = chosenKeys.size === correctKeys.size && [...chosenKeys].every((k) => correctKeys.has(k));
  return { scoreNum: isCorrect ? Number(item.max_score) : 0, isCorrect };
}

export async function scoreComponent(componentAttemptId: string, responses: ItemResponseInput[], currentUser: CurrentUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const componentAttempt = await client.query(
      `SELECT ca.*, aa.status AS attempt_status, aa.worker_id, apc.assessment_template_id, apc.assessment_id, apc.is_mandatory
       FROM assessment_attempt_section ca
       JOIN assessment_attempt aa ON aa.assessment_attempt_id = ca.assessment_attempt_id
       JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = ca.assessment_template_assessment_id
       WHERE ca.assessment_attempt_section_id = $1 FOR UPDATE`,
      [componentAttemptId]
    );
    const row = componentAttempt.rows[0];
    if (!row) throw new ApiError(404, "Component attempt not found");
    if (row.attempt_status !== "in_progress") throw new ApiError(422, `Cannot score a component on an attempt with status ${row.attempt_status}`);

    const items = await client.query(
      `SELECT question_id, question_type, max_score, is_critical, evaluator_capacity, is_mandatory, correct_answer_json FROM question
       WHERE assessment_id = $1 AND is_active AND review_status = 'approved'`,
      [row.assessment_id]
    );
    const processIdRow = await client.query(
      `SELECT qc.process_id FROM qualification_case qc JOIN assessment_attempt aa ON aa.qualification_case_id = qc.qualification_case_id WHERE aa.assessment_attempt_id = $1`,
      [row.assessment_attempt_id]
    );
    const processId = processIdRow.rows[0]?.process_id;
    const itemById = new Map(items.rows.map((i) => [i.question_id, i]));

    // --- validation: unknown ids, duplicates, missing mandatory items, bounds ---
    // pg returns NUMERIC columns as strings (to avoid float precision loss), so
    // max_score arrives as e.g. "5.00" — and a client's score can just as
    // easily arrive as a numeric string after round-tripping through JSON.
    // Every arithmetic use below goes through this normalized map rather than
    // the raw request value, so a stray string can't turn `raw += r.score`
    // into silent string concatenation (which previously corrupted the total
    // into garbage like "05.005.00..." and crashed on save).
    const workerCompany = await client.query(`SELECT company_id FROM worker WHERE worker_id = $1`, [row.worker_id]);
    const workerCompanyId = workerCompany.rows[0]?.company_id ?? null;

    const seen = new Set<string>();
    const scoreById = new Map<string, number>();
    const evidenceById = new Map<string, string>(); // questionId -> evidence_file_id (media questions only)
    for (const r of responses) {
      const item = itemById.get(r.questionId);
      if (!item) throw new ApiError(422, `Unknown question_id: ${r.questionId}`);
      if (seen.has(r.questionId)) throw new ApiError(422, `Duplicate response for item ${r.questionId}`);
      seen.add(r.questionId);
      const objective = computeObjectiveScore(item, r.responseJson);
      let scoreNum: number;
      if (objective) {
        scoreNum = objective.scoreNum; // server-computed — the client's submitted `score` is ignored for auto-graded items
      } else {
        scoreNum = Number(r.score);
        if (!Number.isFinite(scoreNum)) throw new ApiError(422, `Score for item ${r.questionId} must be a number`);
        if (scoreNum < 0 || scoreNum > Number(item.max_score)) throw new ApiError(422, `Score for item ${r.questionId} must be between 0 and ${item.max_score}`);
      }
      if (MEDIA_TYPES.has(item.question_type)) {
        if (!r.evidenceFileId) throw new ApiError(422, `A captured file (evidenceFileId) is required to score media question ${r.questionId}`);
        const ev = await client.query(
          `SELECT evidence_file_id, status, company_id FROM evidence_file WHERE evidence_file_id = $1`,
          [r.evidenceFileId]
        );
        if (!ev.rows[0]) throw new ApiError(422, `Unknown evidenceFileId for question ${r.questionId}`);
        if (ev.rows[0].status !== "ready") throw new ApiError(422, `evidenceFileId for question ${r.questionId} has not finished uploading`);
        if (workerCompanyId && ev.rows[0].company_id && ev.rows[0].company_id !== workerCompanyId) {
          throw new ApiError(403, "Evidence file belongs to another company");
        }
        evidenceById.set(r.questionId, r.evidenceFileId);
      }
      scoreById.set(r.questionId, scoreNum);
    }
    const mandatoryIds = items.rows.filter((i) => i.is_mandatory).map((i) => i.question_id);
    const missing = mandatoryIds.filter((id) => !seen.has(id));
    if (missing.length > 0) throw new ApiError(422, `Missing mandatory items: ${missing.join(", ")}`);

    let raw = 0, max = 0, forcedFail = false;
    for (const r of responses) {
      const item = itemById.get(r.questionId)!;
      const scoreNum = scoreById.get(r.questionId)!;
      await assertEvaluatorCapacity(currentUser, item.evaluator_capacity, row.worker_id, processId, row.assessment_template_id);
      raw += scoreNum;
      max += Number(item.max_score);
      const isCorrect = item.correct_answer_json ? scoreNum >= Number(item.max_score) : null;
      if (item.is_critical && scoreNum < Number(item.max_score)) forcedFail = true;
      const evidenceFileId = evidenceById.get(r.questionId) ?? null;
      const resp = await client.query(
        `INSERT INTO question_response (assessment_attempt_section_id, question_id, response_json, raw_score, max_score, is_correct, evaluator_capacity, evaluator_user_id, assessor_remark, evidence_file_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (assessment_attempt_section_id, question_id) DO UPDATE SET
           response_json = EXCLUDED.response_json, raw_score = EXCLUDED.raw_score, is_correct = EXCLUDED.is_correct, evaluator_user_id = EXCLUDED.evaluator_user_id, assessor_remark = EXCLUDED.assessor_remark, evidence_file_id = EXCLUDED.evidence_file_id, scored_at = now()
         RETURNING question_response_id`,
        [componentAttemptId, r.questionId, r.responseJson ? JSON.stringify(r.responseJson) : null, scoreNum, item.max_score, isCorrect, item.evaluator_capacity, currentUser.userId, r.assessorRemark ?? null, evidenceFileId]
      );
      if (evidenceFileId) {
        // Re-scoring replaces the linked artifact rather than accumulating rows
        // (assessment_evidence has no natural unique key to ON CONFLICT on).
        await client.query(`DELETE FROM assessment_evidence WHERE question_response_id = $1`, [resp.rows[0].question_response_id]);
        await client.query(
          `INSERT INTO assessment_evidence (question_response_id, evidence_file_id) VALUES ($1,$2)`,
          [resp.rows[0].question_response_id, evidenceFileId]
        );
      }
    }

    const weightedPct = max > 0 ? Math.round(((raw / max) * 100) * 100) / 100 : 0;
    await client.query(
      `UPDATE assessment_attempt_section SET status = 'scored', raw_score = $1, max_possible_score = $2, weighted_pct = $3, forced_fail = $4, evaluator_user_id = $5, scored_at = now()
       WHERE assessment_attempt_section_id = $6`,
      [raw, max, weightedPct, forcedFail, currentUser.userId, componentAttemptId]
    );
    await recordAudit(client, { entityName: "assessment_attempt_section", entityId: componentAttemptId, action: "UPDATE", actorUserId: currentUser.userId, after: { raw, max, forcedFail } });
    await client.query("COMMIT");
    return { raw, max, weightedPct, forcedFail };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Immediate per-question feedback for an MCQ-style self-assessment quiz
// (screenshots 15/16: pick an option, see correct/incorrect + explanation
// right away, before moving to the next question). Deliberately separate
// from scoreComponent, which requires every item in the component to be
// submitted together — a quiz needs to reveal correctness one question at a
// time, without ever exposing the answer key up front. The response this
// writes is provisional (upserted, same as scoreComponent's own rows) and
// still has to pass through the normal scoreComponent + finalizeAttempt path
// to actually count — this endpoint alone never finalizes anything.
export async function checkItem(componentAttemptId: string, questionId: string, responseJson: unknown, currentUser: CurrentUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const componentAttempt = await client.query(
      `SELECT ca.*, aa.status AS attempt_status, aa.worker_id, aa.assessment_attempt_id, apc.assessment_template_id, apc.assessment_id
       FROM assessment_attempt_section ca
       JOIN assessment_attempt aa ON aa.assessment_attempt_id = ca.assessment_attempt_id
       JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = ca.assessment_template_assessment_id
       WHERE ca.assessment_attempt_section_id = $1 FOR UPDATE`,
      [componentAttemptId]
    );
    const row = componentAttempt.rows[0];
    if (!row) throw new ApiError(404, "Component attempt not found");
    if (row.attempt_status !== "in_progress") throw new ApiError(422, `Cannot answer a component on an attempt with status ${row.attempt_status}`);

    const itemRes = await client.query(
      `SELECT question_id, question_type, max_score, evaluator_capacity, correct_answer_json, explanation FROM question
       WHERE question_id = $1 AND assessment_id = $2 AND is_active AND review_status = 'approved'`,
      [questionId, row.assessment_id]
    );
    const item = itemRes.rows[0];
    if (!item) throw new ApiError(404, "Item not found in this component");

    if (MEDIA_TYPES.has(item.question_type)) {
      throw new ApiError(422, "Media questions are captured and graded by an assessor — they cannot be self-checked");
    }
    const objective = computeObjectiveScore(item, responseJson);
    if (!objective) throw new ApiError(422, "This item type has no single correct answer to check — score it via the component score endpoint instead");

    const processIdRow = await client.query(
      `SELECT qc.process_id FROM qualification_case qc WHERE qc.qualification_case_id = (SELECT qualification_case_id FROM assessment_attempt WHERE assessment_attempt_id = $1)`,
      [row.assessment_attempt_id]
    );
    await assertEvaluatorCapacity(currentUser, item.evaluator_capacity, row.worker_id, processIdRow.rows[0]?.process_id, row.assessment_template_id);

    await client.query(
      `INSERT INTO question_response (assessment_attempt_section_id, question_id, response_json, raw_score, max_score, is_correct, evaluator_capacity, evaluator_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (assessment_attempt_section_id, question_id) DO UPDATE SET
         response_json = EXCLUDED.response_json, raw_score = EXCLUDED.raw_score, is_correct = EXCLUDED.is_correct, evaluator_user_id = EXCLUDED.evaluator_user_id, scored_at = now()`,
      [componentAttemptId, questionId, JSON.stringify(responseJson), objective.scoreNum, item.max_score, objective.isCorrect, item.evaluator_capacity, currentUser.userId]
    );
    await client.query("COMMIT");
    return { isCorrect: objective.isCorrect, correctAnswerKeys: item.correct_answer_json, explanation: item.explanation, maxScore: item.max_score };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function finalizeAttempt(attemptId: string, currentUser: CurrentUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const attempt = await client.query(`SELECT * FROM assessment_attempt WHERE assessment_attempt_id = $1 FOR UPDATE`, [attemptId]);
    if (!attempt.rows[0]) throw new ApiError(404, "Attempt not found");
    if (attempt.rows[0].status !== "in_progress") throw new ApiError(422, `Cannot finalize an attempt with status ${attempt.rows[0].status}`);

    const componentAttempts = await client.query(
      `SELECT ca.*, apc.weight_pct, apc.min_gate_pct, apc.is_mandatory, apc.self_assessment_enabled,
              apc.is_critical AS link_is_critical, apc.auto_fail_on_gate_miss, ad.name AS definition_name
       FROM assessment_attempt_section ca
       JOIN assessment_template_assessment apc ON apc.assessment_template_assessment_id = ca.assessment_template_assessment_id
       JOIN assessment ad ON ad.assessment_id = apc.assessment_id
       WHERE ca.assessment_attempt_id = $1`,
      [attemptId]
    );
    // Whether this is a real (Supervisor/Trainer-run) attempt or a worker's
    // independent self-assessment-only attempt must be decided BEFORE the
    // "all mandatory components scored" gate below — a self-assessment
    // attempt only ever scores the non-mandatory self-assessment component,
    // so checking mandatory-completeness first would make that path
    // permanently unfinalizable.
    const scoredNonSelf = componentAttempts.rows.filter((c) => c.status === "scored" && !c.self_assessment_enabled);

    if (scoredNonSelf.length === 0) {
      // Pure self-assessment attempt — readiness/review only. Per the spec's
      // most safety-critical rule, this NEVER creates a qualification_result,
      // never touches qualification_case.status, never issues a certificate.
      const selfComponent = componentAttempts.rows.find((c) => c.status === "scored" && c.self_assessment_enabled);
      const passed = selfComponent ? Number(selfComponent.weighted_pct ?? 0) >= Number(selfComponent.min_gate_pct ?? 0) * (100 / 100) : false;
      await client.query(`UPDATE assessment_attempt SET status = 'scored', submitted_at = now() WHERE assessment_attempt_id = $1`, [attemptId]);
      await client.query(
        `INSERT INTO self_assessment_review (assessment_attempt_id, outcome_note) VALUES ($1,$2)
         ON CONFLICT (assessment_attempt_id) DO NOTHING`,
        [attemptId, passed ? "Passed readiness check" : "Not passed — review required"]
      );
      await recordAudit(client, { entityName: "assessment_attempt", entityId: attemptId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { selfAssessmentOnly: true, passed } });
      await client.query("COMMIT");
      return { selfAssessmentOnly: true, passed, compositePct: selfComponent ? Number(selfComponent.weighted_pct) : 0 };
    }

    // A real (non-self-assessment) attempt DOES require every mandatory
    // component scored before it can be finalized into a qualification_result.
    const mandatoryScored = componentAttempts.rows.filter((c) => c.is_mandatory && c.status === "scored");
    const mandatoryTotal = componentAttempts.rows.filter((c) => c.is_mandatory);
    if (mandatoryScored.length < mandatoryTotal.length) {
      throw new ApiError(422, "All mandatory components must be scored before finalizing");
    }

    const qcase = await client.query(`SELECT * FROM qualification_case WHERE qualification_case_id = $1 FOR UPDATE`, [attempt.rows[0].qualification_case_id]);
    const processLevel = await client.query(`SELECT min_qualification_score_pct FROM process_level WHERE process_level_id = $1`, [qcase.rows[0].target_process_level_id]);
    const passThreshold = Number(processLevel.rows[0].min_qualification_score_pct ?? 70);

    // Sub-level gate (migration 0014): every mandatory sub-level of the target
    // level must be signed off complete for this worker before the attempt can
    // be finalized. Mirrors the mandatory-components gate above — a hard stop,
    // then recorded as an ALL_MANDATORY_SUB_LEVELS_COMPLETE rule check below.
    // A level with no mandatory sub-levels configured is unaffected.
    const subLevelStatus = await mandatorySubLevelStatus(client, attempt.rows[0].worker_id, qcase.rows[0].target_process_level_id);
    if (subLevelStatus.incomplete.length > 0) {
      throw new ApiError(
        422,
        `All mandatory sub-levels for the target level must be completed before finalizing (missing: ${subLevelStatus.incomplete.map((s) => s.code).join(", ")})`
      );
    }

    let weightedTotal = 0;
    let forcedFail = false;
    const componentResults: { componentAttemptId: string; rawPct: number; weightPct: number; weightedPct: number; gatePct: number | null; gatePassed: boolean | null; status: "PASS" | "FAIL" }[] = [];
    for (const c of componentAttempts.rows) {
      if (c.status !== "scored") continue;
      const rawPct = Number(c.max_possible_score) > 0 ? (Number(c.raw_score) / Number(c.max_possible_score)) * 100 : 0;
      const weightPct = Number(c.weight_pct);
      const weightedPct = Math.round(((rawPct / 100) * weightPct) * 100) / 100;
      const gatePct = c.min_gate_pct != null ? Number(c.min_gate_pct) : null;
      const gatePassed = gatePct != null ? rawPct >= gatePct : null;
      // A gate miss force-fails the whole qualification only when the link says
      // so — auto_fail_on_gate_miss (default true, = legacy behaviour) or the
      // link being marked critical. A per-question critical miss (forced_fail)
      // always force-fails. (M4 migration 0016.)
      const gateMissFails = gatePassed === false && (c.auto_fail_on_gate_miss !== false || c.link_is_critical === true);
      const componentFailed = c.forced_fail === true || gateMissFails;
      if (componentFailed) forcedFail = true;
      weightedTotal += weightedPct;
      componentResults.push({ componentAttemptId: c.assessment_attempt_section_id, rawPct: Math.round(rawPct * 100) / 100, weightPct, weightedPct, gatePct, gatePassed, status: componentFailed ? "FAIL" : "PASS" });
    }
    weightedTotal = Math.round(weightedTotal * 100) / 100;
    const result: "PASS" | "FAIL" = !forcedFail && weightedTotal >= passThreshold ? "PASS" : "FAIL";

    await client.query(`UPDATE assessment_attempt SET status = 'scored', submitted_at = now() WHERE assessment_attempt_id = $1`, [attemptId]);

    const qr = await client.query(
      `INSERT INTO qualification_result (qualification_case_id, assessment_attempt_id, weighted_score_pct, pass_threshold_pct, result)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [qcase.rows[0].qualification_case_id, attemptId, weightedTotal, passThreshold, result]
    );
    for (const cr of componentResults) {
      await client.query(
        `INSERT INTO qualification_component_result (qualification_result_id, assessment_attempt_section_id, raw_pct, weight_pct, weighted_pct, gate_pct, gate_passed, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [qr.rows[0].qualification_result_id, cr.componentAttemptId, cr.rawPct, cr.weightPct, cr.weightedPct, cr.gatePct, cr.gatePassed, cr.status]
      );
    }
    await client.query(
      `INSERT INTO qualification_rule_check (qualification_result_id, rule_code, label, passed, detail_json) VALUES
       ($1,'WEIGHTED_SCORE_MIN',$2,$3,$4),
       ($1,'ALL_MANDATORY_COMPONENTS_COMPLETE',$5,$6,$7),
       ($1,'ALL_MANDATORY_SUB_LEVELS_COMPLETE',$8,$9,$10)`,
      [
        qr.rows[0].qualification_result_id, `Weighted Score ≥ ${passThreshold}%`, weightedTotal >= passThreshold, JSON.stringify({ weightedTotal, passThreshold }),
        "All Assessments Completed", mandatoryScored.length === mandatoryTotal.length, JSON.stringify({ completed: mandatoryScored.length, total: mandatoryTotal.length }),
        "All Mandatory Sub-levels Completed", subLevelStatus.incomplete.length === 0, JSON.stringify({ completed: subLevelStatus.completed, total: subLevelStatus.total }),
      ]
    );

    if (result === "PASS") {
      await transitionCase(client, qcase.rows[0].qualification_case_id, "PENDING_APPROVAL", currentUser.userId);
      await initiateApproval(client, qcase.rows[0].qualification_case_id);
    } else {
      await transitionCase(client, qcase.rows[0].qualification_case_id, "FAILED", currentUser.userId);
    }

    await recordAudit(client, { entityName: "qualification_result", entityId: qr.rows[0].qualification_result_id, action: "INSERT", actorUserId: currentUser.userId, after: qr.rows[0] });
    await client.query("COMMIT");
    return { selfAssessmentOnly: false, result, weightedTotal, passThreshold, componentResults, qualificationResultId: qr.rows[0].qualification_result_id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listBlockersForAttemptStart(qualificationCaseId: string) {
  // Placeholder seam for the fuller eligibility-rules engine (out of scope
  // this pass) — returns an empty blocker list today since createOrGetCase's
  // enrollment check is the only real gate implemented.
  return { eligible: true, blockers: [] as { reason: string; detail?: unknown }[] };
}

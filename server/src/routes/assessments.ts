import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool, query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import { computeComposite, type ScoreComponentInput } from "../lib/scoring.js";

export const assessmentsRouter = Router();

assessmentsRouter.get(
  "/assessment-templates",
  asyncHandler(async (req, res) => {
    const { processId } = req.query;
    const clauses = ["at.is_active"];
    const params: any[] = [];
    if (processId) {
      params.push(processId);
      clauses.push(`at.process_id = $${params.length}`);
    }
    const rows = await query(
      `SELECT at.*, sld.level_code, p.name AS process_name,
              (SELECT count(*) FROM question_bank qb WHERE qb.assessment_template_id = at.assessment_template_id)::int AS question_count,
              (SELECT count(*) FROM practical_checklist_item pci WHERE pci.assessment_template_id = at.assessment_template_id)::int AS checklist_count
       FROM assessment_template at
       JOIN skill_level_definition sld ON sld.skill_level_id = at.skill_level_id
       JOIN process p ON p.process_id = at.process_id
       WHERE ${clauses.join(" AND ")} ORDER BY p.name, sld.ordinal`,
      params
    );
    res.json(rows);
  })
);

assessmentsRouter.get(
  "/assessment-templates/:id",
  asyncHandler(async (req, res) => {
    const template = await queryOne(
      `SELECT at.*, sld.level_code, p.name AS process_name, p.process_id
       FROM assessment_template at
       JOIN skill_level_definition sld ON sld.skill_level_id = at.skill_level_id
       JOIN process p ON p.process_id = at.process_id
       WHERE at.assessment_template_id = $1`,
      [req.params.id]
    );
    if (!template) throw new ApiError(404, "Template not found");
    const questions = await query(
      `SELECT question_id, question_text, question_type, options_json, difficulty, tags FROM question_bank WHERE assessment_template_id = $1 AND is_active`,
      [req.params.id]
    );
    const checklist = await query(
      `SELECT * FROM practical_checklist_item WHERE assessment_template_id = $1 AND is_active ORDER BY sequence_no`,
      [req.params.id]
    );
    const behaviours = await query(
      `SELECT * FROM behaviour_criterion WHERE assessment_template_id = $1 ORDER BY sequence_no`,
      [req.params.id]
    );
    const roleScope = await query(
      `SELECT ars.capacity, r.role_code, r.role_name FROM assessment_template_role_scope ars
       JOIN role r ON r.role_id = ars.role_id
       WHERE ars.assessment_template_id = $1 ORDER BY ars.capacity, r.role_name`,
      [req.params.id]
    );
    res.json({ ...template, questions, checklist, behaviours, roleScope });
  })
);

assessmentsRouter.get(
  "/assessment-attempts",
  asyncHandler(async (req, res) => {
    const { workerId, status } = req.query;
    const clauses: string[] = [];
    const params: any[] = [];
    if (workerId) { params.push(workerId); clauses.push(`aa.worker_id = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`aa.status = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(
      `SELECT aa.*, at.name AS template_name, at.assessment_category, at.is_readiness_check_only, p.name AS process_name, sld.level_code,
              w.first_name, w.last_name
       FROM legacy_assessment_attempt aa
       JOIN assessment_template at ON at.assessment_template_id = aa.assessment_template_id
       JOIN process p ON p.process_id = at.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = at.skill_level_id
       JOIN worker w ON w.worker_id = aa.worker_id
       ${where} ORDER BY aa.created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

assessmentsRouter.post(
  "/assessment-attempts",
  asyncHandler(async (req, res) => {
    const { workerId, assessmentTemplateId, assessorUserId, learningPathId } = req.body;
    const priorCount = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM legacy_assessment_attempt WHERE worker_id = $1 AND assessment_template_id = $2`,
      [workerId, assessmentTemplateId]
    );
    const row = await queryOne(
      `INSERT INTO legacy_assessment_attempt (worker_id, assessment_template_id, assessor_user_id, learning_path_id, attempt_no, status, started_at)
       VALUES ($1,$2,$3,$4,$5,'in_progress', now()) RETURNING *`,
      [workerId, assessmentTemplateId, assessorUserId ?? null, learningPathId ?? null, Number(priorCount?.cnt ?? 0) + 1]
    );
    res.status(201).json(row);
  })
);

assessmentsRouter.get(
  "/assessment-attempts/:id",
  asyncHandler(async (req, res) => {
    const attempt = await queryOne(
      `SELECT aa.*, at.process_id, at.skill_level_id, at.name AS template_name, at.assessment_category, at.is_readiness_check_only,
              p.name AS process_name, sld.level_code
       FROM legacy_assessment_attempt aa
       JOIN assessment_template at ON at.assessment_template_id = aa.assessment_template_id
       JOIN process p ON p.process_id = at.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = at.skill_level_id
       WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt) throw new ApiError(404, "Attempt not found");
    const components = await query(`SELECT * FROM assessment_score_component WHERE assessment_attempt_id = $1`, [req.params.id]);
    const outcome = await queryOne(`SELECT * FROM assessment_outcome WHERE assessment_attempt_id = $1`, [req.params.id]);
    res.json({ ...attempt, components, outcome });
  })
);

assessmentsRouter.post(
  "/assessment-attempts/:id/theory-submit",
  asyncHandler(async (req, res) => {
    const { answers } = req.body as { answers: { questionId: string; selectedKeys: string[] }[] };
    const questions = await query<{ question_id: string; correct_answer_json: string[] }>(
      `SELECT qb.question_id, qb.correct_answer_json FROM question_bank qb
       JOIN legacy_assessment_attempt aa ON aa.assessment_template_id = qb.assessment_template_id
       WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    const correctById = new Map(questions.map((q) => [q.question_id, new Set(q.correct_answer_json)]));
    let correctCount = 0;
    const detail = answers.map((a) => {
      const correctSet = correctById.get(a.questionId);
      const isCorrect = !!correctSet && a.selectedKeys.length === correctSet.size && a.selectedKeys.every((k) => correctSet.has(k));
      if (isCorrect) correctCount++;
      return { questionId: a.questionId, selectedKeys: a.selectedKeys, isCorrect };
    });
    const row = await queryOne(
      `INSERT INTO assessment_score_component (assessment_attempt_id, component_type, raw_score, max_possible_score, weighted_pct, detail_json)
       VALUES ($1,'theory',$2,$3,0,$4)
       ON CONFLICT (assessment_attempt_id, component_type) DO UPDATE SET raw_score = EXCLUDED.raw_score, max_possible_score = EXCLUDED.max_possible_score, detail_json = EXCLUDED.detail_json, scored_at = now()
       RETURNING *`,
      [req.params.id, correctCount, questions.length, JSON.stringify(detail)]
    );
    res.json(row);
  })
);

assessmentsRouter.post(
  "/assessment-attempts/:id/practical-score",
  asyncHandler(async (req, res) => {
    const { items, scoredByUserId } = req.body as { items: { checklistItemId: string; score: number }[]; scoredByUserId?: string };
    const checklistItems = await query<{ checklist_item_id: string; max_score: string; is_critical: boolean; category: string; criterion_text: string; evaluator_capacity: string }>(
      `SELECT pci.checklist_item_id, pci.max_score, pci.is_critical, pci.category, pci.criterion_text, pci.evaluator_capacity FROM practical_checklist_item pci
       JOIN legacy_assessment_attempt aa ON aa.assessment_template_id = pci.assessment_template_id
       WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    const templateInfo = await queryOne<{ assessment_category: string }>(
      `SELECT at.assessment_category FROM legacy_assessment_attempt aa JOIN assessment_template at ON at.assessment_template_id = aa.assessment_template_id WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    // The component owns one evaluator_capacity snapshot (who scored it overall); a
    // SELF template's whole component is self-scored, a SUPERVISOR/TRAINER
    // template's is scored by that evaluator even though individual criteria may
    // themselves be tagged SELF (mixed criteria are preserved per-item in detail_json).
    const componentEvaluatorCapacity = templateInfo?.assessment_category === "SELF" ? "SELF" : "SUPERVISOR_ASSESSOR";
    const byId = new Map(checklistItems.map((c) => [c.checklist_item_id, c]));
    let raw = 0, max = 0, forcedFail = false;
    const detail = items.map((it) => {
      const meta = byId.get(it.checklistItemId);
      const maxScore = meta ? Number(meta.max_score) : 0;
      raw += it.score;
      max += maxScore;
      const failed = meta?.is_critical && it.score < maxScore;
      if (failed) forcedFail = true;
      return { checklistItemId: it.checklistItemId, score: it.score, maxScore, category: meta?.category, criterionText: meta?.criterion_text, evaluatorCapacity: meta?.evaluator_capacity, isCritical: !!meta?.is_critical, failed: !!failed };
    });
    const row = await queryOne(
      `INSERT INTO assessment_score_component (assessment_attempt_id, component_type, raw_score, max_possible_score, weighted_pct, detail_json, evaluator_capacity, scored_by_user_id)
       VALUES ($1,'practical',$2,$3,0,$4,$5,$6)
       ON CONFLICT (assessment_attempt_id, component_type) DO UPDATE SET raw_score = EXCLUDED.raw_score, max_possible_score = EXCLUDED.max_possible_score, detail_json = EXCLUDED.detail_json, evaluator_capacity = EXCLUDED.evaluator_capacity, scored_by_user_id = EXCLUDED.scored_by_user_id, scored_at = now()
       RETURNING *`,
      [req.params.id, raw, max, JSON.stringify({ items: detail, forcedFail }), componentEvaluatorCapacity, scoredByUserId ?? null]
    );
    res.json(row);
  })
);

assessmentsRouter.post(
  "/assessment-attempts/:id/behaviour-score",
  asyncHandler(async (req, res) => {
    const { criteria, scoredByUserId } = req.body as { criteria: { behaviourCriterionId: string; score: number }[]; scoredByUserId?: string };
    const definitions = await query<{ behaviour_criterion_id: string; max_score: string; criterion_code: string; evaluator_capacity: string }>(
      `SELECT bc.behaviour_criterion_id, bc.max_score, bc.criterion_code, bc.evaluator_capacity FROM behaviour_criterion bc
       JOIN legacy_assessment_attempt aa ON aa.assessment_template_id = bc.assessment_template_id
       WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    const templateInfo = await queryOne<{ assessment_category: string }>(
      `SELECT at.assessment_category FROM legacy_assessment_attempt aa JOIN assessment_template at ON at.assessment_template_id = aa.assessment_template_id WHERE aa.assessment_attempt_id = $1`,
      [req.params.id]
    );
    const componentEvaluatorCapacity = templateInfo?.assessment_category === "SELF" ? "SELF" : "SUPERVISOR_ASSESSOR";
    const byId = new Map(definitions.map((d) => [d.behaviour_criterion_id, d]));
    let raw = 0, max = 0;
    const detail = criteria.map((c) => {
      const meta = byId.get(c.behaviourCriterionId);
      const maxScore = meta ? Number(meta.max_score) : 0;
      raw += c.score;
      max += maxScore;
      return { behaviourCriterionId: c.behaviourCriterionId, score: c.score, maxScore, code: meta?.criterion_code, evaluatorCapacity: meta?.evaluator_capacity };
    });
    const row = await queryOne(
      `INSERT INTO assessment_score_component (assessment_attempt_id, component_type, raw_score, max_possible_score, weighted_pct, detail_json, evaluator_capacity, scored_by_user_id)
       VALUES ($1,'behaviour',$2,$3,0,$4,$5,$6)
       ON CONFLICT (assessment_attempt_id, component_type) DO UPDATE SET raw_score = EXCLUDED.raw_score, max_possible_score = EXCLUDED.max_possible_score, detail_json = EXCLUDED.detail_json, evaluator_capacity = EXCLUDED.evaluator_capacity, scored_by_user_id = EXCLUDED.scored_by_user_id, scored_at = now()
       RETURNING *`,
      [req.params.id, raw, max, JSON.stringify(detail), componentEvaluatorCapacity, scoredByUserId ?? null]
    );
    res.json(row);
  })
);

assessmentsRouter.post(
  "/assessment-attempts/:id/submit",
  asyncHandler(async (req, res) => {
    const attemptId = req.params.id;
    const attempt = await queryOne<any>(
      `SELECT aa.*, at.process_id, at.skill_level_id, at.assessment_category, at.is_readiness_check_only FROM legacy_assessment_attempt aa
       JOIN assessment_template at ON at.assessment_template_id = aa.assessment_template_id
       WHERE aa.assessment_attempt_id = $1`,
      [attemptId]
    );
    if (!attempt) throw new ApiError(404, "Attempt not found");
    const isReadinessCheck = attempt.assessment_category === "SELF" && attempt.is_readiness_check_only;

    const components = await query<any>(`SELECT * FROM assessment_score_component WHERE assessment_attempt_id = $1`, [attemptId]);
    if (components.length < 3) throw new ApiError(422, "All three components (theory, practical, behaviour) must be scored before submit");

    const weightage = await queryOne<any>(
      `SELECT * FROM assessment_weightage_config WHERE process_id = $1 AND skill_level_id = $2`,
      [attempt.process_id, attempt.skill_level_id]
    );
    if (!weightage) throw new ApiError(422, "No weightage config for this process/level");

    const scoreInputs: ScoreComponentInput[] = components.map((c) => ({
      componentType: c.component_type,
      rawScore: Number(c.raw_score),
      maxPossibleScore: Number(c.max_possible_score),
      forcedFail: c.component_type === "practical" ? !!c.detail_json?.forcedFail : false,
    }));
    const composite = computeComposite(scoreInputs, {
      theoryWeightPct: Number(weightage.theory_weight_pct),
      practicalWeightPct: Number(weightage.practical_weight_pct),
      behaviourWeightPct: Number(weightage.behaviour_weight_pct),
      passingScorePct: Number(weightage.passing_score_pct),
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const c of components) {
        await client.query(`UPDATE assessment_score_component SET weighted_pct = $1 WHERE assessment_score_component_id = $2`, [
          composite.weightedPctByComponent[c.component_type as keyof typeof composite.weightedPctByComponent],
          c.assessment_score_component_id,
        ]);
      }
      await client.query(`UPDATE legacy_assessment_attempt SET status = 'scored', submitted_at = now() WHERE assessment_attempt_id = $1`, [attemptId]);

      if (isReadinessCheck) {
        // Readiness-check attempts never produce an AssessmentOutcome or reach
        // Module 4 (01_Architecture_Overview.md §9.3) — a go/no-go signal for the
        // worker, computed with the same scoring policy but not a certifying
        // decision: no worker_process_skill update, no certificate, no retest
        // cycle, no skill_gap rows.
        await client.query("COMMIT");
        return res.json({ readinessCheck: true, passed: composite.result === "PASS", composite });
      }

      const outcomeRes = await client.query(
        `INSERT INTO assessment_outcome (assessment_attempt_id, worker_id, process_id, skill_level_id, composite_score_pct, passing_score_pct_snapshot, result)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [attemptId, attempt.worker_id, attempt.process_id, attempt.skill_level_id, composite.compositeScorePct, weightage.passing_score_pct, composite.result]
      );
      const outcome = outcomeRes.rows[0];

      if (composite.result === "PASS") {
        await client.query(
          `INSERT INTO worker_process_skill (worker_id, process_id, current_skill_level_id, attained_at, source_outcome_id)
           VALUES ($1,$2,$3,now(),$4)
           ON CONFLICT (worker_id, process_id) DO UPDATE SET current_skill_level_id = EXCLUDED.current_skill_level_id, attained_at = now(), source_outcome_id = EXCLUDED.source_outcome_id`,
          [attempt.worker_id, attempt.process_id, attempt.skill_level_id, outcome.assessment_outcome_id]
        );
        const template = await client.query(`SELECT certificate_template_id FROM certificate_template ORDER BY certificate_template_id LIMIT 1`);
        const certTemplateId = template.rows[0]?.certificate_template_id;
        if (certTemplateId) {
          await client.query(
            `INSERT INTO certificate (assessment_outcome_id, worker_id, process_id, skill_level_id, certificate_template_id, certificate_type, certificate_number, qr_verification_token, valid_from)
             VALUES ($1,$2,$3,$4,$5,'COMPETENCY_CARD',$6,$7, CURRENT_DATE)`,
            [outcome.assessment_outcome_id, attempt.worker_id, attempt.process_id, attempt.skill_level_id, certTemplateId, `CERT-${Date.now()}`, randomUUID().replace(/-/g, "")]
          );
        }
      } else {
        const policy = await client.query(
          `SELECT * FROM retest_policy WHERE process_id = $1 AND skill_level_id = $2`,
          [attempt.process_id, attempt.skill_level_id]
        );
        if (policy.rows[0]) {
          const p = policy.rows[0];
          const escalate = attempt.attempt_no >= p.max_attempts;
          const cycleRes = await client.query(
            `INSERT INTO retest_cycle (worker_id, process_id, failed_outcome_id, retest_policy_id, attempt_no, eligible_from_date, status)
             VALUES ($1,$2,$3,$4,$5, CURRENT_DATE + ($6 || ' days')::interval, $7) RETURNING *`,
            [attempt.worker_id, attempt.process_id, outcome.assessment_outcome_id, p.retest_policy_id, attempt.attempt_no, p.cooling_period_days, escalate ? "resolved_escalated" : "cooling_period"]
          );
          if (escalate) {
            await client.query(
              `INSERT INTO escalation_event (retest_cycle_id, reason) VALUES ($1,'max_attempts_exhausted')`,
              [cycleRes.rows[0].retest_cycle_id]
            );
          }
        }

        const gapIds: { gapId: string; gapType: string }[] = [];
        for (const c of components) {
          const rawPct = composite.rawPctByComponent[c.component_type as keyof typeof composite.rawPctByComponent];
          if (rawPct < Number(weightage.passing_score_pct)) {
            const gapRes = await client.query(
              `INSERT INTO skill_gap (assessment_outcome_id, worker_id, gap_type, gap_tag, magnitude_pct)
               VALUES ($1,$2,$3,$4,$5) RETURNING skill_gap_id`,
              [outcome.assessment_outcome_id, attempt.worker_id, c.component_type, c.component_type, Number(weightage.passing_score_pct) - rawPct]
            );
            gapIds.push({ gapId: gapRes.rows[0].skill_gap_id, gapType: c.component_type });
          }
        }

        if (gapIds.length > 0) {
          const pathRes = await client.query(
            `INSERT INTO learning_path (worker_id, process_id, from_skill_level_id, target_skill_level_id, generation_source, status)
             VALUES ($1,$2,$3,$3,'gap_remediation','in_progress') RETURNING *`,
            [attempt.worker_id, attempt.process_id, attempt.skill_level_id]
          );
          const path = pathRes.rows[0];
          let seq = 1;
          for (const { gapId, gapType } of gapIds) {
            const rule = await client.query(
              `SELECT grr.learning_activity_catalog_id FROM gap_remediation_rule grr
               JOIN learning_activity_catalog lac ON lac.learning_activity_catalog_id = grr.learning_activity_catalog_id
               WHERE grr.gap_type = $1 AND lac.process_id = $2 AND lac.skill_level_id = $3 AND grr.is_active
               ORDER BY grr.priority LIMIT 1`,
              [gapType, attempt.process_id, attempt.skill_level_id]
            );
            const activityId = rule.rows[0]?.learning_activity_catalog_id;
            if (!activityId) continue;
            const lpaRes = await client.query(
              `INSERT INTO learning_path_activity (learning_path_id, learning_activity_catalog_id, sequence_no, added_reason)
               VALUES ($1,$2,$3,'gap_remediation') ON CONFLICT (learning_path_id, learning_activity_catalog_id) DO NOTHING
               RETURNING learning_path_activity_id`,
              [path.learning_path_id, activityId, seq++]
            );
            const lpaId = lpaRes.rows[0]?.learning_path_activity_id;
            await client.query(
              `INSERT INTO recommended_activity (skill_gap_id, learning_path_activity_id, source) VALUES ($1,$2,'rule')`,
              [gapId, lpaId ?? null]
            );
          }
        }
      }

      await client.query("COMMIT");
      res.json({ outcome, composite });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

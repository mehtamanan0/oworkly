import { Router } from "express";
import { query, queryOne, pool } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";

export const learningPathsRouter = Router();

learningPathsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { workerId, processId, targetLevelCode, generationSource } = req.body;
    const level = await queryOne<{ skill_level_id: number }>(
      `SELECT skill_level_id FROM skill_level_definition WHERE level_code = $1`,
      [targetLevelCode]
    );
    if (!level) throw new ApiError(400, `Unknown skill level ${targetLevelCode}`);

    const current = await queryOne<{ current_skill_level_id: number | null }>(
      `SELECT current_skill_level_id FROM worker_process_skill WHERE worker_id = $1 AND process_id = $2`,
      [workerId, processId]
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pathRes = await client.query(
        `INSERT INTO learning_path (worker_id, process_id, from_skill_level_id, target_skill_level_id, generation_source, status)
         VALUES ($1,$2,$3,$4,$5,'in_progress') RETURNING *`,
        [workerId, processId, current?.current_skill_level_id ?? null, level.skill_level_id, generationSource ?? "manual"]
      );
      const path = pathRes.rows[0];

      const activities = await client.query(
        `SELECT * FROM learning_activity_catalog WHERE process_id = $1 AND skill_level_id = $2 AND is_active ORDER BY created_at`,
        [processId, level.skill_level_id]
      );
      let seq = 1;
      for (const activity of activities.rows) {
        await client.query(
          `INSERT INTO learning_path_activity (learning_path_id, learning_activity_catalog_id, sequence_no, is_mandatory)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [path.learning_path_id, activity.learning_activity_catalog_id, seq++, activity.is_mandatory_default]
        );
      }
      await client.query("COMMIT");
      res.status(201).json(path);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

learningPathsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const path = await queryOne(
      `SELECT lp.*, p.name AS process_name, w.first_name, w.last_name,
              from_l.level_code AS from_level_code, target_l.level_code AS target_level_code
       FROM learning_path lp
       JOIN process p ON p.process_id = lp.process_id
       JOIN worker w ON w.worker_id = lp.worker_id
       LEFT JOIN skill_level_definition from_l ON from_l.skill_level_id = lp.from_skill_level_id
       JOIN skill_level_definition target_l ON target_l.skill_level_id = lp.target_skill_level_id
       WHERE lp.learning_path_id = $1`,
      [req.params.id]
    );
    if (!path) throw new ApiError(404, "Learning path not found");
    const activities = await query(
      `SELECT lpa.*, lac.title, lac.activity_type, lac.description, lac.evidence_type_required,
              lac.min_completion_pct, lac.requires_assessment, lac.linked_assessment_template_id,
              ac.completed_at, ac.completion_notes, ac.completion_pct, ac.linked_assessment_attempt_id
       FROM learning_path_activity lpa
       JOIN learning_activity_catalog lac ON lac.learning_activity_catalog_id = lpa.learning_activity_catalog_id
       LEFT JOIN activity_completion ac ON ac.learning_path_activity_id = lpa.learning_path_activity_id
       WHERE lpa.learning_path_id = $1 ORDER BY lpa.sequence_no`,
      [req.params.id]
    );
    res.json({ ...path, activities });
  })
);

learningPathsRouter.get(
  "/:id/eligibility",
  asyncHandler(async (req, res) => {
    const totalMandatory = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM learning_path_activity WHERE learning_path_id = $1 AND is_mandatory`,
      [req.params.id]
    );
    const completedMandatory = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM learning_path_activity lpa
       JOIN activity_completion ac ON ac.learning_path_activity_id = lpa.learning_path_activity_id
       WHERE lpa.learning_path_id = $1 AND lpa.is_mandatory`,
      [req.params.id]
    );
    const total = Number(totalMandatory?.cnt ?? 0);
    const completed = Number(completedMandatory?.cnt ?? 0);
    const eligible = total > 0 && completed === total;
    if (eligible) {
      await query(`UPDATE learning_path SET status = 'eligible_for_assessment', updated_at = now() WHERE learning_path_id = $1 AND status = 'in_progress'`, [req.params.id]);
    }
    res.json({ totalMandatory: total, completedMandatory: completed, eligible });
  })
);

learningPathsRouter.post(
  "/activities/:learningPathActivityId/completions",
  asyncHandler(async (req, res) => {
    const { completedByWorkerId, completionNotes, completionPct } = req.body;
    const row = await queryOne(
      `INSERT INTO activity_completion (learning_path_activity_id, completed_by_worker_id, completion_notes, completion_pct)
       VALUES ($1,$2,$3,COALESCE($4,100))
       RETURNING *`,
      [req.params.learningPathActivityId, completedByWorkerId, completionNotes ?? null, completionPct ?? null]
    );
    res.status(201).json(row);
  })
);

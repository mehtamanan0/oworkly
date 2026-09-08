import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";

export const gapAnalysisRouter = Router();

gapAnalysisRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { workerId, status } = req.query;
    const clauses: string[] = [];
    const params: any[] = [];
    if (workerId) { params.push(workerId); clauses.push(`sg.worker_id = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`sg.status = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(
      `SELECT sg.*, p.name AS process_name, w.first_name, w.last_name
       FROM skill_gap sg
       JOIN assessment_outcome ao ON ao.assessment_outcome_id = sg.assessment_outcome_id
       JOIN process p ON p.process_id = ao.process_id
       JOIN worker w ON w.worker_id = sg.worker_id
       ${where} ORDER BY sg.identified_at DESC`,
      params
    );
    res.json(rows);
  })
);

gapAnalysisRouter.get(
  "/:id/recommended-activities",
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT ra.*, lac.title, lac.activity_type, lac.description
       FROM recommended_activity ra
       LEFT JOIN learning_path_activity lpa ON lpa.learning_path_activity_id = ra.learning_path_activity_id
       LEFT JOIN learning_activity_catalog lac ON lac.learning_activity_catalog_id = lpa.learning_activity_catalog_id
       WHERE ra.skill_gap_id = $1 ORDER BY ra.created_at`,
      [req.params.id]
    );
    res.json(rows);
  })
);

export const recommendedActivitiesRouter = Router();

recommendedActivitiesRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { approvedByUserId } = req.body;
    const row = await queryOne(
      `UPDATE recommended_activity SET approved_by_user_id = $1 WHERE recommended_activity_id = $2 RETURNING *`,
      [approvedByUserId, req.params.id]
    );
    if (!row) throw new ApiError(404, "Recommended activity not found");
    res.json(row);
  })
);

import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";

export const retestRouter = Router();

retestRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { workerId, status } = req.query;
    const clauses: string[] = [];
    const params: any[] = [];
    if (workerId) { params.push(workerId); clauses.push(`rc.worker_id = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`rc.status = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(
      `SELECT rc.*, p.name AS process_name, w.first_name, w.last_name, sld.level_code
       FROM retest_cycle rc
       JOIN process p ON p.process_id = rc.process_id
       JOIN worker w ON w.worker_id = rc.worker_id
       JOIN assessment_outcome ao ON ao.assessment_outcome_id = rc.failed_outcome_id
       JOIN skill_level_definition sld ON sld.skill_level_id = ao.skill_level_id
       ${where} ORDER BY rc.eligible_from_date`,
      params
    );
    res.json(rows);
  })
);

retestRouter.post(
  "/:id/schedule",
  asyncHandler(async (req, res) => {
    const cycle = await queryOne<any>(`SELECT * FROM retest_cycle WHERE retest_cycle_id = $1`, [req.params.id]);
    if (!cycle) throw new ApiError(404, "Retest cycle not found");
    if (new Date(cycle.eligible_from_date) > new Date()) {
      throw new ApiError(422, `Not eligible until ${cycle.eligible_from_date}`);
    }
    const row = await queryOne(
      `UPDATE retest_cycle SET status = 'attempt_scheduled' WHERE retest_cycle_id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(row);
  })
);

export const escalationsRouter = Router();

escalationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const where = status === "open" ? "WHERE ee.resolved_at IS NULL" : "";
    const rows = await query(
      `SELECT ee.*, rc.worker_id, rc.process_id, w.first_name, w.last_name, p.name AS process_name
       FROM escalation_event ee
       JOIN retest_cycle rc ON rc.retest_cycle_id = ee.retest_cycle_id
       JOIN worker w ON w.worker_id = rc.worker_id
       JOIN process p ON p.process_id = rc.process_id
       ${where} ORDER BY ee.raised_at DESC`,
      []
    );
    res.json(rows);
  })
);

escalationsRouter.post(
  "/:id/resolve",
  asyncHandler(async (req, res) => {
    const { resolution, resolutionNotes } = req.body;
    const row = await queryOne(
      `UPDATE escalation_event SET resolution = $1, resolution_notes = $2, resolved_at = now() WHERE escalation_event_id = $3 RETURNING *`,
      [resolution, resolutionNotes ?? null, req.params.id]
    );
    if (!row) throw new ApiError(404, "Escalation not found");
    res.json(row);
  })
);

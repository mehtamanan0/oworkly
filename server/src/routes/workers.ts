import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";

export const workersRouter = Router();

workersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { orgUnitId, status, q } = req.query;
    const clauses: string[] = [];
    const params: any[] = [];
    if (orgUnitId) {
      params.push(orgUnitId);
      clauses.push(`w.org_unit_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`w.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      clauses.push(`(lower(w.first_name || ' ' || coalesce(w.last_name,'')) LIKE $${params.length} OR w.hrms_employee_code LIKE $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query(
      `SELECT w.*, ou.name AS org_unit_name, jr.name AS job_role_name,
              (SELECT count(*) FROM worker_process_skill wps WHERE wps.worker_id = w.worker_id) AS process_count
       FROM worker w
       JOIN org_unit ou ON ou.org_unit_id = w.org_unit_id
       LEFT JOIN job_role jr ON jr.job_role_id = w.primary_job_role_id
       ${where}
       ORDER BY w.first_name, w.last_name
       LIMIT 500`,
      params
    );
    res.json(rows);
  })
);

workersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const worker = await queryOne(
      `SELECT w.*, ou.name AS org_unit_name, jr.name AS job_role_name
       FROM worker w JOIN org_unit ou ON ou.org_unit_id = w.org_unit_id
       LEFT JOIN job_role jr ON jr.job_role_id = w.primary_job_role_id
       WHERE w.worker_id = $1`,
      [req.params.id]
    );
    if (!worker) throw new ApiError(404, "Worker not found");

    const skills = await query(
      `SELECT wps.*, p.name AS process_name, p.is_critical, sld.level_code, sld.label AS level_label, sld.color_hex
       FROM worker_process_skill wps
       JOIN process p ON p.process_id = wps.process_id
       LEFT JOIN skill_level_definition sld ON sld.skill_level_id = wps.current_skill_level_id
       WHERE wps.worker_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    const learningPaths = await query(
      `SELECT lp.*, p.name AS process_name, sld.level_code AS target_level_code
       FROM learning_path lp JOIN process p ON p.process_id = lp.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = lp.target_skill_level_id
       WHERE lp.worker_id = $1 ORDER BY lp.created_at DESC`,
      [req.params.id]
    );
    const certificates = await query(
      `SELECT c.*, p.name AS process_name, sld.level_code
       FROM certificate c JOIN process p ON p.process_id = c.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = c.skill_level_id
       WHERE c.worker_id = $1 ORDER BY c.issued_at DESC`,
      [req.params.id]
    );
    const skillGaps = await query(
      `SELECT sg.*, ao.process_id, p.name AS process_name
       FROM skill_gap sg
       JOIN assessment_outcome ao ON ao.assessment_outcome_id = sg.assessment_outcome_id
       JOIN process p ON p.process_id = ao.process_id
       WHERE sg.worker_id = $1 ORDER BY sg.identified_at DESC`,
      [req.params.id]
    );
    const retestCycles = await query(
      `SELECT rc.*, p.name AS process_name FROM retest_cycle rc
       JOIN process p ON p.process_id = rc.process_id
       WHERE rc.worker_id = $1 ORDER BY rc.created_at DESC`,
      [req.params.id]
    );
    res.json({ ...worker, skills, learningPaths, certificates, skillGaps, retestCycles });
  })
);

workersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { firstName, lastName, orgUnitId, primaryJobRoleId, employmentType, hrmsEmployeeCode } = req.body;
    const row = await queryOne(
      `INSERT INTO worker (first_name, last_name, org_unit_id, primary_job_role_id, employment_type, hrms_employee_code)
       VALUES ($1,$2,$3,$4,COALESCE($5,'permanent'),$6) RETURNING *`,
      [firstName, lastName ?? null, orgUnitId, primaryJobRoleId ?? null, employmentType ?? null, hrmsEmployeeCode ?? null]
    );
    res.status(201).json(row);
  })
);

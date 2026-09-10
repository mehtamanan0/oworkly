import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";

export const outcomesRouter = Router();

outcomesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const outcome = await queryOne(
      `SELECT ao.*, w.first_name, w.last_name, p.name AS process_name, sld.level_code
       FROM assessment_outcome ao
       JOIN worker w ON w.worker_id = ao.worker_id
       JOIN process p ON p.process_id = ao.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = ao.skill_level_id
       WHERE ao.assessment_outcome_id = $1`,
      [req.params.id]
    );
    if (!outcome) throw new ApiError(404, "Outcome not found");
    res.json({ ...outcome, components: [] });
  })
);

export const certificatesRouter = Router();

certificatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params: any[] = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE c.status = $${params.length}`;
    }
    const rows = await query(
      `SELECT c.*, w.first_name, w.last_name, w.hrms_employee_code, p.name AS process_name, sld.level_code
       FROM certificate c
       JOIN worker w ON w.worker_id = c.worker_id
       JOIN process p ON p.process_id = c.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = c.skill_level_id
       ${where} ORDER BY c.issued_at DESC`,
      params
    );
    res.json(rows);
  })
);

certificatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const cert = await queryOne(
      `SELECT c.*, w.first_name, w.last_name, w.hrms_employee_code, p.name AS process_name, sld.level_code, sld.label AS level_label
       FROM certificate c
       JOIN worker w ON w.worker_id = c.worker_id
       JOIN process p ON p.process_id = c.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = c.skill_level_id
       WHERE c.certificate_id = $1`,
      [req.params.id]
    );
    if (!cert) throw new ApiError(404, "Certificate not found");
    res.json(cert);
  })
);

certificatesRouter.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const row = await queryOne(
      `UPDATE certificate SET status = 'revoked', revoked_reason = $1 WHERE certificate_id = $2 RETURNING *`,
      [reason ?? null, req.params.id]
    );
    if (!row) throw new ApiError(404, "Certificate not found");
    res.json(row);
  })
);

export const publicRouter = Router();

publicRouter.get(
  "/verify/:qrToken",
  asyncHandler(async (req, res) => {
    const cert = await queryOne(
      `SELECT c.certificate_number, c.certificate_type, c.status, c.issued_at, c.valid_from, c.valid_to,
              w.first_name, w.last_name, p.name AS process_name, sld.level_code, sld.label AS level_label
       FROM certificate c
       JOIN worker w ON w.worker_id = c.worker_id
       JOIN process p ON p.process_id = c.process_id
       JOIN skill_level_definition sld ON sld.skill_level_id = c.skill_level_id
       WHERE c.qr_verification_token = $1`,
      [req.params.qrToken]
    );
    if (!cert) throw new ApiError(404, "Certificate not found or invalid token");
    res.json(cert);
  })
);

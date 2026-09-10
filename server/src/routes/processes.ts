import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { ApiError } from "../lib/asyncHandler.js";

export const processesRouter = Router();

processesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { orgUnitId, criticalOnly } = req.query;
    const clauses = ["p.is_active"];
    const params: any[] = [];
    if (orgUnitId) {
      params.push(orgUnitId);
      clauses.push(`p.org_unit_id = $${params.length}`);
    }
    if (criticalOnly === "true") clauses.push("p.is_critical");
    const rows = await query(
      `SELECT p.*, ou.name AS org_unit_name, ou.unit_type AS org_unit_type
       FROM process p JOIN org_unit ou ON ou.org_unit_id = p.org_unit_id
       WHERE ${clauses.join(" AND ")} ORDER BY ou.name, p.code`,
      params
    );
    res.json(rows);
  })
);

processesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const process = await queryOne(
      `SELECT p.*, ou.name AS org_unit_name FROM process p JOIN org_unit ou ON ou.org_unit_id = p.org_unit_id WHERE p.process_id = $1`,
      [req.params.id]
    );
    if (!process) throw new ApiError(404, "Process not found");
    const framework = await query(
      `SELECT cf.*, sld.level_code, sld.label FROM competency_framework cf
       JOIN skill_level_definition sld ON sld.skill_level_id = cf.skill_level_id
       WHERE cf.process_id = $1 ORDER BY sld.ordinal`,
      [req.params.id]
    );
    const retestPolicies = await query(
      `SELECT rp.*, sld.level_code FROM retest_policy rp
       JOIN skill_level_definition sld ON sld.skill_level_id = rp.skill_level_id
       WHERE rp.process_id = $1 ORDER BY sld.ordinal`,
      [req.params.id]
    );
    res.json({ ...process, competencyFramework: framework, retestPolicies });
  })
);

processesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { orgUnitId, code, name, isCritical } = req.body;
    const row = await queryOne(
      `INSERT INTO process (org_unit_id, code, name, is_critical) VALUES ($1,$2,$3,$4) RETURNING *`,
      [orgUnitId, code, name, !!isCritical]
    );
    res.status(201).json(row);
  })
);

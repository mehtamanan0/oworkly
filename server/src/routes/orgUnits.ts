import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const orgUnitsRouter = Router();

orgUnitsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { parentId } = req.query;
    const rows = parentId
      ? await query(
          `SELECT * FROM org_unit WHERE parent_org_unit_id = $1 AND is_active ORDER BY name`,
          [parentId]
        )
      : await query(`SELECT * FROM org_unit WHERE is_active ORDER BY unit_type, name`);
    res.json(rows);
  })
);

orgUnitsRouter.get(
  "/tree",
  asyncHandler(async (_req, res) => {
    const rows = await query(`SELECT * FROM org_unit WHERE is_active ORDER BY unit_type, name`);
    const byId = new Map(rows.map((r: any) => [r.org_unit_id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const r of byId.values()) {
      if (r.parent_org_unit_id && byId.has(r.parent_org_unit_id)) {
        byId.get(r.parent_org_unit_id)!.children.push(r);
      } else {
        roots.push(r);
      }
    }
    res.json(roots);
  })
);

orgUnitsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { parentOrgUnitId, unitType, code, name } = req.body;
    const row = await queryOne(
      `INSERT INTO org_unit (parent_org_unit_id, unit_type, code, name) VALUES ($1,$2,$3,$4) RETURNING *`,
      [parentOrgUnitId ?? null, unitType, code, name]
    );
    res.status(201).json(row);
  })
);

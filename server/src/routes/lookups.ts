import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const skillLevelsRouter = Router();
skillLevelsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(`SELECT * FROM skill_level_definition ORDER BY ordinal`));
  })
);

export const jobRolesRouter = Router();
jobRolesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(`SELECT * FROM job_role WHERE is_active ORDER BY name`));
  })
);

export const rolesRouter = Router();
rolesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(`SELECT * FROM role ORDER BY role_id`));
  })
);

export const usersRouter = Router();
usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await query(`
      SELECT u.user_id, u.email, u.display_name, u.worker_id,
             array_agg(r.role_code) AS role_codes
      FROM app_user u
      JOIN user_role ur ON ur.user_id = u.user_id
      JOIN role r ON r.role_id = ur.role_id
      WHERE u.is_active
      GROUP BY u.user_id
      ORDER BY u.display_name
    `);
    res.json(rows);
  })
);

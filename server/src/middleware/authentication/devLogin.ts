// A clearly-isolated development authentication adapter — the spec explicitly
// allows this in place of a real OIDC provider ("If a real OIDC provider is
// unavailable during development, implement a clearly isolated development
// authentication adapter"). It is a username lookup against seeded app_user
// rows, NOT a password check — hard-disabled outside development/test via
// config.devAuthActuallyEnabled (checked in index.ts before this router is
// even mounted, and re-checked here as defense in depth).
import { Router } from "express";
import { config } from "../../config/index.js";
import { query, queryOne } from "../../db.js";
import { asyncHandler, ApiError } from "../../lib/asyncHandler.js";
import { signAccessToken } from "./jwt.js";

export const devLoginRouter = Router();

devLoginRouter.post(
  "/dev-login",
  asyncHandler(async (req, res) => {
    if (!config.devAuthActuallyEnabled) {
      throw new ApiError(403, "Dev auth is disabled in this environment");
    }
    const { username } = req.body as { username?: string };
    if (!username) throw new ApiError(400, "username is required");

    const user = await queryOne<{ user_id: string; display_name: string; worker_id: string | null }>(
      `SELECT user_id, display_name, worker_id FROM app_user WHERE external_idp_subject = $1 OR email = $1`,
      [username]
    );
    if (!user) throw new ApiError(401, "Unknown demo username");

    const roleRows = await query<{ role_code: string; company_id: string }>(
      `SELECT r.role_code, ur.company_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1`,
      [user.user_id]
    );
    if (roleRows.length === 0) throw new ApiError(403, "User has no role assignments");

    // A user with a role assignment scoped to more than one distinct company
    // is treated as effectively platform-wide for this dev adapter (matches
    // e.g. a Platform Admin who isn't tied to one company); otherwise they're
    // scoped to their single company.
    const distinctCompanies = [...new Set(roleRows.map((r) => r.company_id))];
    const companyId = distinctCompanies.length === 1 ? distinctCompanies[0] : null;

    const currentUser = {
      userId: user.user_id,
      companyId,
      roles: [...new Set(roleRows.map((r) => r.role_code))],
      workerId: user.worker_id,
      displayName: user.display_name,
    };
    res.json({ accessToken: signAccessToken(currentUser), user: currentUser });
  })
);

devLoginRouter.get(
  "/dev-users",
  asyncHandler(async (_req, res) => {
    if (!config.devAuthActuallyEnabled) throw new ApiError(403, "Dev auth is disabled in this environment");
    const rows = await query(
      `SELECT u.external_idp_subject AS username, u.display_name,
              array_agg(DISTINCT r.role_code) AS roles,
              array_agg(DISTINCT c.code) AS companies
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
       JOIN company c ON c.company_id = ur.company_id
       WHERE u.external_idp_subject IS NOT NULL
       GROUP BY u.user_id ORDER BY u.display_name`
    );
    res.json(rows);
  })
);

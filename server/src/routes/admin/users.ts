// M10: account deactivation/reactivation/admin password reset. Mounted at
// /v2 alongside the other admin routers.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole } from "../../middleware/authorization/index.js";
import * as userAdmin from "../../application/services/userAdminService.js";

export const userAdminRouter = Router();
const requireUserAdmin = requireRole("ADMIN");
const requireUserRead = requireRole("ADMIN", "LND_TEAM");

userAdminRouter.get(
  "/companies/:companyId/users",
  requireUserRead,
  asyncHandler(async (req, res) => {
    res.json(await userAdmin.listUsers(req.params.companyId, req.currentUser!));
  })
);
userAdminRouter.post(
  "/users/:id/deactivate",
  requireUserAdmin,
  asyncHandler(async (req, res) => {
    res.json(await userAdmin.deactivateUser(req.params.id, req.currentUser!, req.body?.reason));
  })
);
userAdminRouter.post(
  "/users/:id/reactivate",
  requireUserAdmin,
  asyncHandler(async (req, res) => {
    res.json(await userAdmin.reactivateUser(req.params.id, req.currentUser!));
  })
);
userAdminRouter.post(
  "/users/:id/reset-password",
  requireUserAdmin,
  asyncHandler(async (req, res) => {
    res.json(await userAdmin.resetPassword(req.params.id, req.currentUser!));
  })
);

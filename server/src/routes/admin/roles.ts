// M11: role/permission administration. Mounted at /v2 alongside the other
// admin routers.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole, requirePlatformAdmin } from "../../middleware/authorization/index.js";
import * as roleAdmin from "../../application/services/roleAdminService.js";

export const roleAdminRouter = Router();
const requireRoleAdminRead = requireRole("ADMIN", "LND_TEAM");
const requireUserAdmin = requireRole("ADMIN");

roleAdminRouter.get(
  "/roles",
  requireRoleAdminRead,
  asyncHandler(async (_req, res) => {
    res.json(await roleAdmin.listRoles());
  })
);
roleAdminRouter.get(
  "/permissions",
  requireRoleAdminRead,
  asyncHandler(async (_req, res) => {
    res.json(await roleAdmin.listPermissions());
  })
);
roleAdminRouter.post(
  "/roles",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await roleAdmin.createRole(req.body, req.currentUser!));
  })
);
roleAdminRouter.patch(
  "/roles/:id",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json(await roleAdmin.updateRole(Number(req.params.id), req.body, req.currentUser!));
  })
);
roleAdminRouter.post(
  "/roles/:id/permissions",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json(await roleAdmin.setRolePermissions(Number(req.params.id), req.body?.permissionCodes ?? [], req.currentUser!));
  })
);
roleAdminRouter.post(
  "/users/:userId/roles",
  requireUserAdmin,
  asyncHandler(async (req, res) => {
    const { roleCode, companyId, orgUnitId } = req.body as { roleCode?: string; companyId?: string; orgUnitId?: string };
    res.status(201).json(await roleAdmin.assignRole(req.params.userId, roleCode ?? "", companyId ?? "", orgUnitId ?? "", req.currentUser!));
  })
);
roleAdminRouter.delete(
  "/users/:userId/roles/:roleId",
  requireUserAdmin,
  asyncHandler(async (req, res) => {
    res.json(await roleAdmin.removeRole(req.params.userId, Number(req.params.roleId), req.currentUser!));
  })
);

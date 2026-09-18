// Company (tenant) lifecycle admin routes. Mounted at /v2 behind
// `authenticate` (see app.ts) — the existing read-only GET /companies and
// GET /companies/:id/hierarchy stay in masterDataV2.ts untouched; this file
// only adds the write surface.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole, requirePlatformAdmin } from "../../middleware/authorization/index.js";
import * as companyAdmin from "../../application/services/companyAdminService.js";

export const companiesAdminRouter = Router();

companiesAdminRouter.post(
  "/companies",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await companyAdmin.createCompany(req.body, req.currentUser!));
  })
);

companiesAdminRouter.patch(
  "/companies/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(await companyAdmin.updateCompany(req.params.id, req.body, req.currentUser!));
  })
);

companiesAdminRouter.get(
  "/companies/:id/activation-checklist",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(await companyAdmin.getActivationChecklist(req.params.id, req.currentUser!));
  })
);

companiesAdminRouter.post(
  "/companies/:id/activate",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json(await companyAdmin.activateCompany(req.params.id, req.currentUser!));
  })
);

companiesAdminRouter.post(
  "/companies/:id/deactivate",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json(await companyAdmin.deactivateCompany(req.params.id, req.body?.reason, req.currentUser!));
  })
);

companiesAdminRouter.get(
  "/companies/:id/audit",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(await companyAdmin.getCompanyAuditHistory(req.params.id, req.currentUser!));
  })
);

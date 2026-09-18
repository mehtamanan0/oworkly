// Org hierarchy authoring: level types, org_unit nodes, head-of-unit
// assignment history. Mounted at /v2 behind `authenticate`; the existing
// read-only GET /companies/:id/hierarchy stays in masterDataV2.ts untouched.
import { Router } from "express";
import { asyncHandler, ApiError } from "../../lib/asyncHandler.js";
import { queryOne } from "../../db.js";
import { requireRole } from "../../middleware/authorization/index.js";
import * as orgAdmin from "../../application/services/orgHierarchyAdminService.js";

export const orgHierarchyAdminRouter = Router();
const requireOrgAdmin = requireRole("ADMIN", "LND_TEAM");

// ---- Level types ----
orgHierarchyAdminRouter.post(
  "/companies/:companyId/org-level-types",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await orgAdmin.createLevelType(req.params.companyId, req.body, req.currentUser!));
  })
);
orgHierarchyAdminRouter.patch(
  "/org-level-types/:id",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.updateLevelType(req.params.id, req.body, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/companies/:companyId/org-level-types/reorder",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.reorderLevelTypes(req.params.companyId, req.body?.orderedIds, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-level-types/:id/activate",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.setLevelTypeActive(req.params.id, true, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-level-types/:id/deactivate",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.setLevelTypeActive(req.params.id, false, req.currentUser!));
  })
);

// ---- Nodes ----
orgHierarchyAdminRouter.post(
  "/companies/:companyId/org-units",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await orgAdmin.createOrgUnit(req.params.companyId, req.body, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-units/:id/children",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    // The parent node (:id) already carries the company scope — the caller
    // never has to know or pass it separately.
    const parent = await queryOne<{ company_id: string }>(`SELECT company_id FROM org_unit WHERE org_unit_id = $1`, [req.params.id]);
    if (!parent) throw new ApiError(404, "Parent organisation node not found");
    const child = await orgAdmin.createOrgUnit(parent.company_id, { ...req.body, parentOrgUnitId: req.params.id }, req.currentUser!);
    res.status(201).json(child);
  })
);
orgHierarchyAdminRouter.patch(
  "/org-units/:id",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.updateOrgUnit(req.params.id, req.body, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-units/:id/archive",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.archiveOrgUnit(req.params.id, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-units/:id/restore",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.restoreOrgUnit(req.params.id, req.currentUser!));
  })
);

// ---- Head-of-unit assignment (history) ----
orgHierarchyAdminRouter.get(
  "/org-units/:id/head-assignments",
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.listHeadHistory(req.params.id, req.currentUser!));
  })
);
orgHierarchyAdminRouter.post(
  "/org-units/:id/head-assignments",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await orgAdmin.assignHead(req.params.id, req.body, req.currentUser!));
  })
);
orgHierarchyAdminRouter.patch(
  "/head-assignments/:id/end",
  requireOrgAdmin,
  asyncHandler(async (req, res) => {
    res.json(await orgAdmin.endHeadAssignment(req.params.id, req.body, req.currentUser!));
  })
);

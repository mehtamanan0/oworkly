// Product Master admin routes. Mounted at /v2 alongside the other admin
// routers.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole } from "../../middleware/authorization/index.js";
import * as productAdmin from "../../application/services/productAdminService.js";

export const productAdminRouter = Router();
const requireProductAdmin = requireRole("ADMIN", "LND_TEAM");

productAdminRouter.get(
  "/companies/:companyId/products",
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
    res.json(await productAdmin.listProducts(req.params.companyId, req.currentUser!, includeInactive));
  })
);
productAdminRouter.post(
  "/companies/:companyId/products",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await productAdmin.createProduct(req.params.companyId, req.body, req.currentUser!));
  })
);
productAdminRouter.patch(
  "/products/:id",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.updateProduct(req.params.id, req.body, req.currentUser!));
  })
);
productAdminRouter.post(
  "/products/:id/archive",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.archiveProduct(req.params.id, req.currentUser!));
  })
);
productAdminRouter.post(
  "/products/:id/restore",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.restoreProduct(req.params.id, req.currentUser!));
  })
);

productAdminRouter.get(
  "/products/:id/links",
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.listLinks(req.params.id, req.currentUser!));
  })
);
productAdminRouter.post(
  "/products/:id/organisation-links",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await productAdmin.linkOrgUnit(req.params.id, req.body?.orgUnitId, req.currentUser!));
  })
);
productAdminRouter.delete(
  "/products/:id/organisation-links/:linkId",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.unlinkOrgUnit(req.params.linkId, req.currentUser!));
  })
);
productAdminRouter.post(
  "/products/:id/process-links",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await productAdmin.linkProcess(req.params.id, req.body?.processId, req.currentUser!));
  })
);
productAdminRouter.delete(
  "/products/:id/process-links/:linkId",
  requireProductAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productAdmin.unlinkProcess(req.params.linkId, req.currentUser!));
  })
);

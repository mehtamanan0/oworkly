// Process / process-level authoring + level progression rules. Mounted at
// /v2 alongside the other admin routers; the existing read-only
// GET /processes and GET /processes/:id/levels stay in masterDataV2.ts.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole } from "../../middleware/authorization/index.js";
import * as processAdmin from "../../application/services/processAdminService.js";

export const processAdminRouter = Router();
const requireProcessAdmin = requireRole("ADMIN", "LND_TEAM");

processAdminRouter.post(
  "/companies/:companyId/processes",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await processAdmin.createProcess(req.params.companyId, req.body, req.currentUser!));
  })
);
processAdminRouter.patch(
  "/processes/:id",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.updateProcess(req.params.id, req.body, req.currentUser!));
  })
);
processAdminRouter.post(
  "/processes/:id/archive",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.archiveProcess(req.params.id, req.currentUser!));
  })
);

processAdminRouter.post(
  "/processes/:id/levels",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await processAdmin.createProcessLevel(req.params.id, req.body, req.currentUser!));
  })
);
processAdminRouter.patch(
  "/process-levels/:id",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.updateProcessLevel(req.params.id, req.body, req.currentUser!));
  })
);
processAdminRouter.post(
  "/process-levels/:id/archive",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.archiveProcessLevel(req.params.id, req.currentUser!));
  })
);
processAdminRouter.post(
  "/process-levels/:id/restore",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.restoreProcessLevel(req.params.id, req.currentUser!));
  })
);

processAdminRouter.get(
  "/process-levels/:id/progression-rules",
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.listProgressionRules(req.params.id, req.currentUser!));
  })
);
processAdminRouter.post(
  "/process-levels/:id/progression-rules",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await processAdmin.createProgressionRule(req.params.id, req.body, req.currentUser!));
  })
);
processAdminRouter.patch(
  "/progression-rules/:id",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.updateProgressionRule(req.params.id, req.body, req.currentUser!));
  })
);
processAdminRouter.delete(
  "/progression-rules/:id",
  requireProcessAdmin,
  asyncHandler(async (req, res) => {
    res.json(await processAdmin.deleteProgressionRule(req.params.id, req.currentUser!));
  })
);

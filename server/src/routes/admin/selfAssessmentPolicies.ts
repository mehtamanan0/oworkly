// M9: self-assessment visibility policy admin routes. Mounted at /v2
// alongside the other admin routers.
import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireRole } from "../../middleware/authorization/index.js";
import * as policySvc from "../../application/services/selfAssessmentPolicyService.js";

export const selfAssessmentPolicyRouter = Router();
const requirePolicyAdmin = requireRole("ADMIN", "LND_TEAM");

selfAssessmentPolicyRouter.get(
  "/companies/:companyId/self-assessment-policies/resolve",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    const { processId, processLevelId, assessmentTemplateId } = req.query as Record<string, string | undefined>;
    res.json(await policySvc.resolvePolicy(req.params.companyId, { processId, processLevelId, assessmentTemplateId }));
  })
);
selfAssessmentPolicyRouter.get(
  "/companies/:companyId/self-assessment-policies",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
    res.json(await policySvc.listPolicies(req.params.companyId, req.currentUser!, includeInactive));
  })
);
selfAssessmentPolicyRouter.post(
  "/companies/:companyId/self-assessment-policies",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await policySvc.createPolicy(req.params.companyId, req.body, req.currentUser!));
  })
);
selfAssessmentPolicyRouter.patch(
  "/self-assessment-policies/:id",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    res.json(await policySvc.updatePolicy(req.params.id, req.body, req.currentUser!));
  })
);
selfAssessmentPolicyRouter.post(
  "/self-assessment-policies/:id/archive",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    res.json(await policySvc.archivePolicy(req.params.id, req.currentUser!));
  })
);
selfAssessmentPolicyRouter.post(
  "/self-assessment-policies/:id/restore",
  requirePolicyAdmin,
  asyncHandler(async (req, res) => {
    res.json(await policySvc.restorePolicy(req.params.id, req.currentUser!));
  })
);

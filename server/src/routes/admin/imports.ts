// M13/M14: shared master-data import routes (organisation + worker).
// Mounted at /v2 alongside the other admin routers.
import { Router } from "express";
import multer from "multer";
import { asyncHandler, ApiError } from "../../lib/asyncHandler.js";
import { requirePermission } from "../../middleware/authorization/index.js";
import * as importService from "../../application/services/importService.js";
import * as orgImport from "../../application/services/organisationImportService.js";
import * as workerImport from "../../application/services/workerImportService.js";

export const importsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const requireImportRead = requirePermission("import.read");
const requireImportCreate = requirePermission("import.create");
const requireImportValidate = requirePermission("import.validate");
const requireImportPublish = requirePermission("import.publish");

importsRouter.get(
  "/import-templates/organisation",
  requireImportRead,
  (_req, res) => {
    res.type("text/csv").send(orgImport.organisationImportTemplate());
  }
);
importsRouter.get(
  "/import-templates/workers",
  requireImportRead,
  (_req, res) => {
    res.type("text/csv").send(workerImport.workerImportTemplate());
  }
);

importsRouter.get(
  "/companies/:companyId/imports",
  requireImportRead,
  asyncHandler(async (req, res) => {
    const importType = req.query.type as "ORGANISATION" | "WORKER" | undefined;
    res.json(await importService.listBatches(req.params.companyId, importType, req.currentUser!));
  })
);

importsRouter.post(
  "/companies/:companyId/imports/organisation",
  requireImportCreate,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "A CSV file is required (multipart field: file)");
    res.status(201).json(await orgImport.uploadOrganisationImport(req.params.companyId, req.file.originalname, req.file.buffer, req.currentUser!));
  })
);
importsRouter.post(
  "/companies/:companyId/imports/workers",
  requireImportCreate,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "A CSV file is required (multipart field: file)");
    res.status(201).json(await workerImport.uploadWorkerImport(req.params.companyId, req.file.originalname, req.file.buffer, req.currentUser!));
  })
);

importsRouter.get(
  "/imports/:id",
  requireImportRead,
  asyncHandler(async (req, res) => {
    res.json(await importService.loadBatch(req.params.id, req.currentUser!));
  })
);
importsRouter.get(
  "/imports/:id/result",
  requireImportRead,
  asyncHandler(async (req, res) => {
    res.json(await importService.loadBatch(req.params.id, req.currentUser!));
  })
);
importsRouter.get(
  "/imports/:id/errors",
  requireImportRead,
  asyncHandler(async (req, res) => {
    await importService.loadBatch(req.params.id, req.currentUser!); // 403/404 + company scope
    res.json(await importService.listErrors(req.params.id));
  })
);

importsRouter.post(
  "/imports/:id/validate",
  requireImportValidate,
  asyncHandler(async (req, res) => {
    const batch = await importService.loadBatch(req.params.id, req.currentUser!);
    const result = batch.import_type === "ORGANISATION"
      ? await orgImport.validateOrganisationImport(req.params.id, req.currentUser!)
      : await workerImport.validateWorkerImport(req.params.id, req.currentUser!);
    res.json(result);
  })
);
importsRouter.post(
  "/imports/:id/publish",
  requireImportPublish,
  asyncHandler(async (req, res) => {
    const batch = await importService.loadBatch(req.params.id, req.currentUser!);
    const result = batch.import_type === "ORGANISATION"
      ? await orgImport.publishOrganisationImport(req.params.id, req.currentUser!)
      : await workerImport.publishWorkerImport(req.params.id, req.currentUser!);
    res.json(result);
  })
);
importsRouter.post(
  "/imports/:id/cancel",
  requireImportCreate,
  asyncHandler(async (req, res) => {
    res.json(await importService.cancelBatch(req.params.id, req.currentUser!));
  })
);

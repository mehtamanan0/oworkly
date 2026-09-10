// The configured Express app, with no listening socket of its own — imported
// by both index.ts (which binds a real port) and the test suite (which hands
// this straight to supertest, letting supertest manage its own ephemeral
// server per test run instead of fighting over a fixed port).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { config } from "./config/index.js";
import { ApiError } from "./lib/asyncHandler.js";
import { correlationId } from "./middleware/correlation/index.js";
import { authenticate } from "./middleware/authentication/jwt.js";
import { devLoginRouter } from "./middleware/authentication/devLogin.js";
import { orgUnitsRouter } from "./routes/orgUnits.js";
import { processesRouter } from "./routes/processes.js";
import { skillLevelsRouter, jobRolesRouter, rolesRouter, usersRouter } from "./routes/lookups.js";
import { workersRouter } from "./routes/workers.js";
import { skillMatrixRouter } from "./routes/skillMatrix.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { learningPathsRouter } from "./routes/learningPaths.js";
import { outcomesRouter, certificatesRouter, publicRouter } from "./routes/outcomes.js";
import { retestRouter, escalationsRouter } from "./routes/retest.js";
import { gapAnalysisRouter, recommendedActivitiesRouter } from "./routes/gapAnalysis.js";
import { qualificationRouter } from "./routes/qualification.js";
import { masterDataV2Router } from "./routes/masterDataV2.js";
import { workerPortalRouter } from "./routes/workerPortal.js";
import { mediaRouter, mediaLocalRouter } from "./routes/media.js";

export const app = express();
app.use(cors({ origin: config.CORS_ORIGINS }));
app.use(express.json({ limit: "5mb" }));
app.use(correlationId);

app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "degraded", db: "down" });
  }
});

const v1 = express.Router();

// ---- Unauthenticated: dev login, worker-portal identification/verification,
// public certificate verification ----
v1.use("/auth", devLoginRouter);
v1.use("/worker-portal", workerPortalRouter);
v1.use("/public", publicRouter);
// local object-store driver only (dev/CI); 404s under a real S3/R2 driver. A
// raw <img>/<video> src and the "presigned" PUT carry no bearer token, so this
// pair stays out of the authenticated /v2 mount.
v1.use("/v2", mediaLocalRouter);

// ---- Legacy MVP demo routes (pre-date this milestone's auth model; kept
// running, unauthenticated, exactly as before — see README "known limitations") ----
v1.use("/org-units", orgUnitsRouter);
v1.use("/processes", processesRouter);
v1.use("/skill-levels", skillLevelsRouter);
v1.use("/job-roles", jobRolesRouter);
v1.use("/roles", rolesRouter);
v1.use("/users", usersRouter);
v1.use("/workers", workersRouter);
v1.use("/skill-matrix", skillMatrixRouter);
v1.use("/dashboard", dashboardRouter);
v1.use("/learning-paths", learningPathsRouter);
v1.use("/assessment-outcomes", outcomesRouter);
v1.use("/certificates", certificatesRouter);
v1.use("/retest-cycles", retestRouter);
v1.use("/escalations", escalationsRouter);
v1.use("/skill-gaps", gapAnalysisRouter);
v1.use("/recommended-activities", recommendedActivitiesRouter);

// ---- New model: real server-side auth required from here down. Namespaced
// under /v2 so its paths never collide with the legacy MVP router registered
// above (e.g. both models otherwise define GET /assessment-attempts/:id —
// without this prefix, Express's first-match-wins routing would silently
// send new-model requests into the old, schema-incompatible handlers). ----
v1.use("/v2", authenticate, masterDataV2Router);
v1.use("/v2", authenticate, qualificationRouter);
v1.use("/v2", authenticate, mediaRouter);

app.use("/api/v1", v1);

// ---- Single-service deploy: serve the built SPA and let client-side routing
// handle anything that isn't an API or health path. In local dev the SPA is
// served by Vite on :5173 and web/dist won't exist — the guard makes that a
// no-op. (../../web/dist resolves the same from src/ under tsx and from
// dist/ after tsc, since both sit one level under server/.) ----
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/health")) return next();
    res.sendFile(join(webDist, "index.html"));
  });
}

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ title: err.message, status: err.status, traceId: req.correlationId });
  }
  console.error(err);
  res.status(500).json({ title: "Internal server error", status: 500, traceId: req.correlationId });
});

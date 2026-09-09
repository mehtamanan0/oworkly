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
import { assessmentsRouter } from "./routes/assessments.js";
import { outcomesRouter, certificatesRouter, publicRouter } from "./routes/outcomes.js";
import { retestRouter, escalationsRouter } from "./routes/retest.js";
import { gapAnalysisRouter, recommendedActivitiesRouter } from "./routes/gapAnalysis.js";
import { qualificationRouter } from "./routes/qualification.js";
import { masterDataV2Router } from "./routes/masterDataV2.js";
import { workerPortalRouter } from "./routes/workerPortal.js";

const app = express();
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
v1.use(assessmentsRouter);
v1.use("/assessment-outcomes", outcomesRouter);
v1.use("/certificates", certificatesRouter);
v1.use("/retest-cycles", retestRouter);
v1.use("/escalations", escalationsRouter);
v1.use("/skill-gaps", gapAnalysisRouter);
v1.use("/recommended-activities", recommendedActivitiesRouter);

// ---- New model: real server-side auth required from here down ----
v1.use("/v2", authenticate, masterDataV2Router);
v1.use(authenticate, qualificationRouter);

app.use("/api/v1", v1);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ title: err.message, status: err.status, traceId: req.correlationId });
  }
  console.error(err);
  res.status(500).json({ title: "Internal server error", status: 500, traceId: req.correlationId });
});

const port = config.PORT;
const server = app.listen(port, () => {
  console.log(`Oworkly LMS API listening on http://localhost:${port} (${config.NODE_ENV})`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

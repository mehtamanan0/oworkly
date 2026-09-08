import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { ApiError } from "./lib/asyncHandler.js";
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

const app = express();
app.use(cors());
app.use(express.json());

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
v1.use(assessmentsRouter); // defines its own fully-qualified /assessment-templates* and /assessment-attempts* paths
v1.use("/assessment-outcomes", outcomesRouter);
v1.use("/certificates", certificatesRouter);
v1.use("/retest-cycles", retestRouter);
v1.use("/escalations", escalationsRouter);
v1.use("/skill-gaps", gapAnalysisRouter);
v1.use("/recommended-activities", recommendedActivitiesRouter);
v1.use("/public", publicRouter);
app.use("/api/v1", v1);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ title: err.message, status: err.status });
  }
  console.error(err);
  res.status(500).json({ title: "Internal server error", status: 500 });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Oworkly LMS MVP API listening on http://localhost:${port}`);
});

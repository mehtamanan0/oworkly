// Server-side authorization. Every check here is re-validated at the service
// layer too (defense in depth) — this middleware is the first gate, not the
// only one.
import type { NextFunction, Request, Response } from "express";
import { query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.currentUser) return next(new ApiError(401, "Not authenticated"));
    const ok = req.currentUser.roles.some((r) => roles.includes(r));
    if (!ok) return next(new ApiError(403, `Requires one of: ${roles.join(", ")}`));
    next();
  };
}

// A platform admin (companyId === null) may act on any company. Anyone else
// must be scoped to the exact company the resource belongs to. The company_id
// to check against a specific resource is resolved per-route (params, body,
// or a DB lookup) and passed in via `resolveCompanyId`.
export function requireCompanyScope(resolveCompanyId: (req: Request) => Promise<string | null>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.currentUser) return next(new ApiError(401, "Not authenticated"));
    if (req.currentUser.companyId === null) return next(); // platform admin
    const resourceCompanyId = await resolveCompanyId(req);
    if (resourceCompanyId && resourceCompanyId !== req.currentUser.companyId) {
      return next(new ApiError(403, "Cross-company access is not permitted"));
    }
    next();
  };
}

// An ASSESSOR may only evaluate processes explicitly listed in
// assessor_process_scope — a Supervisor/Trainer/HOD/L&D is not restricted this
// way (their authority is role- and hierarchy-scoped, not per-process).
export async function assertProcessScope(userId: string, roles: string[], processId: string) {
  if (!roles.includes("ASSESSOR") || roles.some((r) => ["SUPERVISOR", "HOD", "LND_TEAM", "ADMIN", "TRAINER"].includes(r))) {
    return; // non-assessor-only roles aren't process-scope-restricted in this model
  }
  const scoped = await queryOne(`SELECT 1 FROM assessor_process_scope WHERE user_id = $1 AND process_id = $2`, [userId, processId]);
  if (!scoped) throw new ApiError(403, "Not authorized to assess this process");
}

// CAN_TAKE / CAN_EVALUATE on a specific assessment_template, resolved from
// assessment_template_role_scope — never inferred from assessment_type alone.
export async function assertPackageCapacity(roles: string[], assessmentTemplateId: string, capacity: "CAN_TAKE" | "CAN_EVALUATE") {
  const rows = await query<{ role_code: string }>(
    `SELECT r.role_code FROM assessment_template_role_scope ars JOIN role r ON r.role_id = ars.role_id
     WHERE ars.assessment_template_id = $1 AND ars.capacity = $2`,
    [assessmentTemplateId, capacity]
  );
  const allowedRoles = rows.map((r) => r.role_code);
  if (!roles.some((r) => allowedRoles.includes(r))) {
    throw new ApiError(403, `None of your roles (${roles.join(",")}) have ${capacity} on this assessment package`);
  }
}

// Per-criterion evaluator_capacity: SELF must be the worker themselves;
// SUPERVISOR_ASSESSOR requires the Supervisor or Assessor role (+ process
// scope for Assessor); TRAINER requires the Trainer role (or another role the
// package's role scope explicitly grants CAN_EVALUATE, per the "or another
// configured role" allowance).
export async function assertEvaluatorCapacity(currentUser: { userId: string; roles: string[]; workerId: string | null }, evaluatorCapacity: string, targetWorkerId: string, processId: string, assessmentTemplateId: string) {
  if (evaluatorCapacity === "SELF") {
    if (currentUser.workerId !== targetWorkerId) {
      throw new ApiError(403, "Only the worker themselves may submit a SELF-capacity response");
    }
    return;
  }
  if (evaluatorCapacity === "SYSTEM") return; // auto-scored, no human evaluator
  if (evaluatorCapacity === "SUPERVISOR_ASSESSOR") {
    if (currentUser.roles.includes("ASSESSOR")) {
      await assertProcessScope(currentUser.userId, currentUser.roles, processId);
      return;
    }
    if (currentUser.roles.includes("SUPERVISOR")) return;
    throw new ApiError(403, "Requires Supervisor or Assessor (scoped) to score this item");
  }
  if (evaluatorCapacity === "TRAINER") {
    if (currentUser.roles.includes("TRAINER")) return;
    // "or another configured role" — check the package's own role scope.
    await assertPackageCapacity(currentUser.roles, assessmentTemplateId, "CAN_EVALUATE");
    return;
  }
  throw new ApiError(422, `Unknown evaluator_capacity: ${evaluatorCapacity}`);
}

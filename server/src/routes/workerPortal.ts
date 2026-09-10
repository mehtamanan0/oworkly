// The worker self-assessment journey (screenshots 12-16): employee-code
// identification, then a verification step (Supervisor PIN today; Supervisor
// Login and Face Recognition are named seams, not implemented), then a short-
// lived worker session token reusing the same JWT/authenticate machinery as
// staff (roles=['EMPLOYEE'], workerId set) so the rest of the API doesn't
// need a parallel auth path. The PIN itself is never sufficient on its own to
// act as a certifying evaluator — it only ever unlocks SELF-capacity actions.
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pool, query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import { signAccessToken } from "../middleware/authentication/jwt.js";
import { recordAudit } from "../infrastructure/database/audit.js";

export const workerPortalRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

workerPortalRouter.post(
  "/identify",
  asyncHandler(async (req, res) => {
    const { employeeCode } = req.body as { employeeCode: string };
    if (!employeeCode) throw new ApiError(400, "employeeCode is required");
    const worker = await queryOne<any>(
      `SELECT worker_id, first_name, last_name, hrms_employee_code FROM worker WHERE hrms_employee_code = $1 AND status = 'active'`,
      [employeeCode]
    );
    if (!worker) throw new ApiError(404, "Employee code not found");
    const hasPin = await queryOne(`SELECT 1 FROM worker_verification_credential WHERE worker_id = $1`, [worker.worker_id]);
    res.json({ ...worker, verificationMethodsAvailable: hasPin ? ["SUPERVISOR_PIN"] : [] });
  })
);

workerPortalRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { workerId, method, pin } = req.body as { workerId: string; method: string; pin?: string };
    if (method !== "SUPERVISOR_PIN") throw new ApiError(422, `Verification method ${method} is not yet enabled`);

    const cred = await queryOne<any>(`SELECT * FROM worker_verification_credential WHERE worker_id = $1`, [workerId]);
    if (!cred) throw new ApiError(422, "No verification credential configured for this worker");
    if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
      throw new ApiError(423, `Too many failed attempts — locked until ${cred.locked_until}`);
    }

    const candidateHash = scryptSync(pin ?? "", cred.pin_salt, 32);
    const storedHash = Buffer.from(cred.pin_hash, "hex");
    const match = candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);

    const worker = await queryOne<any>(`SELECT first_name, last_name, company_id FROM worker WHERE worker_id = $1`, [workerId]);

    if (!match) {
      const attempts = cred.failed_attempt_count + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
      await query(`UPDATE worker_verification_credential SET failed_attempt_count = $1, locked_until = $2 WHERE worker_id = $3`, [attempts, lockedUntil, workerId]);
      await query(
        `INSERT INTO worker_verification_session (worker_id, method, outcome) VALUES ($1,$2,'failed')`,
        [workerId, method]
      );
      throw new ApiError(401, lockedUntil ? "Incorrect PIN — account locked" : "Incorrect PIN");
    }

    await query(`UPDATE worker_verification_credential SET failed_attempt_count = 0, locked_until = NULL WHERE worker_id = $1`, [workerId]);
    const session = await queryOne<any>(
      `INSERT INTO worker_verification_session (worker_id, method, outcome) VALUES ($1,$2,'success') RETURNING *`,
      [workerId, method]
    );
    await recordAudit(pool, {
      entityName: "worker_verification_session", entityId: session.worker_verification_session_id, action: "INSERT", actorUserId: null, source: "web", after: { method, outcome: "success" },
    }).catch(() => {}); // best-effort; the session row above is the authoritative record either way

    // question_response.evaluator_user_id is a real FK into app_user, so
    // a worker taking a self-assessment needs a real app_user row — created
    // on first use rather than requiring every worker to be pre-provisioned
    // with a login.
    let appUser = await queryOne<{ user_id: string }>(`SELECT user_id FROM app_user WHERE worker_id = $1`, [workerId]);
    if (!appUser) {
      appUser = await queryOne<{ user_id: string }>(
        `INSERT INTO app_user (display_name, worker_id, email) VALUES ($1,$2,$3) RETURNING user_id`,
        [`${worker.first_name} ${worker.last_name}`, workerId, `worker-${workerId}@self-assess.local`]
      );
    }

    const token = signAccessToken({ userId: appUser!.user_id, companyId: worker.company_id, roles: ["EMPLOYEE"], workerId, displayName: `${worker.first_name} ${worker.last_name}` });
    res.json({ accessToken: token });
  })
);

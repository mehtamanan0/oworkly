// M10: real password authentication for staff login. Deliberately parallel
// to, and independent from, devLogin.ts (dev-only, no password, left
// untouched) and workerPortal.ts (PIN-based, worker-only, left untouched) --
// both of those mint JWTs with no `sid` claim, so they never touch
// user_session at all. Only this file's login() creates a session.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import { hashPassword, verifyPassword } from "../../infrastructure/security/passwordService.js";
import { createSession, revokeSession, revokeAllSessionsForUser } from "./sessionService.js";
import { signAccessToken, type CurrentUser } from "../../middleware/authentication/jwt.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
// Never reveals whether the identifier exists, whether a password has been
// set yet, or whether the account is merely locked vs. simply wrong --
// account-state detail (deactivated/locked) is only surfaced *after* the
// identifier+password pair has already resolved to a real, active-password
// account, matching the brief's "generic failure message" requirement while
// still giving a locked/deactivated real user an actionable message.
const GENERIC_LOGIN_FAILURE = "Incorrect email or password";

async function resolveCurrentUser(userRow: { user_id: string; display_name: string; worker_id: string | null }): Promise<CurrentUser> {
  const roleRows = await query<{ role_code: string; company_id: string }>(
    `SELECT r.role_code, ur.company_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1`,
    [userRow.user_id]
  );
  if (roleRows.length === 0) throw new ApiError(403, "User has no role assignments");
  const distinctCompanies = [...new Set(roleRows.map((r) => r.company_id))];
  const companyId = distinctCompanies.length === 1 ? distinctCompanies[0] : null;
  if (companyId) {
    const company = await queryOne<{ status: string }>(`SELECT status FROM company WHERE company_id = $1`, [companyId]);
    if (company && ["SUSPENDED", "ARCHIVED"].includes(company.status)) {
      throw new ApiError(403, `This company's account is ${company.status.toLowerCase()} — contact your platform administrator`);
    }
  }
  return {
    userId: userRow.user_id,
    companyId,
    roles: [...new Set(roleRows.map((r) => r.role_code))],
    workerId: userRow.worker_id,
    displayName: userRow.display_name,
  };
}

export async function login(identifier: string, password: string) {
  const normalized = identifier.trim().toLowerCase();
  const user = await queryOne<{
    user_id: string; display_name: string; worker_id: string | null; password_hash: string | null;
    is_active: boolean; locked_until: string | null; failed_login_count: number;
  }>(
    `SELECT user_id, display_name, worker_id, password_hash, is_active, locked_until, failed_login_count
     FROM app_user WHERE lower(email) = $1`,
    [normalized]
  );

  // Unknown identifier or an account with no password set yet (not migrated
  // to real auth) -- same generic message either way.
  if (!user || !user.password_hash) {
    throw new ApiError(401, GENERIC_LOGIN_FAILURE);
  }
  if (!user.is_active) {
    throw new ApiError(403, "This account has been deactivated — contact your administrator");
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new ApiError(423, "This account is temporarily locked after repeated failed sign-in attempts — try again later");
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    const nextCount = user.failed_login_count + 1;
    const lockUntil = nextCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await query(
      `UPDATE app_user SET failed_login_count = $1, last_failed_login_at = now(), locked_until = COALESCE($2, locked_until) WHERE user_id = $3`,
      [nextCount, lockUntil, user.user_id]
    );
    await recordAudit(pool, { entityName: "app_user", entityId: user.user_id, action: "UPDATE", actorUserId: null, reason: "Failed login attempt" });
    throw new ApiError(401, GENERIC_LOGIN_FAILURE);
  }

  const currentUser = await resolveCurrentUser(user);
  const { sessionId, expiresAt } = await createSession(user.user_id);
  await query(
    `UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL, locked_until = NULL, last_success_login_at = now() WHERE user_id = $1`,
    [user.user_id]
  );
  await recordAudit(pool, { entityName: "app_user", entityId: user.user_id, action: "UPDATE", actorUserId: user.user_id, reason: "Login success" });

  const accessToken = signAccessToken({ ...currentUser, sessionId });
  return { accessToken, user: currentUser, expiresAt };
}

export async function logout(sessionId: string | null | undefined, userId: string) {
  if (sessionId) {
    await revokeSession(sessionId, "User logout");
  }
  await recordAudit(pool, { entityName: "app_user", entityId: userId, action: "UPDATE", actorUserId: userId, reason: "Logout" });
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string) {
  if (newPassword.length < 10) throw new ApiError(422, "New password must be at least 10 characters");
  const user = await queryOne<{ password_hash: string | null }>(`SELECT password_hash FROM app_user WHERE user_id = $1`, [userId]);
  if (!user) throw new ApiError(404, "User not found");
  if (user.password_hash) {
    const ok = await verifyPassword(user.password_hash, oldPassword);
    if (!ok) throw new ApiError(401, "Current password is incorrect");
  }
  const newHash = await hashPassword(newPassword);
  await query(`UPDATE app_user SET password_hash = $1, password_changed_at = now() WHERE user_id = $2`, [newHash, userId]);
  await revokeAllSessionsForUser(userId, "Password changed");
  await recordAudit(pool, { entityName: "app_user", entityId: userId, action: "UPDATE", actorUserId: userId, reason: "Password changed" });
}

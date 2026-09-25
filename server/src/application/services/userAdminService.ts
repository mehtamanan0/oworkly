// M10: account deactivation/reactivation/admin-reset -- a controlled state
// change, never a destructive delete. Historical audit/assessment records
// for a deactivated user are untouched by design (nothing here deletes rows,
// only app_user.is_active + a full session revocation).
import { randomBytes } from "node:crypto";
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import { hashPassword } from "../../infrastructure/security/passwordService.js";
import { revokeAllSessionsForUser } from "./sessionService.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

export async function listUsers(companyId: string, currentUser: CurrentUser) {
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "You may only view users within your own company");
  }
  return query<any>(
    `SELECT u.user_id, u.display_name, u.email, u.is_active, u.last_success_login_at,
            array_agg(DISTINCT r.role_code ORDER BY r.role_code) AS roles
     FROM app_user u
     JOIN user_role ur ON ur.user_id = u.user_id
     JOIN role r ON r.role_id = ur.role_id
     WHERE ur.company_id = $1
     GROUP BY u.user_id ORDER BY u.display_name`,
    [companyId]
  );
}

async function assertCanManageUser(currentUser: CurrentUser, targetUserId: string) {
  if (currentUser.companyId === null) return; // platform admin manages anyone
  const rows = await query<{ company_id: string }>(`SELECT DISTINCT company_id FROM user_role WHERE user_id = $1`, [targetUserId]);
  const targetCompanies = rows.map((r) => r.company_id);
  if (targetCompanies.length === 0 || !targetCompanies.every((c) => c === currentUser.companyId)) {
    throw new ApiError(403, "You may only manage users within your own company");
  }
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(DISTINCT ur.company_id) AS n FROM user_role ur JOIN role r ON r.role_id = ur.role_id
     WHERE ur.user_id = $1 AND r.role_code = 'ADMIN'`,
    [userId]
  );
  return Number(row?.n ?? 0) > 1;
}

async function countOtherActivePlatformAdmins(excludingUserId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM (
       SELECT ur.user_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id
       WHERE r.role_code = 'ADMIN' AND ur.user_id != $1
       GROUP BY ur.user_id HAVING count(DISTINCT ur.company_id) > 1
     ) admins JOIN app_user u ON u.user_id = admins.user_id WHERE u.is_active`,
    [excludingUserId]
  );
  return Number(row?.n ?? 0);
}

async function countOtherActiveCompanyAdmins(companyId: string, excludingUserId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(DISTINCT ur.user_id) AS n
     FROM user_role ur JOIN role r ON r.role_id = ur.role_id JOIN app_user u ON u.user_id = ur.user_id
     WHERE r.role_code = 'ADMIN' AND ur.company_id = $1 AND ur.user_id != $2 AND u.is_active`,
    [companyId, excludingUserId]
  );
  return Number(row?.n ?? 0);
}

export async function deactivateUser(targetUserId: string, currentUser: CurrentUser, reason: string) {
  if (!reason?.trim()) throw new ApiError(422, "A reason is required to deactivate an account");
  await assertCanManageUser(currentUser, targetUserId);
  const target = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM app_user WHERE user_id = $1`, [targetUserId]);
  if (!target) throw new ApiError(404, "User not found");
  if (!target.is_active) throw new ApiError(409, "This account is already deactivated");

  if (await isPlatformAdmin(targetUserId)) {
    if ((await countOtherActivePlatformAdmins(targetUserId)) === 0) {
      throw new ApiError(409, "Cannot deactivate the last active platform administrator");
    }
  } else {
    // Based on the TARGET's own company scope, not the acting admin's — a
    // platform admin (companyId === null) can trigger this guard just as
    // much as a company-scoped admin can.
    const targetCompanyRow = await queryOne<{ company_id: string }>(
      `SELECT DISTINCT ur.company_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1 AND r.role_code = 'ADMIN'`,
      [targetUserId]
    );
    if (targetCompanyRow && (await countOtherActiveCompanyAdmins(targetCompanyRow.company_id, targetUserId)) === 0) {
      throw new ApiError(409, "Cannot deactivate the last active administrator for this company");
    }
  }

  await query(
    `UPDATE app_user SET is_active = FALSE, deactivated_at = now(), deactivated_by_user_id = $1, deactivation_reason = $2 WHERE user_id = $3`,
    [currentUser.userId, reason, targetUserId]
  );
  await revokeAllSessionsForUser(targetUserId, "Account deactivated");
  await recordAudit(pool, { entityName: "app_user", entityId: targetUserId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, reason, after: { is_active: false } });
  return { status: "deactivated" };
}

export async function reactivateUser(targetUserId: string, currentUser: CurrentUser) {
  await assertCanManageUser(currentUser, targetUserId);
  const target = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM app_user WHERE user_id = $1`, [targetUserId]);
  if (!target) throw new ApiError(404, "User not found");
  if (target.is_active) throw new ApiError(409, "This account is already active");
  await query(
    `UPDATE app_user SET is_active = TRUE, deactivated_at = NULL, deactivated_by_user_id = NULL, deactivation_reason = NULL, failed_login_count = 0, locked_until = NULL WHERE user_id = $1`,
    [targetUserId]
  );
  await recordAudit(pool, { entityName: "app_user", entityId: targetUserId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { is_active: true } });
  return { status: "reactivated" };
}

export async function resetPassword(targetUserId: string, currentUser: CurrentUser) {
  await assertCanManageUser(currentUser, targetUserId);
  const target = await queryOne<{ user_id: string }>(`SELECT user_id FROM app_user WHERE user_id = $1`, [targetUserId]);
  if (!target) throw new ApiError(404, "User not found");
  // A one-time temporary password, returned in plaintext exactly once so the
  // administrator can relay it out-of-band -- never logged, never stored
  // anywhere but this response body and the argon2 hash below.
  const temporaryPassword = randomBytes(9).toString("base64url");
  const hash = await hashPassword(temporaryPassword);
  await query(`UPDATE app_user SET password_hash = $1, password_changed_at = now() WHERE user_id = $2`, [hash, targetUserId]);
  await revokeAllSessionsForUser(targetUserId, "Password reset by administrator");
  await recordAudit(pool, { entityName: "app_user", entityId: targetUserId, action: "UPDATE", actorUserId: currentUser.userId, reason: "Administrator password reset" });
  return { temporaryPassword };
}

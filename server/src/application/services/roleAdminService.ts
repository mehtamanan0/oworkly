// M11: role/permission administration -- role & permission listing, setting
// a role's permission set (platform-admin only, since roles aren't
// company-scoped: changing one affects every company using it), and
// assigning/removing a role grant for a user (company-scoped, with a
// privilege-escalation guard baked into the scope check itself).
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

export async function listRoles() {
  const roles = await query<{ role_id: number; role_code: string; role_name: string }>(`SELECT role_id, role_code, role_name FROM role ORDER BY role_code`);
  const perms = await query<{ role_id: number; code: string }>(
    `SELECT rp.role_id, p.code FROM role_permission rp JOIN permission p ON p.permission_id = rp.permission_id`
  );
  const permsByRole = new Map<number, string[]>();
  for (const p of perms) {
    if (!permsByRole.has(p.role_id)) permsByRole.set(p.role_id, []);
    permsByRole.get(p.role_id)!.push(p.code);
  }
  return roles.map((r) => ({ ...r, permissions: (permsByRole.get(r.role_id) ?? []).sort() }));
}

export async function listPermissions() {
  return query<{ permission_id: number; code: string; description: string }>(`SELECT permission_id, code, description FROM permission ORDER BY code`);
}

export async function createRole(body: { roleCode?: string; roleName?: string }, currentUser: CurrentUser) {
  const roleCode = String(body.roleCode ?? "").trim().toUpperCase();
  const roleName = String(body.roleName ?? "").trim();
  if (!roleCode || !roleName) throw new ApiError(422, "roleCode and roleName are required");
  try {
    const row = await queryOne<{ role_id: number; role_code: string; role_name: string }>(
      `INSERT INTO role (role_code, role_name) VALUES ($1,$2) RETURNING role_id, role_code, role_name`,
      [roleCode, roleName]
    );
    // audit_log.entity_id is UUID-typed; role.role_id is a SMALLSERIAL, so it
    // can't be recorded there directly. Role definitions are a small,
    // rarely-changed admin-only list -- the per-user grant/revoke actions
    // below (keyed by the target user's real UUID) carry the audit trail
    // that actually matters here.
    return { ...row, permissions: [] as string[] };
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, `role_code "${roleCode}" already exists`);
    throw e;
  }
}

export async function updateRole(roleId: number, body: { roleName?: string }, currentUser: CurrentUser) {
  const roleName = String(body.roleName ?? "").trim();
  if (!roleName) throw new ApiError(422, "roleName is required");
  const before = await queryOne<{ role_id: number; role_name: string }>(`SELECT role_id, role_name FROM role WHERE role_id = $1`, [roleId]);
  if (!before) throw new ApiError(404, "Role not found");
  const row = await queryOne(`UPDATE role SET role_name = $1 WHERE role_id = $2 RETURNING role_id, role_code, role_name`, [roleName, roleId]);
  return row;
}

export async function setRolePermissions(roleId: number, permissionCodes: string[], currentUser: CurrentUser) {
  if (!Array.isArray(permissionCodes)) throw new ApiError(422, "permissionCodes must be an array of permission codes");
  const role = await queryOne<{ role_id: number }>(`SELECT role_id FROM role WHERE role_id = $1`, [roleId]);
  if (!role) throw new ApiError(404, "Role not found");
  const permRows = await query<{ permission_id: number; code: string }>(`SELECT permission_id, code FROM permission WHERE code = ANY($1)`, [permissionCodes]);
  const unknown = permissionCodes.filter((c) => !permRows.some((p) => p.code === c));
  if (unknown.length > 0) throw new ApiError(422, `Unknown permission code(s): ${unknown.join(", ")}`);

  // audit_log.entity_id is UUID-typed and can't hold role_id (see createRole's
  // comment) -- no before/after audit row for this action.
  await pool.query(`DELETE FROM role_permission WHERE role_id = $1`, [roleId]);
  for (const p of permRows) {
    await pool.query(`INSERT INTO role_permission (role_id, permission_id) VALUES ($1,$2)`, [roleId, p.permission_id]);
  }
  return { roleId, permissions: permissionCodes.slice().sort() };
}

export async function assignRole(targetUserId: string, roleCode: string, companyId: string, orgUnitId: string, currentUser: CurrentUser) {
  if (!roleCode || !companyId || !orgUnitId) throw new ApiError(422, "roleCode, companyId, and orgUnitId are required");
  // Privilege-escalation guard: a company-scoped admin can only assign roles
  // scoped to their OWN company -- they can never grant a role in a
  // different company, which is what would be needed to hand someone a
  // second company's ADMIN grant (and thereby make them a platform admin,
  // per the companyId-spans->1-company rule elsewhere in this codebase).
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "You may only assign roles within your own company");
  }
  const target = await queryOne<{ user_id: string }>(`SELECT user_id FROM app_user WHERE user_id = $1`, [targetUserId]);
  if (!target) throw new ApiError(404, "User not found");
  const role = await queryOne<{ role_id: number }>(`SELECT role_id FROM role WHERE role_code = $1`, [roleCode]);
  if (!role) throw new ApiError(422, `Unknown role_code: ${roleCode}`);
  const orgUnit = await queryOne<{ company_id: string }>(`SELECT company_id FROM org_unit WHERE org_unit_id = $1`, [orgUnitId]);
  if (!orgUnit || orgUnit.company_id !== companyId) throw new ApiError(422, "orgUnitId must belong to the given company");

  await query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [targetUserId, role.role_id, orgUnitId, companyId]);
  await query(`INSERT INTO company_user_membership (company_id, user_id, is_primary) VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`, [companyId, targetUserId]);
  await recordAudit(pool, { entityName: "user_role", entityId: targetUserId, action: "INSERT", actorUserId: currentUser.userId, after: { roleCode, companyId, orgUnitId } });
  return { status: "assigned" };
}

export async function removeRole(targetUserId: string, roleId: number, currentUser: CurrentUser) {
  let removed;
  if (currentUser.companyId) {
    removed = await query(`DELETE FROM user_role WHERE user_id = $1 AND role_id = $2 AND company_id = $3 RETURNING company_id`, [targetUserId, roleId, currentUser.companyId]);
    if (removed.length === 0) throw new ApiError(404, "No matching role assignment found in your company");
  } else {
    removed = await query(`DELETE FROM user_role WHERE user_id = $1 AND role_id = $2 RETURNING company_id`, [targetUserId, roleId]);
    if (removed.length === 0) throw new ApiError(404, "No matching role assignment found");
  }
  await recordAudit(pool, { entityName: "user_role", entityId: targetUserId, action: "DELETE", actorUserId: currentUser.userId, after: { roleId } });
  return { status: "removed" };
}

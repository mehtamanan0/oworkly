// M11: resolves a caller's coarse permission codes from their role codes,
// fresh on every request (not embedded in the JWT) -- so a role/permission
// change takes effect on the caller's very next request, no re-login needed.
import { query } from "../../db.js";

export async function resolvePermissionsForRoles(roles: string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT p.code FROM role_permission rp
     JOIN role r ON r.role_id = rp.role_id
     JOIN permission p ON p.permission_id = rp.permission_id
     WHERE r.role_code = ANY($1)`,
    [roles]
  );
  return rows.map((r) => r.code);
}

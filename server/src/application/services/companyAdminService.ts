// Company (tenant) lifecycle: create -> IN_SETUP -> activate (gated on a
// checklist) -> ACTIVE -> deactivate (SUSPENDED, requires a reason) ->
// reactivate. Status only ever changes through activate/deactivate below —
// never a raw field update — so every transition is deliberate and audited.
// Follows the same scoped-load / validate / audit pattern as
// processConfigService.ts.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

function assertCanManage(currentUser: CurrentUser, companyId: string) {
  // Platform admin (companyId === null) may manage any company; otherwise the
  // caller must be that company's own admin (route already required ADMIN).
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}

async function loadCompany(id: string) {
  const row = await queryOne<any>(`SELECT * FROM company WHERE company_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Company not found");
  return row;
}

export async function createCompany(
  body: { code?: string; name?: string; industry?: string; deploymentMode?: string },
  currentUser: CurrentUser
) {
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new ApiError(422, "code must be 2-20 chars, uppercase letters/digits/-/_ , starting with a letter or digit");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const deploymentMode = body.deploymentMode ?? "standalone";
  if (!["standalone", "saas", "on_prem"].includes(deploymentMode)) throw new ApiError(422, "deploymentMode must be standalone, saas or on_prem");

  const existing = await queryOne(`SELECT 1 FROM company WHERE code = $1`, [code]);
  if (existing) throw new ApiError(409, `Company code "${code}" is already in use`);

  const row = await queryOne<any>(
    `INSERT INTO company (code, name, industry, deployment_mode, status) VALUES ($1,$2,$3,$4,'IN_SETUP') RETURNING *`,
    [code, name, body.industry ?? null, deploymentMode]
  );
  await recordAudit(pool, { entityName: "company", entityId: row.company_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

export async function updateCompany(
  id: string,
  body: { name?: string; industry?: string; logoRef?: string; deploymentMode?: string },
  currentUser: CurrentUser
) {
  assertCanManage(currentUser, id);
  const before = await loadCompany(id);
  const deploymentMode = body.deploymentMode ?? before.deployment_mode;
  if (!["standalone", "saas", "on_prem"].includes(deploymentMode)) throw new ApiError(422, "deploymentMode must be standalone, saas or on_prem");
  const row = await queryOne<any>(
    `UPDATE company SET name = $1, industry = $2, logo_ref = $3, deployment_mode = $4 WHERE company_id = $5 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() || before.name : before.name,
      body.industry !== undefined ? body.industry : before.industry,
      body.logoRef !== undefined ? body.logoRef : before.logo_ref,
      deploymentMode,
      id,
    ]
  );
  await recordAudit(pool, { entityName: "company", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export interface ChecklistItem {
  code: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export async function getActivationChecklist(id: string, currentUser: CurrentUser): Promise<ChecklistItem[]> {
  assertCanManage(currentUser, id);
  await loadCompany(id);
  const orgRoot = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM org_level_type WHERE company_id = $1`, [id]);
  const adminUser = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.company_id = $1 AND r.role_code = 'ADMIN'`,
    [id]
  );
  const orgRootCount = Number(orgRoot?.n ?? 0);
  const adminCount = Number(adminUser?.n ?? 0);
  return [
    {
      code: "HAS_ORG_HIERARCHY",
      label: "At least one organisation level type is configured",
      passed: orgRootCount > 0,
      detail: `${orgRootCount} level type(s) configured`,
    },
    {
      code: "HAS_ADMIN_USER",
      label: "At least one company administrator is assigned",
      passed: adminCount > 0,
      detail: `${adminCount} admin user(s) assigned`,
    },
  ];
}

export async function activateCompany(id: string, currentUser: CurrentUser) {
  assertCanManage(currentUser, id);
  const before = await loadCompany(id);
  if (!["IN_SETUP", "SUSPENDED"].includes(before.status)) {
    throw new ApiError(422, `Cannot activate a company from status ${before.status}`);
  }
  const checklist = await getActivationChecklist(id, currentUser);
  const incomplete = checklist.filter((c) => !c.passed);
  if (incomplete.length > 0) {
    throw new ApiError(422, `Company is not ready to activate: ${incomplete.map((c) => c.label).join("; ")}`);
  }
  const row = await queryOne<any>(
    `UPDATE company SET status = 'ACTIVE', activated_at = now() WHERE company_id = $1 RETURNING *`,
    [id]
  );
  await recordAudit(pool, { entityName: "company", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { status: before.status }, after: { status: "ACTIVE" } });
  return row;
}

export async function deactivateCompany(id: string, reason: string | undefined, currentUser: CurrentUser) {
  assertCanManage(currentUser, id);
  const trimmedReason = String(reason ?? "").trim();
  if (!trimmedReason) throw new ApiError(422, "A reason is required to deactivate a company");
  const before = await loadCompany(id);
  if (before.status !== "ACTIVE") {
    throw new ApiError(422, `Cannot deactivate a company from status ${before.status}`);
  }
  const row = await queryOne<any>(`UPDATE company SET status = 'SUSPENDED' WHERE company_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, {
    entityName: "company", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId,
    before: { status: before.status }, after: { status: "SUSPENDED" }, reason: trimmedReason,
  });
  return row;
}

export async function getCompanyAuditHistory(id: string, currentUser: CurrentUser) {
  assertCanManage(currentUser, id);
  await loadCompany(id);
  return query<any>(
    `SELECT al.audit_id, al.action, al.changed_at, al.reason, al.before_json, al.after_json, u.display_name AS changed_by_name
     FROM audit_log al LEFT JOIN app_user u ON u.user_id = al.changed_by
     WHERE al.entity_name = 'company' AND al.entity_id = $1
     ORDER BY al.changed_at DESC LIMIT 50`,
    [id]
  );
}

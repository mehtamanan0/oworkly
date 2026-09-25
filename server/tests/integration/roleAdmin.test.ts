// M11: the permission layer (permission/role_permission tables,
// requirePermission middleware) and role/permission admin CRUD.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { agent, devLogin, loadFixtures, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";
import { authenticate, signAccessToken } from "../../src/middleware/authentication/jwt.js";
import { requirePermission } from "../../src/middleware/authorization/index.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("permission model + role/permission admin (M11)", () => {
  let fixtures: Fixtures;
  let platformAdminToken: string;
  let cweAdminToken: string;
  let sssAdminToken: string;
  const scratchRoleIds: number[] = [];
  const scratchUserIds: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    platformAdminToken = (await devLogin("admin")).accessToken;
    cweAdminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
  });

  afterEach(async () => {
    if (scratchUserIds.length > 0) {
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'user_role' AND entity_id::text = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM company_user_membership WHERE user_id = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM user_role WHERE user_id = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM app_user WHERE user_id = ANY($1)`, [scratchUserIds]);
      scratchUserIds.length = 0;
    }
    if (scratchRoleIds.length > 0) {
      await pool.query(`DELETE FROM audit_log WHERE entity_name IN ('role','role_permission') AND entity_id::text = ANY($1)`, [scratchRoleIds.map(String)]);
      await pool.query(`DELETE FROM role_permission WHERE role_id = ANY($1)`, [scratchRoleIds]);
      await pool.query(`DELETE FROM role WHERE role_id = ANY($1)`, [scratchRoleIds]);
      scratchRoleIds.length = 0;
    }
  });

  it("GET /v2/roles lists roles with their resolved permission codes", async () => {
    const res = await agent.get("/api/v1/v2/roles").set(auth(cweAdminToken));
    expect(res.status).toBe(200);
    const admin = res.body.find((r: any) => r.role_code === "ADMIN");
    expect(admin.permissions).toContain("company.create");
    const employee = res.body.find((r: any) => r.role_code === "EMPLOYEE");
    expect(employee.permissions).not.toContain("company.create");
    expect(employee.permissions).toContain("assessment.attempt");
  });

  it("GET /v2/roles and /v2/permissions are rejected for a non-admin caller", async () => {
    await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
    const worker = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
    const res = await agent.get("/api/v1/v2/roles").set(auth(worker.body.accessToken));
    expect(res.status).toBe(403);
  });

  it("only a platform admin can create a role or edit a role's permission set", async () => {
    const denied = await agent.post("/api/v1/v2/roles").set(auth(cweAdminToken)).send({ roleCode: `ZZTEST_${Date.now()}`, roleName: "Scratch" });
    expect(denied.status).toBe(403);

    const roleCode = `ZZTEST_${Date.now()}`;
    const created = await agent.post("/api/v1/v2/roles").set(auth(platformAdminToken)).send({ roleCode, roleName: "Scratch Role" });
    expect(created.status).toBe(201);
    scratchRoleIds.push(created.body.role_id);

    const dup = await agent.post("/api/v1/v2/roles").set(auth(platformAdminToken)).send({ roleCode, roleName: "Again" });
    expect(dup.status).toBe(409);

    const renamed = await agent.patch(`/api/v1/v2/roles/${created.body.role_id}`).set(auth(platformAdminToken)).send({ roleName: "Renamed Scratch Role" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.role_name).toBe("Renamed Scratch Role");

    const badPerms = await agent.post(`/api/v1/v2/roles/${created.body.role_id}/permissions`).set(auth(platformAdminToken)).send({ permissionCodes: ["not.a.real.code"] });
    expect(badPerms.status).toBe(422);

    const setPerms = await agent.post(`/api/v1/v2/roles/${created.body.role_id}/permissions`).set(auth(platformAdminToken)).send({ permissionCodes: ["worker.read", "assessment.read"] });
    expect(setPerms.status).toBe(200);
    expect(setPerms.body.permissions.sort()).toEqual(["assessment.read", "worker.read"]);

    const deniedPerms = await agent.post(`/api/v1/v2/roles/${created.body.role_id}/permissions`).set(auth(cweAdminToken)).send({ permissionCodes: [] });
    expect(deniedPerms.status).toBe(403);
  });

  it("a company admin can assign/remove a role within their own company but not another company", async () => {
    const cweCompany = await pool.query(`SELECT company_id FROM company WHERE code = 'CWE'`);
    const sssCompany = await pool.query(`SELECT company_id FROM company WHERE code = 'SSS'`);
    const cweOrgUnit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [cweCompany.rows[0].company_id]);
    const userRow = await pool.query(`INSERT INTO app_user (email, display_name) VALUES ($1,$2) RETURNING user_id`, [`zzrole_${Date.now()}@test.local`, "Scratch Assignee"]);
    const targetUserId = userRow.rows[0].user_id;
    scratchUserIds.push(targetUserId);

    // Cross-company assignment attempt is rejected outright.
    const crossCompany = await agent
      .post(`/api/v1/v2/users/${targetUserId}/roles`)
      .set(auth(cweAdminToken))
      .send({ roleCode: "TRAINER", companyId: sssCompany.rows[0].company_id, orgUnitId: cweOrgUnit.rows[0].org_unit_id });
    expect(crossCompany.status).toBe(403);

    const assigned = await agent
      .post(`/api/v1/v2/users/${targetUserId}/roles`)
      .set(auth(cweAdminToken))
      .send({ roleCode: "TRAINER", companyId: cweCompany.rows[0].company_id, orgUnitId: cweOrgUnit.rows[0].org_unit_id });
    expect(assigned.status).toBe(201);

    const roleRow = await pool.query(`SELECT role_id FROM role WHERE role_code = 'TRAINER'`);
    const removedByWrongCompany = await agent.delete(`/api/v1/v2/users/${targetUserId}/roles/${roleRow.rows[0].role_id}`).set(auth(sssAdminToken));
    expect(removedByWrongCompany.status).toBe(404); // no matching row in SSS's own company scope

    const removed = await agent.delete(`/api/v1/v2/users/${targetUserId}/roles/${roleRow.rows[0].role_id}`).set(auth(cweAdminToken));
    expect(removed.status).toBe(200);
  });

  it("resolved permissions update on the very next request after a role's permission set changes -- no re-login required", async () => {
    const roleCode = `ZZLIVE_${Date.now()}`;
    const created = await agent.post("/api/v1/v2/roles").set(auth(platformAdminToken)).send({ roleCode, roleName: "Live Update Role" });
    scratchRoleIds.push(created.body.role_id);
    await agent.post(`/api/v1/v2/roles/${created.body.role_id}/permissions`).set(auth(platformAdminToken)).send({ permissionCodes: ["worker.read"] });

    const userRow = await pool.query(`INSERT INTO app_user (email, display_name) VALUES ($1,$2) RETURNING user_id`, [`zzlive_${Date.now()}@test.local`, "Live Scratch User"]);
    const userId = userRow.rows[0].user_id;
    scratchUserIds.push(userId);
    const cweCompany = await pool.query(`SELECT company_id FROM company WHERE code = 'CWE'`);
    const cweOrgUnit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [cweCompany.rows[0].company_id]);
    await pool.query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4)`, [userId, created.body.role_id, cweOrgUnit.rows[0].org_unit_id, cweCompany.rows[0].company_id]);

    const token = signAccessToken({ userId, companyId: cweCompany.rows[0].company_id, roles: [roleCode], workerId: null, displayName: "Live Scratch User" });

    const probeApp = express();
    probeApp.use(express.json());
    probeApp.get("/probe-worker", authenticate, requirePermission("worker.read"), (_req, res) => res.json({ ok: true }));
    probeApp.get("/probe-assessment", authenticate, requirePermission("assessment.read"), (_req, res) => res.json({ ok: true }));
    const probe = request(probeApp);

    const before = await probe.get("/probe-worker").set(auth(token));
    expect(before.status).toBe(200);
    const beforeDenied = await probe.get("/probe-assessment").set(auth(token));
    expect(beforeDenied.status).toBe(403);

    await agent.post(`/api/v1/v2/roles/${created.body.role_id}/permissions`).set(auth(platformAdminToken)).send({ permissionCodes: ["assessment.read"] });

    const after = await probe.get("/probe-assessment").set(auth(token)); // same, never-refreshed token
    expect(after.status).toBe(200);
    const afterRevoked = await probe.get("/probe-worker").set(auth(token));
    expect(afterRevoked.status).toBe(403);
  });

  it("requirePermission passes with any one of several listed codes (OR semantics), like requireRole", async () => {
    const probeApp = express();
    probeApp.use(express.json());
    probeApp.get("/probe", authenticate, requirePermission("audit.read", "report.read"), (_req, res) => res.json({ ok: true }));
    const probe = request(probeApp);
    const res = await probe.get("/probe").set(auth(cweAdminToken)); // ADMIN has both
    expect(res.status).toBe(200);
  });
});

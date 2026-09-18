// M5: company (tenant) lifecycle admin — create, activation checklist,
// activate/deactivate, permission boundaries, audit trail.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, type Fixtures, loadFixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const TEST_CODE_PREFIX = "ZZTEST";

describe("company (tenant) admin (M5)", () => {
  let fixtures: Fixtures;
  let platformAdminToken: string;
  let cweAdminToken: string;
  let sssAdminToken: string;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    platformAdminToken = (await devLogin("admin")).accessToken;
    cweAdminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
  });

  afterEach(async () => {
    // org_unit/user_role don't cascade off company (NO ACTION) — clear them
    // first so the scratch company itself can be deleted.
    await pool.query(`DELETE FROM user_role WHERE company_id IN (SELECT company_id FROM company WHERE code LIKE $1)`, [`${TEST_CODE_PREFIX}%`]);
    await pool.query(`DELETE FROM org_unit WHERE company_id IN (SELECT company_id FROM company WHERE code LIKE $1)`, [`${TEST_CODE_PREFIX}%`]);
    await pool.query(`DELETE FROM audit_log WHERE entity_name = 'company' AND entity_id IN (SELECT company_id FROM company WHERE code LIKE $1)`, [`${TEST_CODE_PREFIX}%`]);
    await pool.query(`DELETE FROM company WHERE code LIKE $1`, [`${TEST_CODE_PREFIX}%`]);
  });

  function freshCode() {
    return `${TEST_CODE_PREFIX}${Math.floor(Math.random() * 1_000_000)}`;
  }

  it("only a platform admin can create a company; rejects a duplicate code and a malformed one", async () => {
    const code = freshCode();
    const denied = await agent.post("/api/v1/v2/companies").set(auth(cweAdminToken)).send({ code, name: "Nope Co" });
    expect(denied.status).toBe(403);

    const created = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code, name: "Test Co" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("IN_SETUP");
    expect(created.body.code).toBe(code);

    const dup = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code, name: "Test Co Again" });
    expect(dup.status).toBe(409);

    const bad = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code: "no good", name: "Bad Code Co" });
    expect(bad.status).toBe(422);
  });

  it("activation is blocked until the checklist passes, then succeeds once it does", async () => {
    const code = freshCode();
    const created = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code, name: "Checklist Co" });
    const companyId = created.body.company_id;

    const checklistBefore = await agent.get(`/api/v1/v2/companies/${companyId}/activation-checklist`).set(auth(platformAdminToken));
    expect(checklistBefore.status).toBe(200);
    expect(checklistBefore.body.every((c: any) => c.passed === false)).toBe(true);

    const blocked = await agent.post(`/api/v1/v2/companies/${companyId}/activate`).set(auth(platformAdminToken)).send({});
    expect(blocked.status).toBe(422);

    // Satisfy the checklist directly (an org level type + an admin user).
    const levelType = await pool.query(`INSERT INTO org_level_type (company_id, code, name, sequence, is_leaf) VALUES ($1,'ROOT','Root',1,true) RETURNING org_level_type_id`, [companyId]);
    const rootUnit = await pool.query(
      `INSERT INTO org_unit (unit_type, code, name, company_id, org_level_type_id) VALUES ('PLANT','ROOT','Root',$1,$2) RETURNING org_unit_id`,
      [companyId, levelType.rows[0].org_level_type_id]
    );
    const anyRole = await pool.query(`SELECT role_id FROM role WHERE role_code = 'ADMIN'`);
    const anyUser = await pool.query(`SELECT user_id FROM app_user WHERE external_idp_subject = 'cwec_admin'`);
    await pool.query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4)`, [anyUser.rows[0].user_id, anyRole.rows[0].role_id, rootUnit.rows[0].org_unit_id, companyId]);

    const checklistAfter = await agent.get(`/api/v1/v2/companies/${companyId}/activation-checklist`).set(auth(platformAdminToken));
    expect(checklistAfter.body.every((c: any) => c.passed === true)).toBe(true);

    const activated = await agent.post(`/api/v1/v2/companies/${companyId}/activate`).set(auth(platformAdminToken)).send({});
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("ACTIVE");
    expect(activated.body.activated_at).toBeTruthy();

    // clean up the extra user_role row so it doesn't affect other tests' role resolution
    await pool.query(`DELETE FROM user_role WHERE user_id = $1 AND company_id = $2`, [anyUser.rows[0].user_id, companyId]);
  });

  it("deactivation requires a reason, preserves the row, and is recorded in the audit trail", async () => {
    const code = freshCode();
    const created = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code, name: "Deactivate Co" });
    const companyId = created.body.company_id;
    await pool.query(`UPDATE company SET status = 'ACTIVE', activated_at = now() WHERE company_id = $1`, [companyId]);

    const noReason = await agent.post(`/api/v1/v2/companies/${companyId}/deactivate`).set(auth(platformAdminToken)).send({});
    expect(noReason.status).toBe(422);

    const deactivated = await agent
      .post(`/api/v1/v2/companies/${companyId}/deactivate`)
      .set(auth(platformAdminToken))
      .send({ reason: "Contract paused pending renewal" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("SUSPENDED");

    const stillThere = await pool.query(`SELECT company_id FROM company WHERE company_id = $1`, [companyId]);
    expect(stillThere.rows).toHaveLength(1);

    const audit = await agent.get(`/api/v1/v2/companies/${companyId}/audit`).set(auth(platformAdminToken));
    expect(audit.status).toBe(200);
    const statusChange = audit.body.find((a: any) => a.action === "STATUS_CHANGE" && a.reason === "Contract paused pending renewal");
    expect(statusChange).toBeTruthy();

    // A company-scoped ADMIN (not platform-wide) cannot deactivate any company.
    const forbiddenActor = await agent.post(`/api/v1/v2/companies/${companyId}/deactivate`).set(auth(cweAdminToken)).send({ reason: "x" });
    expect(forbiddenActor.status).toBe(403);
  });

  it("a company's own admin can edit its metadata; another company's admin cannot", async () => {
    const before = await pool.query(`SELECT industry FROM company WHERE company_id = $1`, [fixtures.cweCompanyId]);
    try {
      const own = await agent.patch(`/api/v1/v2/companies/${fixtures.cweCompanyId}`).set(auth(cweAdminToken)).send({ industry: "Renewable Energy" });
      expect(own.status).toBe(200);
      expect(own.body.industry).toBe("Renewable Energy");

      const other = await agent.patch(`/api/v1/v2/companies/${fixtures.cweCompanyId}`).set(auth(sssAdminToken)).send({ industry: "Hijacked" });
      expect(other.status).toBe(403);
    } finally {
      await pool.query(`UPDATE company SET industry = $1 WHERE company_id = $2`, [before.rows[0].industry, fixtures.cweCompanyId]);
    }
  });

  it("a deactivated company's users are refused new logins", async () => {
    const code = freshCode();
    const created = await agent.post("/api/v1/v2/companies").set(auth(platformAdminToken)).send({ code, name: "Locked Co" });
    const companyId = created.body.company_id;
    await pool.query(`UPDATE company SET status = 'SUSPENDED' WHERE company_id = $1`, [companyId]);

    const role = await pool.query(`SELECT role_id FROM role WHERE role_code = 'ADMIN'`);
    const levelType = await pool.query(`INSERT INTO org_level_type (company_id, code, name, sequence, is_leaf) VALUES ($1,'ROOT','Root',1,true) RETURNING org_level_type_id`, [companyId]);
    const rootUnit = await pool.query(
      `INSERT INTO org_unit (unit_type, code, name, company_id, org_level_type_id) VALUES ('PLANT','ROOT','Root',$1,$2) RETURNING org_unit_id`,
      [companyId, levelType.rows[0].org_level_type_id]
    );
    const scratchUser = await pool.query(
      `INSERT INTO app_user (email, display_name, external_idp_subject) VALUES ($1,$2,$3) RETURNING user_id`,
      [`${code.toLowerCase()}@test.local`, "Scratch User", `${code.toLowerCase()}_user`]
    );
    await pool.query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4)`, [scratchUser.rows[0].user_id, role.rows[0].role_id, rootUnit.rows[0].org_unit_id, companyId]);

    const loginAttempt = await agent.post("/api/v1/auth/dev-login").send({ username: `${code.toLowerCase()}_user` });
    expect(loginAttempt.status).toBe(403);

    await pool.query(`DELETE FROM user_role WHERE user_id = $1`, [scratchUser.rows[0].user_id]);
    await pool.query(`DELETE FROM app_user WHERE user_id = $1`, [scratchUser.rows[0].user_id]);
  });
});

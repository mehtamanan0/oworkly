// M10: real password authentication, sessions, logout, and account
// deactivation. Deliberately exercises the NEW /auth/login flow directly
// (not the devLogin() test helper, which is dev-login and stays untouched)
// against the real seeded demo accounts, which now carry real password
// hashes (see ingestion/seed.mjs and seed_figma_demo.mjs).
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";
import { rateLimit } from "../../src/middleware/rateLimit.js";
import express from "express";
import request from "supertest";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "OWorkly-Demo-2026!";
const CWE_ADMIN_EMAIL = "cwec_admin@demo.oworkly.local";
const SSS_ADMIN_EMAIL = "sss_admin@demo.oworkly.local";
const PLATFORM_ADMIN_EMAIL = "admin@demo.oworkly.local";

async function loginAs(email: string, password: string = DEMO_PASSWORD) {
  return agent.post("/api/v1/auth/login").send({ email, password });
}

const SEED_EMAILS = [CWE_ADMIN_EMAIL, SSS_ADMIN_EMAIL, PLATFORM_ADMIN_EMAIL];

// Restores the real seeded accounts (and their password) to a known-good
// state -- failed-attempt counters, lockouts, and deactivation are all
// mutated by these tests and must not leak between tests or into other
// test files that also log in as these same demo accounts.
async function resetSeedAccounts() {
  await pool.query(`UPDATE app_user SET failed_login_count = 0, locked_until = NULL, is_active = TRUE WHERE email = ANY($1)`, [SEED_EMAILS]);
  const argon2 = await import("argon2");
  const demoHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  await pool.query(`UPDATE app_user SET password_hash = $1 WHERE email = ANY($2)`, [demoHash, SEED_EMAILS]);
}

describe("secure authentication (M10)", () => {
  const scratchUserIds: string[] = [];
  const scratchCompanyIds: string[] = [];

  beforeAll(resetSeedAccounts);
  afterEach(resetSeedAccounts);

  afterEach(async () => {
    if (scratchUserIds.length > 0) {
      await pool.query(`DELETE FROM user_session WHERE user_id = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'app_user' AND entity_id::text = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM user_role WHERE user_id = ANY($1)`, [scratchUserIds]);
      await pool.query(`DELETE FROM app_user WHERE user_id = ANY($1)`, [scratchUserIds]);
      scratchUserIds.length = 0;
    }
    if (scratchCompanyIds.length > 0) {
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'company' AND entity_id::text = ANY($1)`, [scratchCompanyIds]);
      await pool.query(`DELETE FROM org_unit WHERE company_id = ANY($1)`, [scratchCompanyIds]);
      await pool.query(`DELETE FROM org_level_type WHERE company_id = ANY($1)`, [scratchCompanyIds]);
      await pool.query(`DELETE FROM company WHERE company_id = ANY($1)`, [scratchCompanyIds]);
      scratchCompanyIds.length = 0;
    }
  });

  it("valid password succeeds; the response never contains a password hash or leaks account existence on failure", async () => {
    const ok = await loginAs(CWE_ADMIN_EMAIL);
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.user.userId).toBeTruthy();
    expect(JSON.stringify(ok.body)).not.toMatch(/password/i);
    expect(ok.body.expiresAt).toBeTruthy();

    const wrongPassword = await loginAs(CWE_ADMIN_EMAIL, "definitely-wrong");
    expect(wrongPassword.status).toBe(401);

    const unknownIdentifier = await loginAs("nobody-at-all@demo.oworkly.local");
    expect(unknownIdentifier.status).toBe(401);
    expect(unknownIdentifier.body.title).toBe(wrongPassword.body.title); // identical generic message either way
  });

  it("locks the account after repeated failed attempts, and the correct password is rejected while locked", async () => {
    for (let i = 0; i < 5; i++) {
      const attempt = await loginAs(CWE_ADMIN_EMAIL, "definitely-wrong");
      expect(attempt.status).toBe(401);
    }
    const lockedOut = await loginAs(CWE_ADMIN_EMAIL); // correct password, but now locked
    expect(lockedOut.status).toBe(423);

    // Clear the lock directly (simulating the lockout window elapsing) and confirm login works again.
    await pool.query(`UPDATE app_user SET locked_until = NULL, failed_login_count = 0 WHERE email = $1`, [CWE_ADMIN_EMAIL]);
    const afterUnlock = await loginAs(CWE_ADMIN_EMAIL);
    expect(afterUnlock.status).toBe(200);
  });

  it("creates a distinct, revocable session per login; logout revokes it and the token stops working", async () => {
    const first = await loginAs(CWE_ADMIN_EMAIL);
    const second = await loginAs(CWE_ADMIN_EMAIL);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.accessToken).not.toBe(second.body.accessToken); // session fixation prevented — a fresh session per login

    const sessionOk = await agent.get("/api/v1/auth/session").set(auth(first.body.accessToken));
    expect(sessionOk.status).toBe(200);
    expect(sessionOk.body.user.userId).toBe(first.body.user.userId);

    const loggedOut = await agent.post("/api/v1/auth/logout").set(auth(first.body.accessToken)).send({});
    expect(loggedOut.status).toBe(200);

    const reused = await agent.get("/api/v1/auth/session").set(auth(first.body.accessToken));
    expect(reused.status).toBe(401);

    // The second session (still active) must be unaffected by the first's logout.
    const stillOk = await agent.get("/api/v1/auth/session").set(auth(second.body.accessToken));
    expect(stillOk.status).toBe(200);
    await agent.post("/api/v1/auth/logout").set(auth(second.body.accessToken)).send({});
  });

  it("dev-login tokens are unaffected by the session-revocation check (no sid claim)", async () => {
    const dev = await devLogin("cwec_admin");
    const res = await agent.get("/api/v1/v2/companies").set(auth(dev.accessToken));
    expect(res.status).toBe(200);
  });

  it("change-password rejects a wrong current password, then succeeds and revokes every existing session", async () => {
    const login1 = await loginAs(CWE_ADMIN_EMAIL);
    const login2 = await loginAs(CWE_ADMIN_EMAIL);

    const wrongOld = await agent.post("/api/v1/auth/change-password").set(auth(login1.body.accessToken)).send({ oldPassword: "nope", newPassword: "a-brand-new-password-123" });
    expect(wrongOld.status).toBe(401);

    const changed = await agent.post("/api/v1/auth/change-password").set(auth(login1.body.accessToken)).send({ oldPassword: DEMO_PASSWORD, newPassword: "a-brand-new-password-123" });
    expect(changed.status).toBe(200);

    // Both the session used to change it AND every other prior session are revoked.
    const afterChange1 = await agent.get("/api/v1/auth/session").set(auth(login1.body.accessToken));
    expect(afterChange1.status).toBe(401);
    const afterChange2 = await agent.get("/api/v1/auth/session").set(auth(login2.body.accessToken));
    expect(afterChange2.status).toBe(401);

    // Old password no longer works; the new one does.
    const oldPasswordFails = await loginAs(CWE_ADMIN_EMAIL, DEMO_PASSWORD);
    expect(oldPasswordFails.status).toBe(401);
    const newPasswordWorks = await loginAs(CWE_ADMIN_EMAIL, "a-brand-new-password-123");
    expect(newPasswordWorks.status).toBe(200);

    // Restore the demo password so later test runs (and other test files) keep working.
    await agent.post("/api/v1/auth/change-password").set(auth(newPasswordWorks.body.accessToken)).send({ oldPassword: "a-brand-new-password-123", newPassword: DEMO_PASSWORD });
  });

  it("cannot deactivate the last active platform administrator", async () => {
    const platformLogin = await loginAs(PLATFORM_ADMIN_EMAIL);
    expect(platformLogin.status).toBe(200);
    const res = await agent
      .post(`/api/v1/v2/users/${platformLogin.body.user.userId}/deactivate`)
      .set(auth(platformLogin.body.accessToken))
      .send({ reason: "testing the guard" });
    expect(res.status).toBe(409);
    expect(res.body.title).toMatch(/last active platform administrator/);
  });

  it("a company admin cannot deactivate a user in a different company", async () => {
    const cweToken = (await loginAs(CWE_ADMIN_EMAIL)).body.accessToken;
    const sssAdminRow = await pool.query(`SELECT user_id FROM app_user WHERE email = $1`, [SSS_ADMIN_EMAIL]);
    const res = await agent.post(`/api/v1/v2/users/${sssAdminRow.rows[0].user_id}/deactivate`).set(auth(cweToken)).send({ reason: "cross-company attempt" });
    expect(res.status).toBe(403);
  });

  it("blocks deactivating the last admin of a company, then allows it once a second admin exists; reactivation restores login", async () => {
    // Scratch company + a lone scratch ADMIN scoped only to it (the real
    // platform-wide "admin" seed user also holds ADMIN in every company, so
    // a brand-new company is needed to get a genuinely single-admin company).
    const platformToken = (await loginAs(PLATFORM_ADMIN_EMAIL)).body.accessToken;
    const code = `ZZAUTH${Math.floor(Math.random() * 1_000_000)}`;
    const company = await agent.post("/api/v1/v2/companies").set(auth(platformToken)).send({ code, name: "Auth Test Co" });
    expect(company.status).toBe(201);
    scratchCompanyIds.push(company.body.company_id);

    // user_role.org_unit_id is part of a composite PK and NOT NULL -- a
    // scratch company needs at least one real org_unit to scope roles to.
    const levelType = await pool.query(
      `INSERT INTO org_level_type (company_id, code, name, sequence) VALUES ($1,'COMPANY','Company',1) RETURNING org_level_type_id`,
      [company.body.company_id]
    );
    const orgUnit = await pool.query(
      `INSERT INTO org_unit (company_id, org_level_type_id, code, name) VALUES ($1,$2,'ROOT','Root') RETURNING org_unit_id`,
      [company.body.company_id, levelType.rows[0].org_level_type_id]
    );
    const orgUnitId = orgUnit.rows[0].org_unit_id;

    const roleRow = await pool.query(`SELECT role_id FROM role WHERE role_code = 'ADMIN'`);
    async function makeScratchAdmin(email: string) {
      const userRow = await pool.query(
        `INSERT INTO app_user (email, display_name, password_hash, password_algo) VALUES ($1,$2,$3,'argon2id') RETURNING user_id`,
        [email, "Scratch Admin", await hashScratchPassword()]
      );
      const userId = userRow.rows[0].user_id;
      scratchUserIds.push(userId);
      await pool.query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4)`, [userId, roleRow.rows[0].role_id, orgUnitId, company.body.company_id]);
      return userId;
    }
    async function hashScratchPassword() {
      const argon2 = await import("argon2");
      return argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    }

    const solo = await makeScratchAdmin(`zzauth_solo_${randomUUID()}@test.local`);
    const blocked = await agent.post(`/api/v1/v2/users/${solo}/deactivate`).set(auth(platformToken)).send({ reason: "should be blocked" });
    expect(blocked.status).toBe(409);

    const second = await makeScratchAdmin(`zzauth_second_${randomUUID()}@test.local`);
    const allowed = await agent.post(`/api/v1/v2/users/${solo}/deactivate`).set(auth(platformToken)).send({ reason: "now allowed" });
    expect(allowed.status).toBe(200);
    void second;

    // A deactivated account cannot log in.
    const soloRow = await pool.query(`SELECT email FROM app_user WHERE user_id = $1`, [solo]);
    const loginAfterDeactivate = await loginAs(soloRow.rows[0].email);
    expect(loginAfterDeactivate.status).toBe(403);

    const reactivated = await agent.post(`/api/v1/v2/users/${solo}/reactivate`).set(auth(platformToken)).send({});
    expect(reactivated.status).toBe(200);
    const loginAfterReactivate = await loginAs(soloRow.rows[0].email);
    expect(loginAfterReactivate.status).toBe(200);
  });

  it("admin-initiated password reset issues a one-time temporary password that works for login", async () => {
    const platformToken = (await loginAs(PLATFORM_ADMIN_EMAIL)).body.accessToken;
    const argon2 = await import("argon2");
    const userRow = await pool.query(
      `INSERT INTO app_user (email, display_name, password_hash, password_algo) VALUES ($1,$2,$3,'argon2id') RETURNING user_id`,
      [`zzauth_reset_${randomUUID()}@test.local`, "Scratch Reset Target", await argon2.hash("original-password-123", { type: argon2.argon2id })]
    );
    const userId = userRow.rows[0].user_id;
    scratchUserIds.push(userId);
    const roleRow = await pool.query(`SELECT role_id FROM role WHERE role_code = 'EMPLOYEE'`);
    const cwe = await pool.query(`SELECT company_id FROM company WHERE code = 'CWE'`);
    const orgUnit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [cwe.rows[0].company_id]);
    await pool.query(`INSERT INTO user_role (user_id, role_id, org_unit_id, company_id) VALUES ($1,$2,$3,$4)`, [userId, roleRow.rows[0].role_id, orgUnit.rows[0].org_unit_id, cwe.rows[0].company_id]);

    const reset = await agent.post(`/api/v1/v2/users/${userId}/reset-password`).set(auth(platformToken)).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toBeTruthy();

    const email = (await pool.query(`SELECT email FROM app_user WHERE user_id = $1`, [userId])).rows[0].email;
    const oldPasswordFails = await loginAs(email, "original-password-123");
    expect(oldPasswordFails.status).toBe(401);
    const newPasswordWorks = await loginAs(email, reset.body.temporaryPassword);
    expect(newPasswordWorks.status).toBe(200);
  });

  it("rate limiter: rejects further attempts once the window's max is exceeded", async () => {
    const app = express();
    app.use(express.json());
    app.get("/probe", rateLimit({ windowSeconds: 60, max: 3, keyFn: () => "fixed-key" }), (_req, res) => res.json({ ok: true }));
    const r = request(app);
    expect((await r.get("/probe")).status).toBe(200);
    expect((await r.get("/probe")).status).toBe(200);
    expect((await r.get("/probe")).status).toBe(200);
    const fourth = await r.get("/probe");
    expect(fourth.status).toBe(429);
  });
});

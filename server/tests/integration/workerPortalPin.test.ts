import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, loadFixtures, resetWorkerVerificationLockout, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

describe("worker portal PIN verification", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerVerificationLockout(fixtures.rajeshWorkerId);
  });

  it("identifies a worker by employee code", async () => {
    const res = await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
    expect(res.status).toBe(200);
    expect(res.body.worker_id).toBe(fixtures.rajeshWorkerId);
    expect(res.body.verificationMethodsAvailable).toContain("SUPERVISOR_PIN");
  });

  it("404s for an unknown employee code", async () => {
    const res = await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-DOES-NOT-EXIST" });
    expect(res.status).toBe(404);
  });

  it("rejects the wrong PIN", async () => {
    const res = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "9999" });
    expect(res.status).toBe(401);
  });

  it("accepts the correct PIN and issues a token scoped to EMPLOYEE + this worker", async () => {
    const res = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("the PIN is never stored in plaintext", async () => {
    const cred = await pool.query(`SELECT pin_hash, pin_salt FROM worker_verification_credential WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
    expect(cred.rows[0].pin_hash).not.toBe("1234");
    expect(cred.rows[0].pin_hash).toMatch(/^[0-9a-f]+$/i); // a hex-encoded hash, not the raw digits
    expect(cred.rows[0].pin_salt).toBeTruthy();
  });

  it("locks the account after 5 consecutive failed attempts, even with the correct PIN on the 6th try", async () => {
    for (let i = 0; i < 5; i++) {
      await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "0000" });
    }
    const res = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
    expect(res.status).toBe(423);

    const cred = await pool.query(`SELECT locked_until FROM worker_verification_credential WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
    expect(new Date(cred.rows[0].locked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("a successful verification resets the failed-attempt counter", async () => {
    await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "0000" });
    await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
    const cred = await pool.query(`SELECT failed_attempt_count FROM worker_verification_credential WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
    expect(cred.rows[0].failed_attempt_count).toBe(0);
  });
});

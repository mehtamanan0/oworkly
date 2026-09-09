import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, tokenFor, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { runSupervisorJourney } from "../helpers/journey.js";
import { pool } from "../../src/db.js";

describe("approval workflow", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  it("enforces sequential ordering — stage 2 cannot be approved before stage 1", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-order", "PASS");
    const hod = await devLogin("rajiv_hod");
    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/2/act`)
      .set("Authorization", `Bearer ${hod.accessToken}`)
      .send({ action: "approved" });
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/Stage 1 must be approved first/);
  });

  it("rejects a role that does not own the stage being acted on", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-role", "PASS");
    const hod = await devLogin("rajiv_hod");
    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/1/act`)
      .set("Authorization", `Bearer ${hod.accessToken}`)
      .send({ action: "approved" });
    expect(res.status).toBe(403);
    expect(res.body.title).toMatch(/Requires role SUPERVISOR/);
  });

  it("prevents a worker who happens to hold an approval role from approving their own case", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-self", "PASS");

    // No seeded user is simultaneously a worker and an approver, so this
    // constructs the one real scenario the guard exists for: an app_user tied
    // to Rajesh's own worker_id, holding the SUPERVISOR role for this stage.
    const selfApprover = await pool.query(
      `INSERT INTO app_user (display_name, worker_id, email) VALUES ('Test Self-Approver', $1, 'test-self-approver@test.local')
       ON CONFLICT (email) DO UPDATE SET worker_id = EXCLUDED.worker_id RETURNING user_id`,
      [fixtures.rajeshWorkerId]
    );
    const token = tokenFor({ userId: selfApprover.rows[0].user_id, companyId: fixtures.cweCompanyId, roles: ["SUPERVISOR"], workerId: fixtures.rajeshWorkerId, displayName: "Test Self-Approver" });

    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/1/act`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "approved" });
    expect(res.status).toBe(403);
    expect(res.body.title).toMatch(/Self-approval is not permitted/);

    await pool.query(`DELETE FROM app_user WHERE email = 'test-self-approver@test.local'`);
  });

  it("acting on the same stage twice is idempotent, not a duplicate action", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-idem", "PASS");
    const before = await pool.query(`SELECT count(*)::int AS cnt FROM qualification_approval_action`);

    const first = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/1/act`)
      .set("Authorization", `Bearer ${journey.supervisor.accessToken}`)
      .send({ action: "approved" });
    expect(first.status).toBe(200);

    const second = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/1/act`)
      .set("Authorization", `Bearer ${journey.supervisor.accessToken}`)
      .send({ action: "approved" });
    expect(second.status).toBe(200);
    expect(second.body.qualification_approval_action_id).toBe(first.body.qualification_approval_action_id);

    const after = await pool.query(`SELECT count(*)::int AS cnt FROM qualification_approval_action`);
    expect(after.rows[0].cnt).toBe(before.rows[0].cnt + 1); // exactly one row added, not two
  });

  it("Return for Review sends the case back and blocks certify until re-approved", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-return", "PASS");
    await agent.post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/1/act`).set("Authorization", `Bearer ${journey.supervisor.accessToken}`).send({ action: "approved" });

    const hod = await devLogin("rajiv_hod");
    const returned = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/approval/2/act`)
      .set("Authorization", `Bearer ${hod.accessToken}`)
      .send({ action: "returned", remarks: "Practical score seems inflated, please re-verify." });
    expect(returned.status).toBe(200);

    const caseRes = await agent.get(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}`).set("Authorization", `Bearer ${journey.supervisor.accessToken}`);
    expect(caseRes.body.status).toBe("RETURNED_FOR_REVIEW");

    const certifyRes = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${journey.supervisor.accessToken}`)
      .send({});
    expect(certifyRes.status).toBe(422);
  });

  it("all three stages approved moves the case to APPROVED, ready to certify", async () => {
    const journey = await runSupervisorJourney(fixtures, "appr-full", "APPROVED");
    const caseRes = await agent.get(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}`).set("Authorization", `Bearer ${journey.supervisor.accessToken}`);
    expect(caseRes.body.status).toBe("APPROVED");
  });
});

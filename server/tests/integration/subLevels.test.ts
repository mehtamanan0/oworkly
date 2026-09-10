// Migration 0014: process-level criteria, sub-level scoring/gating attributes,
// per-worker sub-level progress, and the ALL_MANDATORY_SUB_LEVELS_COMPLETE
// finalize gate.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, resetWorkerVerificationLockout, type Fixtures } from "../helpers/testApp.js";
import { createCase, startAttempt, scoreComponentFullMarks, completeMandatorySubLevels } from "../helpers/journey.js";
import { pool } from "../../src/db.js";

const TEST_CRITERION_PREFIX = "[test] ";
const TEST_SUBLEVEL_CODE = "TEST-SL-WEIGHT";

async function verifyAsWorker(fixtures: Fixtures) {
  await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
  const verify = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
  return verify.body.accessToken as string;
}

describe("process levels: sub-levels & criteria (migration 0014)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let supervisorToken: string;
  let e3LevelId: string;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    supervisorToken = (await devLogin("sunil_trainer")).accessToken;
    e3LevelId = fixtures.levelIdByCode.E3;
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await resetWorkerVerificationLockout(fixtures.rajeshWorkerId);
    await pool.query(`DELETE FROM process_level_criterion WHERE text LIKE $1`, [`${TEST_CRITERION_PREFIX}%`]);
    await pool.query(`DELETE FROM process_sub_level WHERE code = $1`, [TEST_SUBLEVEL_CODE]);
  });

  it("criteria: create -> list -> update -> delete, and rejects an unknown category", async () => {
    const created = await agent
      .post(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: "knowledge", text: `${TEST_CRITERION_PREFIX}explains torque sequencing` });
    expect(created.status).toBe(201);
    expect(created.body.category).toBe("KNOWLEDGE");
    const criterionId = created.body.process_level_criterion_id;

    const listed = await agent.get(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria`).set("Authorization", `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.some((c: any) => c.process_level_criterion_id === criterionId)).toBe(true);

    const updated = await agent
      .patch(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria/${criterionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ text: `${TEST_CRITERION_PREFIX}explains torque sequencing and re-torque rules` });
    expect(updated.status).toBe(200);
    expect(updated.body.text).toMatch(/re-torque/);

    const bad = await agent
      .post(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: "SPEED", text: `${TEST_CRITERION_PREFIX}nope` });
    expect(bad.status).toBe(422);

    const deleted = await agent
      .delete(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria/${criterionId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    const listedAfter = await agent.get(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria`).set("Authorization", `Bearer ${adminToken}`);
    expect(listedAfter.body.some((c: any) => c.process_level_criterion_id === criterionId)).toBe(false);
  });

  it("sub-levels: rejects a new weight that pushes the level's active sub-level weights past 100%", async () => {
    // Seed gives E3 three sub-levels summing to exactly 100% (40/35/25).
    const over = await agent
      .post(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/sub-levels`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: TEST_SUBLEVEL_CODE, name: "Weight overflow", weightPct: 10, isMandatory: false });
    expect(over.status).toBe(422);
    expect(over.body.title).toMatch(/sum to/i);

    const zero = await agent
      .post(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/sub-levels`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: TEST_SUBLEVEL_CODE, name: "No-weight extra", weightPct: 0, isMandatory: false });
    expect(zero.status).toBe(201);
  });

  it("sign-off is a supervisory act — a worker's own token cannot mark their sub-level progress", async () => {
    const workerToken = await verifyAsWorker(fixtures);
    const subLevels = await agent.get(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/sub-levels`).set("Authorization", `Bearer ${supervisorToken}`);
    const mandatory = subLevels.body.find((s: any) => s.is_mandatory);

    const res = await agent
      .post(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/sub-levels/${mandatory.process_sub_level_id}/progress`)
      .set("Authorization", `Bearer ${workerToken}`)
      .send({ status: "completed" });
    expect(res.status).toBe(403);
  });

  it("cross-company: an SSS admin cannot add a criterion to a CWE process level", async () => {
    const sssToken = (await devLogin("sss_admin")).accessToken;
    const res = await agent
      .post(`/api/v1/v2/processes/${fixtures.braProcessId}/levels/${e3LevelId}/criteria`)
      .set("Authorization", `Bearer ${sssToken}`)
      .send({ category: "KNOWLEDGE", text: `${TEST_CRITERION_PREFIX}should not be allowed` });
    expect(res.status).toBe(403);
  });

  it("finalize is blocked until every mandatory sub-level of the target level is signed off complete", async () => {
    const qcase = await createCase(fixtures, supervisorToken, "sublvl-gate");
    const attempt = await startAttempt(supervisorToken, qcase.qualification_case_id, "sublvl-gate");
    const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}`).set("Authorization", `Bearer ${supervisorToken}`);
    for (const c of attemptDetail.body.componentAttempts.filter((c: any) => !c.self_assessment_enabled)) {
      await scoreComponentFullMarks(supervisorToken, c.assessment_attempt_section_id, `sublvl-gate-${c.assessment_attempt_section_id}`);
    }

    const blocked = await agent
      .post(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}/finalize`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.title).toMatch(/mandatory sub-levels/i);

    await completeMandatorySubLevels(supervisorToken, fixtures.braProcessId, e3LevelId, fixtures.rajeshWorkerId);

    const allowed = await agent
      .post(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}/finalize`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({});
    expect(allowed.status).toBe(200);
    expect(allowed.body.result).toBe("PASS");

    const qr = await pool.query(
      `SELECT passed FROM qualification_rule_check WHERE qualification_result_id = $1 AND rule_code = 'ALL_MANDATORY_SUB_LEVELS_COMPLETE'`,
      [allowed.body.qualificationResultId]
    );
    expect(qr.rows[0]?.passed).toBe(true);
  });
});

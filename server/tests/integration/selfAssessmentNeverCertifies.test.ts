// The single most safety-critical assertion in the whole spec: a worker's
// self-assessment quiz must never create a qualification_result, never
// change qualification_case.status, and never produce a certificate — no
// matter how well the worker scores.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, resetWorkerVerificationLockout, getCorrectOptionKey, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

async function verifyAsWorker(fixtures: Fixtures) {
  const identify = await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
  expect(identify.status).toBe(200);
  const verify = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
  expect(verify.status).toBe(200);
  return verify.body.accessToken as string;
}

describe("self-assessment never certifies", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await resetWorkerVerificationLockout(fixtures.rajeshWorkerId);
  });

  it("a perfect-score self-assessment quiz never creates a qualification_result, changes case status, or issues a certificate", async () => {
    const workerToken = await verifyAsWorker(fixtures);

    const qcaseRes = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${workerToken}`)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(qcaseRes.status).toBe(201);
    const qualificationCaseId = qcaseRes.body.qualification_case_id;
    const statusBeforeAttempt = qcaseRes.body.status;

    const attemptRes = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/attempts`)
      .set("Authorization", `Bearer ${workerToken}`)
      .send({});
    expect(attemptRes.status).toBe(201);
    const attemptId = attemptRes.body.assessment_attempt_id;

    // A self-assessment start must only ever produce a component_attempt for
    // the self-assessment component — never the Practical/Theory/Behavioural
    // ones the worker has no evaluator capacity over.
    const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}`).set("Authorization", `Bearer ${workerToken}`);
    expect(attemptDetail.body.componentAttempts.length).toBe(1);
    expect(attemptDetail.body.componentAttempts[0].self_assessment_enabled).toBe(true);
    const selfComponentAttemptId = attemptDetail.body.componentAttempts[0].assessment_component_attempt_id;

    // Starting the attempt itself must not have moved the case off its
    // pre-attempt status either.
    const caseAfterStart = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${workerToken}`);
    expect(caseAfterStart.body.status).toBe(statusBeforeAttempt);

    const itemsRes = await agent.get(`/api/v1/v2/assessment-component-attempts/${selfComponentAttemptId}/items`).set("Authorization", `Bearer ${workerToken}`);
    const responses = await Promise.all(
      itemsRes.body.map(async (it: any) => ({
        assessmentItemId: it.assessment_item_id,
        score: it.max_score, // ignored server-side for MCQ items — score is computed from responseJson below
        responseJson: { chosen: await getCorrectOptionKey(it.assessment_item_id) },
      }))
    );
    const scoreRes = await agent
      .post(`/api/v1/v2/assessment-component-attempts/${selfComponentAttemptId}/score`)
      .set("Authorization", `Bearer ${workerToken}`)
      .send({ responses });
    expect(scoreRes.status).toBe(200);

    const finalizeRes = await agent
      .post(`/api/v1/v2/assessment-attempts/${attemptId}/finalize`)
      .set("Authorization", `Bearer ${workerToken}`)
      .send({});
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.selfAssessmentOnly).toBe(true);
    expect(finalizeRes.body.passed).toBe(true);

    // The three hard guarantees, verified directly against the database —
    // not just the API's own claims about itself.
    const caseRow = await pool.query(`SELECT status FROM qualification_case WHERE qualification_case_id = $1`, [qualificationCaseId]);
    expect(caseRow.rows[0].status).toBe(statusBeforeAttempt);

    const resultRow = await pool.query(`SELECT count(*)::int AS cnt FROM qualification_result WHERE qualification_case_id = $1`, [qualificationCaseId]);
    expect(resultRow.rows[0].cnt).toBe(0);

    const certRow = await pool.query(`SELECT count(*)::int AS cnt FROM certificate WHERE qualification_case_id = $1`, [qualificationCaseId]);
    expect(certRow.rows[0].cnt).toBe(0);

    const reviewRow = await pool.query(`SELECT outcome_note FROM self_assessment_review WHERE assessment_attempt_id = $1`, [attemptId]);
    expect(reviewRow.rows[0].outcome_note).toMatch(/Passed/);
  });

  it("a worker cannot score a Practical/Theory/Behavioural component even if asked to (no SELF capacity over them)", async () => {
    // Prove this at the authorization layer directly: a worker session has no
    // evaluator capacity over a SUPERVISOR_ASSESSOR-capacity item, so even if
    // a component_attempt for one existed, scoring it must be rejected.
    const workerToken = await verifyAsWorker(fixtures);
    const practicalDef = await pool.query(`SELECT assessment_definition_id FROM assessment_definition WHERE name = 'BRA Practical Evaluation'`);
    // Every mandatory item must be included, or the "missing mandatory items"
    // completeness check would 422 before ever reaching the authorization
    // check this test is actually targeting.
    const items = await pool.query(`SELECT assessment_item_id, max_score FROM assessment_item WHERE assessment_definition_id = $1 AND is_active AND review_status = 'approved'`, [practicalDef.rows[0].assessment_definition_id]);

    // Construct a throwaway component_attempt directly (the worker-start path
    // would never create one for this component — this isolates the
    // authorization check itself).
    const pkg = await pool.query(`SELECT assessment_package_component_id FROM assessment_package_component WHERE assessment_definition_id = $1 LIMIT 1`, [practicalDef.rows[0].assessment_definition_id]);
    const qcaseRes = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${workerToken}`)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    const attemptRow = await pool.query(
      `INSERT INTO assessment_attempt (qualification_case_id, assessment_package_id, worker_id, attempt_no, status, started_at)
       VALUES ($1,$2,$3,99,'in_progress',now()) RETURNING assessment_attempt_id`,
      [qcaseRes.body.qualification_case_id, qcaseRes.body.assessment_package_id, fixtures.rajeshWorkerId]
    );
    const componentAttempt = await pool.query(
      `INSERT INTO assessment_component_attempt (assessment_attempt_id, assessment_package_component_id, status) VALUES ($1,$2,'pending') RETURNING assessment_component_attempt_id`,
      [attemptRow.rows[0].assessment_attempt_id, pkg.rows[0].assessment_package_component_id]
    );

    const res = await agent
      .post(`/api/v1/v2/assessment-component-attempts/${componentAttempt.rows[0].assessment_component_attempt_id}/score`)
      .set("Authorization", `Bearer ${workerToken}`)
      .send({ responses: items.rows.map((it) => ({ assessmentItemId: it.assessment_item_id, score: it.max_score })) });
    expect(res.status).toBe(403);
    expect(res.body.title).toMatch(/Requires Supervisor or Assessor/);
  });
});

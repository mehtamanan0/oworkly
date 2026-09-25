// M9: configurable self-assessment visibility. Previously checkItem()
// unconditionally handed the answer key + explanation to whoever called it —
// including the worker self-checking their own quiz answer. This suite
// proves: (1) that leak is closed by default, (2) an explicit company policy
// can deliberately reveal it, (3) policy CRUD respects the one-active-
// policy-per-scope constraint, (4) release_policy gates when a worker's own
// result becomes visible to them (independent of staff visibility), (5) the
// M5 regression (GET /assessments/:id/items still 403s an EMPLOYEE token)
// still holds.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  agent,
  devLogin,
  loadFixtures,
  resetWorkerQualificationState,
  resetTestIdempotencyKeys,
  resetWorkerVerificationLockout,
  getCorrectOptionKey,
  type Fixtures,
} from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function verifyAsWorker(fixtures: Fixtures) {
  const identify = await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
  expect(identify.status).toBe(200);
  const verify = await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" });
  expect(verify.status).toBe(200);
  return verify.body.accessToken as string;
}

async function startSelfAssessmentAttempt(fixtures: Fixtures, workerToken: string) {
  const qcaseRes = await agent
    .post("/api/v1/v2/qualification-cases")
    .set(auth(workerToken))
    .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
  expect(qcaseRes.status).toBe(201);
  const attemptRes = await agent.post(`/api/v1/v2/qualification-cases/${qcaseRes.body.qualification_case_id}/attempts`).set(auth(workerToken)).send({});
  expect(attemptRes.status).toBe(201);
  const attemptId = attemptRes.body.assessment_attempt_id;
  const detail = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}`).set(auth(workerToken));
  const sectionId = detail.body.componentAttempts[0].assessment_attempt_section_id;
  const itemsRes = await agent.get(`/api/v1/v2/assessment-attempt-sections/${sectionId}/items`).set(auth(workerToken));
  return { qualificationCaseId: qcaseRes.body.qualification_case_id, attemptId, sectionId, items: itemsRes.body as any[] };
}

async function scoreAndFinalize(sectionId: string, attemptId: string, items: any[], workerToken: string) {
  const responses = await Promise.all(items.map(async (it) => ({ questionId: it.question_id, score: it.max_score, responseJson: { chosen: await getCorrectOptionKey(it.question_id) } })));
  const scoreRes = await agent.post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/score`).set(auth(workerToken)).send({ responses });
  expect(scoreRes.status).toBe(200);
  return agent.post(`/api/v1/v2/assessment-attempts/${attemptId}/finalize`).set(auth(workerToken)).send({});
}

describe("self-assessment visibility policy (M9)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let sssAdminToken: string;
  let staffToken: string; // sunil_trainer: TRAINER (nacelle) + SUPERVISOR (blade assembly) at CWE
  let createdPolicyIds: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
    staffToken = (await devLogin("sunil_trainer")).accessToken;
  });

  afterEach(async () => {
    if (createdPolicyIds.length > 0) {
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'self_assessment_visibility_policy' AND entity_id::text = ANY($1)`, [createdPolicyIds]);
      await pool.query(`DELETE FROM self_assessment_visibility_policy WHERE self_assessment_visibility_policy_id = ANY($1)`, [createdPolicyIds]);
      createdPolicyIds = [];
    }
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await resetWorkerVerificationLockout(fixtures.rajeshWorkerId);
  });

  it("hides the answer key and explanation from a worker self-checking by default, but still reveals correctness", async () => {
    const workerToken = await verifyAsWorker(fixtures);
    const { sectionId, items } = await startSelfAssessmentAttempt(fixtures, workerToken);
    const res = await agent
      .post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/check-item`)
      .set(auth(workerToken))
      .send({ questionId: items[0].question_id, responseJson: { chosen: await getCorrectOptionKey(items[0].question_id) } });
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.maxScore).toBeDefined();
    expect(res.body).not.toHaveProperty("correctAnswerKeys");
    expect(res.body).not.toHaveProperty("explanation");
  });

  it("an explicit process-scoped policy can reveal the answer key + explanation to the worker", async () => {
    const policyRes = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`)
      .set(auth(adminToken))
      .send({ name: "ZZ Reveal answers for BRA", processId: fixtures.braProcessId, showCorrectAnswersToWorker: true, showFeedbackToWorker: true });
    expect(policyRes.status).toBe(201);
    createdPolicyIds.push(policyRes.body.self_assessment_visibility_policy_id);

    const workerToken = await verifyAsWorker(fixtures);
    const { sectionId, items } = await startSelfAssessmentAttempt(fixtures, workerToken);
    const res = await agent
      .post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/check-item`)
      .set(auth(workerToken))
      .send({ questionId: items[0].question_id, responseJson: { chosen: await getCorrectOptionKey(items[0].question_id) } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("correctAnswerKeys");
    expect(res.body.correctAnswerKeys).toBeTruthy();
    expect(res.body.explanation).toBeTruthy();
  });

  it("policy CRUD: one active policy per scope, conflict on duplicate, restore respects the same constraint", async () => {
    const create = (name: string) => agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`).set(auth(adminToken)).send({ name });

    const a = await create("ZZ Company Default A");
    expect(a.status).toBe(201);
    createdPolicyIds.push(a.body.self_assessment_visibility_policy_id);

    const dup = await create("ZZ Company Default B (should conflict)");
    expect(dup.status).toBe(409);

    const patched = await agent.patch(`/api/v1/v2/self-assessment-policies/${a.body.self_assessment_visibility_policy_id}`).set(auth(adminToken)).send({ name: "ZZ Renamed Default" });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe("ZZ Renamed Default");

    const archived = await agent.post(`/api/v1/v2/self-assessment-policies/${a.body.self_assessment_visibility_policy_id}/archive`).set(auth(adminToken)).send({});
    expect(archived.status).toBe(200);
    expect(archived.body.is_active).toBe(false);

    // With A archived, a fresh company-default policy can now be created...
    const c = await create("ZZ Company Default C");
    expect(c.status).toBe(201);
    createdPolicyIds.push(c.body.self_assessment_visibility_policy_id);

    // ...which means restoring A now conflicts with C.
    const restoreConflict = await agent.post(`/api/v1/v2/self-assessment-policies/${a.body.self_assessment_visibility_policy_id}/restore`).set(auth(adminToken)).send({});
    expect(restoreConflict.status).toBe(409);
  });

  it("cross-company access to another company's self-assessment policies is rejected", async () => {
    const res = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`)
      .set(auth(sssAdminToken))
      .send({ name: "ZZ Should be rejected" });
    expect(res.status).toBe(403);
  });

  it("writes an audit_log row on policy create", async () => {
    const res = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`).set(auth(adminToken)).send({ name: "ZZ Audited Policy" });
    expect(res.status).toBe(201);
    createdPolicyIds.push(res.body.self_assessment_visibility_policy_id);
    const audit = await pool.query(`SELECT action FROM audit_log WHERE entity_name = 'self_assessment_visibility_policy' AND entity_id = $1`, [res.body.self_assessment_visibility_policy_id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("INSERT");
  });

  it("release_policy NEVER: finalize and the result endpoint both withhold the outcome from the worker", async () => {
    const policyRes = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`)
      .set(auth(adminToken))
      .send({ name: "ZZ Never release", processId: fixtures.braProcessId, releasePolicy: "NEVER" });
    expect(policyRes.status).toBe(201);
    createdPolicyIds.push(policyRes.body.self_assessment_visibility_policy_id);

    const workerToken = await verifyAsWorker(fixtures);
    const { attemptId, sectionId, items } = await startSelfAssessmentAttempt(fixtures, workerToken);
    const finalizeRes = await scoreAndFinalize(sectionId, attemptId, items, workerToken);
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.selfAssessmentOnly).toBe(true);
    expect(finalizeRes.body.released).toBe(false);
    expect(finalizeRes.body.releasePolicy).toBe("NEVER");
    expect(finalizeRes.body.passed).toBeUndefined();

    const resultRes = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-result`).set(auth(workerToken));
    expect(resultRes.status).toBe(200);
    expect(resultRes.body.released).toBe(false);
  });

  it("release_policy AFTER_SUPERVISOR_REVIEW: worker sees nothing until a Supervisor reviews it, staff sees it immediately", async () => {
    const policyRes = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`)
      .set(auth(adminToken))
      .send({ name: "ZZ Review-gated release", processId: fixtures.braProcessId, releasePolicy: "AFTER_SUPERVISOR_REVIEW", answersVisibleToSupervisor: true });
    expect(policyRes.status).toBe(201);
    createdPolicyIds.push(policyRes.body.self_assessment_visibility_policy_id);

    const workerToken = await verifyAsWorker(fixtures);
    const { attemptId, sectionId, items } = await startSelfAssessmentAttempt(fixtures, workerToken);
    const finalizeRes = await scoreAndFinalize(sectionId, attemptId, items, workerToken);
    expect(finalizeRes.body.released).toBe(false);
    expect(finalizeRes.body.releasePolicy).toBe("AFTER_SUPERVISOR_REVIEW");

    const beforeReview = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-result`).set(auth(workerToken));
    expect(beforeReview.body.released).toBe(false);

    // Staff visibility is independent of the worker's own release policy.
    const staffView = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-result`).set(auth(staffToken));
    expect(staffView.status).toBe(200);
    expect(staffView.body.released).toBe(true);
    expect(staffView.body.passed).toBe(true);

    const review = await agent.post(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-review`).set(auth(staffToken)).send({ outcomeNote: "Looks good" });
    expect(review.status).toBe(200);
    expect(review.body.reviewed_by_user_id).toBeTruthy();

    const afterReview = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-result`).set(auth(workerToken));
    expect(afterReview.body.released).toBe(true);
    expect(afterReview.body.passed).toBe(true);
  });

  it("a role a policy does not grant answers_visible_to_* cannot view the result", async () => {
    const policyRes = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/self-assessment-policies`)
      .set(auth(adminToken))
      .send({ name: "ZZ No supervisor visibility", processId: fixtures.braProcessId, answersVisibleToSupervisor: false, answersVisibleToTrainer: false });
    expect(policyRes.status).toBe(201);
    createdPolicyIds.push(policyRes.body.self_assessment_visibility_policy_id);

    const workerToken = await verifyAsWorker(fixtures);
    const { attemptId, sectionId, items } = await startSelfAssessmentAttempt(fixtures, workerToken);
    await scoreAndFinalize(sectionId, attemptId, items, workerToken);

    const staffView = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}/self-assessment-result`).set(auth(staffToken));
    expect(staffView.status).toBe(403);
  });

  it("regression (M5): GET /assessments/:id/items still 403s an EMPLOYEE-role token", async () => {
    const workerToken = await verifyAsWorker(fixtures);
    const assessmentRow = await pool.query(`SELECT assessment_id FROM assessment WHERE name = 'BRA Self-Assessment Quiz'`);
    const res = await agent.get(`/api/v1/v2/assessments/${assessmentRow.rows[0].assessment_id}/items`).set(auth(workerToken));
    expect(res.status).toBe(403);
  });
});

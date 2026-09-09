// The complete, real vertical slice, driven through supertest rather than
// bare fetch (scripts/replay_figma_demo_journey.mjs is the same journey
// against a running dev server, kept as a manual/demo tool — this is its
// automated, CI-friendly counterpart against the app object directly).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, resetWorkerVerificationLockout, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

describe("full E2E journey: Rajesh Kumar BRA E2 -> E3", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  afterAll(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await resetWorkerVerificationLockout(fixtures.rajeshWorkerId);
  });

  it("runs sign-in -> search -> profile -> package -> evaluate -> PASS -> approve x3 -> certify -> skill card, then the parallel worker self-assessment", async () => {
    // ---- Staff sign-in ----
    const supervisor = await devLogin("sunil_trainer");
    expect(supervisor.user.roles).toContain("SUPERVISOR");

    // ---- Worker search -> skill profile ----
    const search = await agent.get("/api/v1/v2/workers/search?q=EMP-2847").set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(search.status).toBe(200);
    expect(search.body).toHaveLength(1);
    const rajesh = search.body[0];

    const profile = await agent.get(`/api/v1/v2/workers/${rajesh.worker_id}/profile`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(profile.status).toBe(200);
    const braEnrollment = profile.body.enrollments.find((e: any) => e.process_code === "BRA");
    expect(braEnrollment).toBeTruthy();

    // ---- Resolve target level, create case, fetch package ----
    const levels = await agent.get(`/api/v1/v2/processes/${braEnrollment.process_id}/levels`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    const e3 = levels.body.levels.find((l: any) => l.code === "E3");
    expect(e3).toBeTruthy();

    const qcaseRes = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", "test-e2e-qc")
      .send({ workerId: rajesh.worker_id, processId: braEnrollment.process_id, targetProcessLevelId: e3.process_level_id });
    expect(qcaseRes.status).toBe(201);
    const qualificationCaseId = qcaseRes.body.qualification_case_id;

    const caseDetail = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(caseDetail.body.components.map((c: any) => Number(c.weight_pct))).toEqual([40, 35, 25, 0]);

    // ---- Start attempt, evaluate every mandatory component at full marks ----
    const attemptRes = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/attempts`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", "test-e2e-attempt")
      .send({});
    expect(attemptRes.status).toBe(201);
    const attemptId = attemptRes.body.assessment_attempt_id;

    const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attemptId}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    const mandatoryComponents = attemptDetail.body.componentAttempts.filter((c: any) => !c.self_assessment_enabled);
    expect(mandatoryComponents).toHaveLength(3);

    for (const component of mandatoryComponents) {
      const itemsRes = await agent.get(`/api/v1/v2/assessment-component-attempts/${component.assessment_component_attempt_id}/items`).set("Authorization", `Bearer ${supervisor.accessToken}`);
      const responses = itemsRes.body.map((it: any) => ({ assessmentItemId: it.assessment_item_id, score: it.max_score }));
      const scoreRes = await agent
        .post(`/api/v1/v2/assessment-component-attempts/${component.assessment_component_attempt_id}/score`)
        .set("Authorization", `Bearer ${supervisor.accessToken}`)
        .set("Idempotency-Key", `test-e2e-score-${component.assessment_component_attempt_id}`)
        .send({ responses });
      expect(scoreRes.status).toBe(200);
      expect(scoreRes.body.weightedPct).toBe(100);
    }

    // ---- Finalize -> PASS ----
    const finalizeRes = await agent
      .post(`/api/v1/v2/assessment-attempts/${attemptId}/finalize`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", "test-e2e-finalize")
      .send({});
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.result).toBe("PASS");

    const caseAfterPass = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(caseAfterPass.body.status).toBe("PENDING_APPROVAL");

    // ---- Approval chain: Supervisor -> HOD -> L&D, with a wrong-role rejection along the way ----
    const stage1 = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/approval/1/act`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", "test-e2e-approve1")
      .send({ action: "approved" });
    expect(stage1.status).toBe(200);

    const wrongRole = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/approval/2/act`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({ action: "approved" });
    expect(wrongRole.status).toBe(403);

    const hod = await devLogin("rajiv_hod");
    const stage2 = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/approval/2/act`)
      .set("Authorization", `Bearer ${hod.accessToken}`)
      .set("Idempotency-Key", "test-e2e-approve2")
      .send({ action: "approved" });
    expect(stage2.status).toBe(200);

    const caseMid = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${hod.accessToken}`);
    expect(caseMid.body.status).toBe("PENDING_APPROVAL"); // 2 of 3 — not yet fully approved

    const lnd = await devLogin("cwec_admin");
    const stage3 = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/approval/3/act`)
      .set("Authorization", `Bearer ${lnd.accessToken}`)
      .set("Idempotency-Key", "test-e2e-approve3")
      .send({ action: "approved" });
    expect(stage3.status).toBe(200);

    const caseApproved = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${lnd.accessToken}`);
    expect(caseApproved.body.status).toBe("APPROVED");

    // ---- Certify, twice (idempotent) ----
    const cert1 = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${lnd.accessToken}`)
      .set("Idempotency-Key", "test-e2e-certify-1")
      .send({});
    expect(cert1.status).toBe(201);

    const cert2 = await agent
      .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${lnd.accessToken}`)
      .set("Idempotency-Key", "test-e2e-certify-2")
      .send({});
    expect([200, 201]).toContain(cert2.status);
    expect(cert2.body.certificate_id).toBe(cert1.body.certificate_id);

    const caseCertified = await agent.get(`/api/v1/v2/qualification-cases/${qualificationCaseId}`).set("Authorization", `Bearer ${lnd.accessToken}`);
    expect(caseCertified.body.status).toBe("CERTIFIED");
    expect(caseCertified.body.certificate.certificate_number).toBe(cert1.body.certificate_number);

    // ---- Parallel journey: Worker Self-Assessment Portal ----
    const identify = await agent.post("/api/v1/worker-portal/identify").send({ employeeCode: "EMP-2847" });
    expect(identify.status).toBe(200);

    const badPin = await agent.post("/api/v1/worker-portal/verify").send({ workerId: rajesh.worker_id, method: "SUPERVISOR_PIN", pin: "0000" });
    expect(badPin.status).toBe(401);

    const verify = await agent.post("/api/v1/worker-portal/verify").send({ workerId: rajesh.worker_id, method: "SUPERVISOR_PIN", pin: "1234" });
    expect(verify.status).toBe(200);
    const workerToken = verify.body.accessToken;

    const selfCaseRes = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", "test-e2e-self-qc")
      .send({ workerId: rajesh.worker_id, processId: braEnrollment.process_id, targetProcessLevelId: e3.process_level_id });
    expect(selfCaseRes.status).toBe(201);
    const selfCaseId = selfCaseRes.body.qualification_case_id;
    expect(selfCaseId).not.toBe(qualificationCaseId); // the first case is CERTIFIED (terminal) — a fresh one is opened

    const selfAttemptRes = await agent
      .post(`/api/v1/v2/qualification-cases/${selfCaseId}/attempts`)
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", "test-e2e-self-attempt")
      .send({});
    expect(selfAttemptRes.status).toBe(201);
    const selfAttemptId = selfAttemptRes.body.assessment_attempt_id;

    const selfAttemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${selfAttemptId}`).set("Authorization", `Bearer ${workerToken}`);
    const selfComponent = selfAttemptDetail.body.componentAttempts.find((c: any) => c.self_assessment_enabled);
    expect(selfComponent).toBeTruthy();

    const selfItemsRes = await agent.get(`/api/v1/v2/assessment-component-attempts/${selfComponent.assessment_component_attempt_id}/items`).set("Authorization", `Bearer ${workerToken}`);
    const selfResponses = selfItemsRes.body.map((it: any) => ({ assessmentItemId: it.assessment_item_id, score: it.max_score }));
    const selfScoreRes = await agent
      .post(`/api/v1/v2/assessment-component-attempts/${selfComponent.assessment_component_attempt_id}/score`)
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", "test-e2e-self-score")
      .send({ responses: selfResponses });
    expect(selfScoreRes.status).toBe(200);

    const selfFinalizeRes = await agent
      .post(`/api/v1/v2/assessment-attempts/${selfAttemptId}/finalize`)
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", "test-e2e-self-finalize")
      .send({});
    expect(selfFinalizeRes.status).toBe(200);
    expect(selfFinalizeRes.body.selfAssessmentOnly).toBe(true);
    expect(selfFinalizeRes.body.passed).toBe(true);

    const selfCaseFinal = await pool.query(`SELECT status FROM qualification_case WHERE qualification_case_id = $1`, [selfCaseId]);
    expect(["DRAFT", "READY_FOR_ASSESSMENT"]).toContain(selfCaseFinal.rows[0].status);
    const resultCount = await pool.query(`SELECT count(*)::int AS cnt FROM qualification_result WHERE qualification_case_id = $1`, [selfCaseId]);
    expect(resultCount.rows[0].cnt).toBe(0);
    const certCount = await pool.query(`SELECT count(*)::int AS cnt FROM certificate WHERE qualification_case_id = $1`, [selfCaseId]);
    expect(certCount.rows[0].cnt).toBe(0);
  });
});

// Runs Rajesh Kumar's real BRA E2->E3 journey up to a chosen checkpoint,
// through the real HTTP routes — shared by every test that needs "a PASSed
// attempt" or "a fully approved case" as its starting state, so each test
// file doesn't re-derive 80 lines of setup.
import { agent, devLogin, type Fixtures, type DevLoginResult } from "./testApp.js";

export async function createCase(fixtures: Fixtures, supervisorToken: string, idemSuffix: string) {
  const res = await agent
    .post("/api/v1/v2/qualification-cases")
    .set("Authorization", `Bearer ${supervisorToken}`)
    .set("Idempotency-Key", `test-qc-${idemSuffix}`)
    .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
  if (![200, 201].includes(res.status)) throw new Error(`create case failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function startAttempt(token: string, qualificationCaseId: string, idemSuffix: string) {
  const res = await agent
    .post(`/api/v1/v2/qualification-cases/${qualificationCaseId}/attempts`)
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", `test-attempt-${idemSuffix}`)
    .send({});
  if (![200, 201].includes(res.status)) throw new Error(`start attempt failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// Sub-level gate (migration 0014): every mandatory sub-level of the target
// level must be signed off complete before finalizeAttempt will produce a
// result. The Supervisor/Trainer token does the sign-off.
export async function completeMandatorySubLevels(token: string, processId: string, levelId: string, workerId: string) {
  const res = await agent.get(`/api/v1/v2/processes/${processId}/levels/${levelId}/sub-levels`).set("Authorization", `Bearer ${token}`);
  if (res.status !== 200) throw new Error(`list sub-levels failed: ${res.status} ${JSON.stringify(res.body)}`);
  for (const sl of res.body.filter((s: any) => s.is_mandatory)) {
    const r = await agent
      .post(`/api/v1/v2/workers/${workerId}/sub-levels/${sl.process_sub_level_id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });
    if (![200, 201].includes(r.status)) throw new Error(`mark sub-level ${sl.code} failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
}

export async function scoreComponentFullMarks(token: string, componentAttemptId: string, idemSuffix: string) {
  const itemsRes = await agent.get(`/api/v1/v2/assessment-attempt-sections/${componentAttemptId}/items`).set("Authorization", `Bearer ${token}`);
  const responses = itemsRes.body.map((it: any) => ({ questionId: it.question_id, score: it.max_score, responseJson: { chosen: "full_credit" } }));
  const res = await agent
    .post(`/api/v1/v2/assessment-attempt-sections/${componentAttemptId}/score`)
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", `test-score-${idemSuffix}`)
    .send({ responses });
  if (res.status !== 200) throw new Error(`score component failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export interface SupervisorJourneyResult {
  supervisor: DevLoginResult;
  qualificationCaseId: string;
  attemptId: string;
  finalize: any;
  hod?: DevLoginResult;
  lnd?: DevLoginResult;
  certificate?: any;
}

// Runs the full Supervisor-side journey through a chosen checkpoint and
// returns everything a test might need to continue or assert against. Always
// returns the same shape (later fields undefined if not reached yet) so
// callers get one consistent type regardless of which checkpoint they asked
// for, rather than a union TypeScript can't narrow from a runtime string.
export async function runSupervisorJourney(fixtures: Fixtures, idemSuffix: string, upTo: "PASS" | "APPROVED" | "CERTIFIED"): Promise<SupervisorJourneyResult> {
  const supervisor = await devLogin("sunil_trainer");
  const qcase = await createCase(fixtures, supervisor.accessToken, idemSuffix);
  const attempt = await startAttempt(supervisor.accessToken, qcase.qualification_case_id, idemSuffix);

  const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
  const nonSelfComponents = attemptDetail.body.componentAttempts.filter((c: any) => !c.self_assessment_enabled);
  for (const c of nonSelfComponents) {
    await scoreComponentFullMarks(supervisor.accessToken, c.assessment_attempt_section_id, `${idemSuffix}-${c.assessment_attempt_section_id}`);
  }

  await completeMandatorySubLevels(supervisor.accessToken, fixtures.braProcessId, fixtures.levelIdByCode.E3, fixtures.rajeshWorkerId);

  const finalize = await agent
    .post(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}/finalize`)
    .set("Authorization", `Bearer ${supervisor.accessToken}`)
    .set("Idempotency-Key", `test-finalize-${idemSuffix}`)
    .send({});
  if (finalize.status !== 200) throw new Error(`finalize failed: ${finalize.status} ${JSON.stringify(finalize.body)}`);

  const result = { supervisor, qualificationCaseId: qcase.qualification_case_id, attemptId: attempt.assessment_attempt_id, finalize: finalize.body };
  if (upTo === "PASS") return result;

  const hod = await devLogin("rajiv_hod");
  const lnd = await devLogin("cwec_admin");
  await agent.post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/approval/1/act`).set("Authorization", `Bearer ${supervisor.accessToken}`).set("Idempotency-Key", `test-approve1-${idemSuffix}`).send({ action: "approved" }).then((r) => { if (r.status !== 200) throw new Error(`stage1 approve failed: ${r.status} ${JSON.stringify(r.body)}`); });
  await agent.post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/approval/2/act`).set("Authorization", `Bearer ${hod.accessToken}`).set("Idempotency-Key", `test-approve2-${idemSuffix}`).send({ action: "approved" }).then((r) => { if (r.status !== 200) throw new Error(`stage2 approve failed: ${r.status} ${JSON.stringify(r.body)}`); });
  await agent.post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/approval/3/act`).set("Authorization", `Bearer ${lnd.accessToken}`).set("Idempotency-Key", `test-approve3-${idemSuffix}`).send({ action: "approved" }).then((r) => { if (r.status !== 200) throw new Error(`stage3 approve failed: ${r.status} ${JSON.stringify(r.body)}`); });

  const withApproval = { ...result, hod, lnd };
  if (upTo === "APPROVED") return withApproval;

  const cert = await agent
    .post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/certify`)
    .set("Authorization", `Bearer ${lnd.accessToken}`)
    .set("Idempotency-Key", `test-certify-${idemSuffix}`)
    .send({});
  if (![200, 201].includes(cert.status)) throw new Error(`certify failed: ${cert.status} ${JSON.stringify(cert.body)}`);
  return { ...withApproval, certificate: cert.body };
}

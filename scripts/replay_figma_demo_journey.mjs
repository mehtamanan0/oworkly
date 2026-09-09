#!/usr/bin/env node
// Drives Rajesh Kumar's real E2 -> E3 Blade Root Assembly qualification
// journey through the live HTTP API (never touching the DB directly, except
// to read fixed ids seeded by ingestion/seed_figma_demo.mjs) — proving the
// whole vertical slice end to end exactly as described in the plan:
//
//   staff sign-in -> worker search -> skill profile -> assessment package
//   -> evaluate all mandatory components -> qualification result PASS
//   -> approval chain (Supervisor -> HOD -> L&D) -> certify -> certificate
//
// plus the parallel worker self-assessment portal journey (employee-code
// login -> supervisor-PIN verification -> quiz -> non-certifying result).
//
// Usage: node scripts/replay_figma_demo_journey.mjs
// Requires: the server running (npm run dev in server/), reachable at
// API_BASE (default http://localhost:4000/api/v1).

const API_BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}`);
}
function ok(label, detail) {
  console.log(`    OK  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function api(method, path, { token, body, idempotencyKey, expectStatus } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`${method} ${path} -> expected ${expectStatus}, got ${res.status}: ${text}`);
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log("=== OWorkly Figma Demo — Rajesh Kumar E2->E3 Blade Root Assembly journey ===");
  console.log(`API_BASE = ${API_BASE}`);

  // ---------------------------------------------------------------
  // Scenario A: Staff sign-in -> worker search -> skill profile
  // ---------------------------------------------------------------
  step("Trainer/Supervisor sign-in (dev-login: sunil_trainer)");
  const supervisorLogin = await api("POST", "/auth/dev-login", { body: { username: "sunil_trainer" }, expectStatus: 200 });
  const supervisorToken = supervisorLogin.body.accessToken;
  assert(supervisorLogin.body.user.roles.includes("SUPERVISOR"), "sunil_trainer must carry SUPERVISOR role");
  ok("signed in", { userId: supervisorLogin.body.user.userId, roles: supervisorLogin.body.user.roles, companyId: supervisorLogin.body.user.companyId });

  step("Worker search for Rajesh Kumar (EMP-2847)");
  const search = await api("GET", "/v2/workers/search?q=EMP-2847", { token: supervisorToken, expectStatus: 200 });
  assert(search.body.length === 1, `expected exactly 1 match for EMP-2847, got ${search.body.length}`);
  const rajesh = search.body[0];
  assert(rajesh.hrms_employee_code === "EMP-2847" && rajesh.first_name === "Rajesh", "worker search must return Rajesh Kumar");
  ok("found worker", { workerId: rajesh.worker_id, name: `${rajesh.first_name} ${rajesh.last_name}` });

  step("Skill profile for Rajesh Kumar");
  const profile = await api("GET", `/v2/workers/${rajesh.worker_id}/profile`, { token: supervisorToken, expectStatus: 200 });
  const braEnrollment = profile.body.enrollments?.find((e) => e.process_code === "BRA") ?? profile.body.find?.((e) => e.process_code === "BRA");
  ok("profile loaded", { enrollments: Array.isArray(profile.body.enrollments) ? profile.body.enrollments.length : "n/a" });

  // ---------------------------------------------------------------
  // Scenario B: Create/get qualification case for BRA E2->E3, start attempt
  // ---------------------------------------------------------------
  step("Resolve BRA process and E3 target process level");
  const companies = await api("GET", "/v2/companies", { token: supervisorToken, expectStatus: 200 });
  const cwe = companies.body.find((c) => c.code === "CWE");
  assert(cwe, "CWE company must exist");

  // Process levels are fetched via /v2/processes/:id/levels, so first resolve
  // the BRA process id from the worker's own enrollments (already returned in
  // the /profile response above).
  const braProcessId = (profile.body.enrollments ?? []).find((e) => e.process_code === "BRA")?.process_id;
  assert(braProcessId, "Rajesh's profile must include a BRA enrollment with process_id");
  const levels = await api("GET", `/v2/processes/${braProcessId}/levels`, { token: supervisorToken, expectStatus: 200 });
  const e3 = levels.body.levels.find((l) => l.code === "E3");
  assert(e3, "BRA process must have an E3 level");
  ok("resolved", { braProcessId, e3LevelId: e3.process_level_id });

  step("Create (or get) qualification case: Rajesh Kumar, BRA, target E3");
  const caseIdemKey = `demo-qc-${rajesh.worker_id}-${braProcessId}-${e3.process_level_id}`;
  const qcaseRes = await api("POST", "/v2/qualification-cases", {
    token: supervisorToken,
    idempotencyKey: caseIdemKey,
    body: { workerId: rajesh.worker_id, processId: braProcessId, targetProcessLevelId: e3.process_level_id },
  });
  assert([200, 201].includes(qcaseRes.status), `create case -> ${qcaseRes.status}: ${JSON.stringify(qcaseRes.body)}`);
  const qualificationCaseId = qcaseRes.body.qualification_case_id;
  ok("qualification case", { qualificationCaseId, status: qcaseRes.body.status, qualificationNumber: qcaseRes.body.qualification_number });

  step("Fetch assessment package for the case (Assessment Package screen)");
  const caseDetail = await api("GET", `/v2/qualification-cases/${qualificationCaseId}`, { token: supervisorToken, expectStatus: 200 });
  assert(caseDetail.body.components.length === 4, `expected 4 package components, got ${caseDetail.body.components.length}`);
  const weights = caseDetail.body.components.map((c) => Number(c.weight_pct));
  assert(JSON.stringify(weights) === JSON.stringify([40, 35, 25, 0]), `expected weights [40,35,25,0], got ${JSON.stringify(weights)}`);
  ok("package confirmed", { components: caseDetail.body.components.map((c) => `${c.name} (${c.weight_pct}%)`) });

  step("Start assessment attempt");
  const attemptRes = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/attempts`, {
    token: supervisorToken,
    idempotencyKey: `demo-attempt-${qualificationCaseId}`,
    body: {},
  });
  assert([200, 201].includes(attemptRes.status), `start attempt -> ${attemptRes.status}: ${JSON.stringify(attemptRes.body)}`);
  const attemptId = attemptRes.body.assessment_attempt_id;
  ok("attempt started", { attemptId, attemptNo: attemptRes.body.attempt_no });

  const attemptDetail = await api("GET", `/v2/assessment-attempts/${attemptId}`, { token: supervisorToken, expectStatus: 200 });
  const componentByType = Object.fromEntries(attemptDetail.body.componentAttempts.map((c) => [c.component_type + (c.self_assessment_enabled ? ":self" : ""), c]));

  // ---------------------------------------------------------------
  // Scenario C: evaluate all 3 mandatory components -> high score -> PASS
  // ---------------------------------------------------------------
  async function scoreAll(componentAttemptId, label) {
    const items = await api("GET", `/v2/assessment-component-attempts/${componentAttemptId}/items`, { token: supervisorToken, expectStatus: 200 });
    assert(items.body.length > 0, `${label} must have at least one item`);
    const responses = items.body.map((it) => ({
      assessmentItemId: it.assessment_item_id,
      score: it.max_score, // full marks — proves the "confident PASS" screenshot path
      responseJson: it.item_type === "RATING_1_5" ? { rating: it.rating_scale_max ?? 5 } : { chosen: "full_credit" },
      assessorRemark: `Demo replay: ${label} scored at max by Supervisor Sunil Mehta`,
    }));
    const scored = await api("POST", `/v2/assessment-component-attempts/${componentAttemptId}/score`, {
      token: supervisorToken,
      idempotencyKey: `demo-score-${componentAttemptId}`,
      body: { responses },
      expectStatus: 200,
    });
    ok(`scored ${label}`, { raw: scored.body.raw, max: scored.body.max, weightedPct: scored.body.weightedPct });
    return scored.body;
  }

  step("Evaluate: Practical component (1-5 checklist grid)");
  await scoreAll(componentByType["PRACTICAL"].assessment_component_attempt_id, "BRA Practical Evaluation");

  step("Evaluate: Theory component (Process Knowledge Test, MCQ)");
  await scoreAll(componentByType["THEORY"].assessment_component_attempt_id, "BRA Process Knowledge Test");

  step("Evaluate: Behavioural component (rating)");
  await scoreAll(componentByType["BEHAVIOURAL"].assessment_component_attempt_id, "BRA Behavioural Rating");

  step("Finalize attempt -> expect qualification result PASS");
  const finalizeRes = await api("POST", `/v2/assessment-attempts/${attemptId}/finalize`, {
    token: supervisorToken,
    idempotencyKey: `demo-finalize-${attemptId}`,
    body: {},
    expectStatus: 200,
  });
  assert(finalizeRes.body.selfAssessmentOnly === false, "this finalize must be a real (non-self-assessment) result");
  assert(finalizeRes.body.result === "PASS", `expected PASS, got ${finalizeRes.body.result} (weighted ${finalizeRes.body.weightedTotal}% vs threshold ${finalizeRes.body.passThreshold}%)`);
  ok("qualification result", { result: finalizeRes.body.result, weightedTotal: finalizeRes.body.weightedTotal, passThreshold: finalizeRes.body.passThreshold });

  const caseAfterPass = await api("GET", `/v2/qualification-cases/${qualificationCaseId}`, { token: supervisorToken, expectStatus: 200 });
  assert(caseAfterPass.body.status === "PENDING_APPROVAL", `expected PENDING_APPROVAL, got ${caseAfterPass.body.status}`);
  ok("case status", caseAfterPass.body.status);

  // ---------------------------------------------------------------
  // Scenario D: approval chain Supervisor -> HOD -> L&D (screenshot 08: "2 of 3" mid-state, then full approve)
  // ---------------------------------------------------------------
  step("Approval status before any action (screen: 3 stages, none acted)");
  const approvalBefore = await api("GET", `/v2/qualification-cases/${qualificationCaseId}/approval`, { token: supervisorToken, expectStatus: 200 });
  assert(approvalBefore.body.stages.length === 3, `expected 3 approval stages, got ${approvalBefore.body.stages.length}`);
  ok("stages", approvalBefore.body.stages.map((s) => `${s.sequence_no}:${s.role_code ?? s.role_name}`));

  step("Self-approval must be rejected (Supervisor cannot approve Rajesh's own case as himself, since Sunil ≠ Rajesh — expect this to actually succeed since Sunil is a different worker; real self-approval block is exercised by trying Rajesh's own token, skipped here as Rajesh has no staff login)");
  const stage1 = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/approval/1/act`, {
    token: supervisorToken,
    idempotencyKey: `demo-approve-1-${qualificationCaseId}`,
    body: { action: "approved", remarks: "Practical and theory scores confirmed on the floor." },
    expectStatus: 200,
  });
  ok("stage 1 (Supervisor) approved", { action: stage1.body.action });

  step("Wrong-role attempt on stage 2 must be rejected (Supervisor cannot act as HOD)");
  const wrongRole = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/approval/2/act`, {
    token: supervisorToken,
    body: { action: "approved" },
  });
  assert(wrongRole.status === 403, `expected 403 for wrong-role approval attempt, got ${wrongRole.status}`);
  ok("correctly rejected", { status: wrongRole.status, title: wrongRole.body.title });

  step("HOD sign-in and stage 2 approval (screenshot 08 mid-state: 2 of 3 done)");
  const hodLogin = await api("POST", "/auth/dev-login", { body: { username: "rajiv_hod" }, expectStatus: 200 });
  const hodToken = hodLogin.body.accessToken;
  const stage2 = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/approval/2/act`, {
    token: hodToken,
    idempotencyKey: `demo-approve-2-${qualificationCaseId}`,
    body: { action: "approved", remarks: "Concur with Supervisor assessment." },
    expectStatus: 200,
  });
  ok("stage 2 (HOD) approved", { action: stage2.body.action });

  const caseMidApproval = await api("GET", `/v2/qualification-cases/${qualificationCaseId}`, { token: hodToken, expectStatus: 200 });
  assert(caseMidApproval.body.status === "PENDING_APPROVAL", `expected still PENDING_APPROVAL after 2 of 3, got ${caseMidApproval.body.status}`);
  ok("case status after 2 of 3 stages", caseMidApproval.body.status);

  step("L&D (cwec_admin, LND_TEAM role) sign-in and stage 3 approval -> case fully APPROVED");
  const lndLogin = await api("POST", "/auth/dev-login", { body: { username: "cwec_admin" }, expectStatus: 200 });
  const lndToken = lndLogin.body.accessToken;
  const stage3 = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/approval/3/act`, {
    token: lndToken,
    idempotencyKey: `demo-approve-3-${qualificationCaseId}`,
    body: { action: "approved", remarks: "Final L&D sign-off." },
    expectStatus: 200,
  });
  ok("stage 3 (L&D) approved", { action: stage3.body.action });

  const caseApproved = await api("GET", `/v2/qualification-cases/${qualificationCaseId}`, { token: lndToken, expectStatus: 200 });
  assert(caseApproved.body.status === "APPROVED", `expected APPROVED, got ${caseApproved.body.status}`);
  ok("case status", caseApproved.body.status);

  // ---------------------------------------------------------------
  // Scenario E: Certify -> Certificate -> Skill Card
  // ---------------------------------------------------------------
  step("Issue certificate (idempotent)");
  const certRes1 = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/certify`, {
    token: lndToken,
    idempotencyKey: `demo-certify-${qualificationCaseId}`,
    body: {},
  });
  assert([200, 201].includes(certRes1.status), `certify -> ${certRes1.status}: ${JSON.stringify(certRes1.body)}`);
  ok("certificate issued", { certificateNumber: certRes1.body.certificate_number, validFrom: certRes1.body.valid_from, validTo: certRes1.body.valid_to });

  step("Re-issuing certificate must be idempotent (same certificate_id returned)");
  const certRes2 = await api("POST", `/v2/qualification-cases/${qualificationCaseId}/certify`, {
    token: lndToken,
    idempotencyKey: `demo-certify-${qualificationCaseId}-second-call`,
    body: {},
  });
  assert([200, 201].includes(certRes2.status), `re-certify -> ${certRes2.status}: ${JSON.stringify(certRes2.body)}`);
  assert(certRes2.body.certificate_id === certRes1.body.certificate_id, "second certify call must return the SAME certificate, not create a duplicate");
  ok("idempotent certify confirmed", { certificateId: certRes2.body.certificate_id });

  const caseCertified = await api("GET", `/v2/qualification-cases/${qualificationCaseId}`, { token: lndToken, expectStatus: 200 });
  assert(caseCertified.body.status === "CERTIFIED", `expected CERTIFIED, got ${caseCertified.body.status}`);
  assert(caseCertified.body.certificate?.certificate_number === certRes1.body.certificate_number, "case detail must surface the issued certificate");
  ok("final case status (Skill Card / Passport ready)", caseCertified.body.status);

  // ---------------------------------------------------------------
  // Scenario F: Worker Self-Assessment Portal (parallel, non-certifying)
  // ---------------------------------------------------------------
  step("Worker portal: identify by employee code EMP-2847");
  const identify = await api("POST", "/worker-portal/identify", { body: { employeeCode: "EMP-2847" }, expectStatus: 200 });
  assert(identify.body.verificationMethodsAvailable.includes("SUPERVISOR_PIN"), "Rajesh must have a SUPERVISOR_PIN credential configured");
  ok("identified", { workerId: identify.body.worker_id, name: `${identify.body.first_name} ${identify.body.last_name}` });

  step("Worker portal: wrong PIN must be rejected");
  const badPin = await api("POST", "/worker-portal/verify", { body: { workerId: identify.body.worker_id, method: "SUPERVISOR_PIN", pin: "0000" } });
  assert(badPin.status === 401, `expected 401 for wrong PIN, got ${badPin.status}`);
  ok("wrong PIN correctly rejected", badPin.status);

  step("Worker portal: verify with correct Supervisor PIN (1234)");
  const verify = await api("POST", "/worker-portal/verify", { body: { workerId: identify.body.worker_id, method: "SUPERVISOR_PIN", pin: "1234" }, expectStatus: 200 });
  const workerToken = verify.body.accessToken;
  ok("verified — worker session issued", { hasToken: !!workerToken });

  step("Worker self-assessment: create/get a case for the SAME target level, start attempt, score ONLY the self-assessment component");
  const selfCaseRes = await api("POST", "/v2/qualification-cases", {
    token: workerToken,
    idempotencyKey: `demo-self-qc-${rajesh.worker_id}-${braProcessId}-${e3.process_level_id}`,
    body: { workerId: rajesh.worker_id, processId: braProcessId, targetProcessLevelId: e3.process_level_id },
  });
  // This will return the SAME case created earlier (still open until certified — but
  // it's now CERTIFIED, so createOrGetCase will open a fresh one). Either way the
  // rest of the flow proceeds against whatever qualification_case_id comes back.
  const selfQualificationCaseId = selfCaseRes.body.qualification_case_id;
  const selfAttemptRes = await api("POST", `/v2/qualification-cases/${selfQualificationCaseId}/attempts`, {
    token: workerToken,
    idempotencyKey: `demo-self-attempt-${selfQualificationCaseId}`,
    body: {},
  });
  assert([200, 201].includes(selfAttemptRes.status), `self-assessment start attempt -> ${selfAttemptRes.status}: ${JSON.stringify(selfAttemptRes.body)}`);
  const selfAttemptId = selfAttemptRes.body.assessment_attempt_id;
  const selfAttemptDetail = await api("GET", `/v2/assessment-attempts/${selfAttemptId}`, { token: workerToken, expectStatus: 200 });
  const selfComponent = selfAttemptDetail.body.componentAttempts.find((c) => c.self_assessment_enabled);
  assert(selfComponent, "the package must include a self-assessment component");

  const selfItems = await api("GET", `/v2/assessment-component-attempts/${selfComponent.assessment_component_attempt_id}/items`, { token: workerToken, expectStatus: 200 });
  const selfResponses = selfItems.body.map((it) => ({ assessmentItemId: it.assessment_item_id, score: it.max_score, responseJson: { chosen: "self_reported_confident" } }));
  await api("POST", `/v2/assessment-component-attempts/${selfComponent.assessment_component_attempt_id}/score`, {
    token: workerToken,
    idempotencyKey: `demo-self-score-${selfComponent.assessment_component_attempt_id}`,
    body: { responses: selfResponses },
    expectStatus: 200,
  });
  ok("self-assessment quiz scored", { items: selfResponses.length });

  step("Finalize self-assessment attempt -> must be non-certifying, must NOT touch qualification_case or create a qualification_result");
  const selfFinalize = await api("POST", `/v2/assessment-attempts/${selfAttemptId}/finalize`, {
    token: workerToken,
    idempotencyKey: `demo-self-finalize-${selfAttemptId}`,
    body: {},
    expectStatus: 200,
  });
  assert(selfFinalize.body.selfAssessmentOnly === true, "worker-only quiz attempt must be flagged selfAssessmentOnly");
  ok("self-assessment result (readiness only, not certifying)", { passed: selfFinalize.body.passed, compositePct: selfFinalize.body.compositePct });

  const selfCaseAfter = await api("GET", `/v2/qualification-cases/${selfQualificationCaseId}`, { token: supervisorToken, expectStatus: 200 });
  assert(selfCaseAfter.body.status === "DRAFT" || selfCaseAfter.body.status === "READY_FOR_ASSESSMENT", `self-assessment must NOT advance the qualification case's real status — got ${selfCaseAfter.body.status}`);
  assert(!selfCaseAfter.body.result, "self-assessment must NOT create a qualification_result");
  assert(!selfCaseAfter.body.certificate, "self-assessment must NEVER produce a certificate");
  ok("confirmed: self-assessment did not certify, did not create a result, did not change case status", selfCaseAfter.body.status);

  console.log("\n=== ALL SCENARIOS PASSED ===");
  console.log(`Rajesh Kumar (EMP-2847): BRA E2 -> E3, PASS, approved by Supervisor->HOD->L&D, certified as ${certRes1.body.certificate_number}`);
  console.log("Parallel worker self-assessment portal journey: verified PIN, scored quiz, non-certifying result confirmed.");
}

main().catch((err) => {
  console.error("\n=== JOURNEY REPLAY FAILED ===");
  console.error(err);
  process.exit(1);
});

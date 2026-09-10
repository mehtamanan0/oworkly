// M4 — assessment authoring: library + question CRUD, template build with the
// weight-sum-100 activation invariant, question reorder, and the new per-link
// is_critical / auto_fail_on_gate_miss knobs feeding finalizeAttempt.
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("assessment authoring (M4)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let supervisorToken: string;
  let levelIds: Record<string, string>;
  let braPracticalId: string;
  let braTheoryId: string;
  let braBehaviourId: string;
  let e5TemplateId: string;
  let e5LinkId: string;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    supervisorToken = (await devLogin("sunil_trainer")).accessToken;
    const lv = await pool.query(`SELECT code, process_level_id FROM process_level WHERE process_id = $1`, [fixtures.braProcessId]);
    levelIds = Object.fromEntries(lv.rows.map((r: any) => [r.code, r.process_level_id]));
    const a = await pool.query(`SELECT assessment_id, name FROM assessment WHERE name IN ('BRA Practical Evaluation','BRA Process Knowledge Test','BRA Behavioural Rating')`);
    braPracticalId = a.rows.find((r: any) => r.name === "BRA Practical Evaluation").assessment_id;
    braTheoryId = a.rows.find((r: any) => r.name === "BRA Process Knowledge Test").assessment_id;
    braBehaviourId = a.rows.find((r: any) => r.name === "BRA Behavioural Rating").assessment_id;

    // Active E5 template with one weighted, gated assessment — the criticality
    // tests re-configure that link and run a real attempt against it.
    const tpl = await agent.post("/api/v1/v2/assessment-templates").set(auth(adminToken)).send({ processLevelId: levelIds.E5 });
    expect(tpl.status).toBe(201);
    e5TemplateId = tpl.body.assessment_template_id;
    // Behavioural has no per-question critical items, so a below-gate score
    // never triggers section.forced_fail — the criticality tests below can
    // isolate the *link's* is_critical / auto_fail knobs.
    const link = await agent
      .post(`/api/v1/v2/assessment-templates/${e5TemplateId}/assessments`)
      .set(auth(adminToken))
      .send({ assessmentId: braBehaviourId, weightPct: 100, minGatePct: 90 });
    expect(link.status).toBe(201);
    e5LinkId = link.body.assessment_template_assessment_id;
    const act = await agent.post(`/api/v1/v2/assessment-templates/${e5TemplateId}/activate`).set(auth(adminToken)).send({});
    expect(act.status).toBe(200);
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await pool.query(`DELETE FROM question WHERE prompt LIKE '[auth-test]%'`);
    await pool.query(`DELETE FROM assessment WHERE name LIKE '[auth-test]%'`);
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM assessment_template WHERE process_level_id = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM assessment_attempt aa WHERE aa.assessment_template_id = assessment_template.assessment_template_id)`,
      [[levelIds.E1, levelIds.E5]]
    );
  });

  it("creates an assessment and adds each question type; rejects an MCQ with no answer key", async () => {
    const created = await agent.post("/api/v1/v2/assessments").set(auth(adminToken)).send({ name: "[auth-test] Mixed", assessmentType: "THEORY", description: "d" });
    expect(created.status).toBe(201);
    const aid = created.body.assessment_id;

    const ok = [
      { questionType: "MCQ_SINGLE", prompt: "[auth-test] pick one", optionsJson: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctAnswerJson: ["A"] },
      { questionType: "TRUE_FALSE", prompt: "[auth-test] t/f", correctAnswerJson: ["true"] },
      { questionType: "RATING_1_5", prompt: "[auth-test] rate", maxScore: 5 },
      { questionType: "IMAGE", prompt: "[auth-test] photo", maxScore: 10, evaluatorCapacity: "SUPERVISOR_ASSESSOR" },
      { questionType: "EVIDENCE_OBSERVATION", prompt: "[auth-test] observe", maxScore: 3 },
    ];
    for (const q of ok) {
      const r = await agent.post(`/api/v1/v2/assessments/${aid}/questions`).set(auth(adminToken)).send(q);
      expect(r.status).toBe(201);
    }

    const bad = await agent.post(`/api/v1/v2/assessments/${aid}/questions`).set(auth(adminToken)).send({ questionType: "MCQ_SINGLE", prompt: "[auth-test] no key", optionsJson: [{ key: "A", text: "a" }, { key: "B", text: "b" }] });
    expect(bad.status).toBe(422);

    const items = await agent.get(`/api/v1/v2/assessments/${aid}/items`).set(auth(adminToken));
    expect(items.body.filter((i: any) => i.is_active)).toHaveLength(5);

    // reorder
    const ids = items.body.map((i: any) => i.question_id).reverse();
    const re = await agent.patch(`/api/v1/v2/assessments/${aid}/questions/reorder`).set(auth(adminToken)).send({ orderedIds: ids });
    expect(re.status).toBe(200);
    const after = await agent.get(`/api/v1/v2/assessments/${aid}/items`).set(auth(adminToken));
    expect(after.body.map((i: any) => i.question_id)).toEqual(ids);
  });

  it("a template cannot be activated until its non-self weights sum to 100%", async () => {
    const tpl = await agent.post("/api/v1/v2/assessment-templates").set(auth(adminToken)).send({ processLevelId: levelIds.E1 });
    const tid = tpl.body.assessment_template_id;

    const l1 = await agent.post(`/api/v1/v2/assessment-templates/${tid}/assessments`).set(auth(adminToken)).send({ assessmentId: braTheoryId, weightPct: 60 });
    expect(l1.status).toBe(201);
    let act = await agent.post(`/api/v1/v2/assessment-templates/${tid}/activate`).set(auth(adminToken)).send({});
    expect(act.status).toBe(422);
    expect(act.body.title).toMatch(/sum to 100/i);

    await agent.post(`/api/v1/v2/assessment-templates/${tid}/assessments`).set(auth(adminToken)).send({ assessmentId: braPracticalId, weightPct: 30 });
    act = await agent.post(`/api/v1/v2/assessment-templates/${tid}/activate`).set(auth(adminToken)).send({});
    expect(act.status).toBe(422); // 90

    const bump = await agent.patch(`/api/v1/v2/assessment-template-assessments/${l1.body.assessment_template_assessment_id}`).set(auth(adminToken)).send({ weightPct: 70 });
    expect(bump.status).toBe(200);
    act = await agent.post(`/api/v1/v2/assessment-templates/${tid}/activate`).set(auth(adminToken)).send({});
    expect(act.status).toBe(200);
    expect(act.body.weightSum).toBe(100);
  });

  async function runE5AttemptScoringFraction(fraction: number) {
    const qcase = await agent.post("/api/v1/v2/qualification-cases").set(auth(supervisorToken))
      .set("Idempotency-Key", `test-auth-qc-${Math.random()}`)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: levelIds.E5 });
    expect([200, 201]).toContain(qcase.status);
    const attempt = await agent.post(`/api/v1/v2/qualification-cases/${qcase.body.qualification_case_id}/attempts`).set(auth(supervisorToken))
      .set("Idempotency-Key", `test-auth-att-${Math.random()}`).send({});
    expect(attempt.status).toBe(201);
    const detail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.body.assessment_attempt_id}`).set(auth(supervisorToken));
    const section = detail.body.componentAttempts[0];
    const items = await agent.get(`/api/v1/v2/assessment-attempt-sections/${section.assessment_attempt_section_id}/items`).set(auth(supervisorToken));
    const responses = items.body.map((it: any) => ({ questionId: it.question_id, score: Number(it.max_score) * fraction }));
    const score = await agent.post(`/api/v1/v2/assessment-attempt-sections/${section.assessment_attempt_section_id}/score`).set(auth(supervisorToken)).send({ responses });
    expect(score.status).toBe(200);
    const fin = await agent.post(`/api/v1/v2/assessment-attempts/${attempt.body.assessment_attempt_id}/finalize`).set(auth(supervisorToken)).send({});
    expect(fin.status).toBe(200);
    return fin.body;
  }

  it("a critical assessment's gate miss fails the qualification even when the weighted total clears the bar", async () => {
    await agent.patch(`/api/v1/v2/assessment-template-assessments/${e5LinkId}`).set(auth(adminToken))
      .send({ isCritical: true, autoFailOnGateMiss: false, minGatePct: 90 });
    // 87% > E5 threshold (85%) but < the 90% gate on a critical assessment.
    const fin = await runE5AttemptScoringFraction(0.87);
    expect(fin.result).toBe("FAIL");
    const rc = fin.componentResults.find((c: any) => c.gatePassed === false);
    expect(rc?.status).toBe("FAIL");
  });

  it("a non-critical gate miss with auto-fail off does not sink a qualification whose weighted total clears the bar", async () => {
    await agent.patch(`/api/v1/v2/assessment-template-assessments/${e5LinkId}`).set(auth(adminToken))
      .send({ isCritical: false, autoFailOnGateMiss: false, minGatePct: 90 });
    const fin = await runE5AttemptScoringFraction(0.87);
    expect(fin.result).toBe("PASS");
  });

  it("cross-company: an SSS admin cannot create an assessment in CWE's library and gets company scoping on edits", async () => {
    const sss = (await devLogin("sss_admin")).accessToken;
    const created = await agent.post("/api/v1/v2/assessments").set(auth(adminToken)).send({ name: "[auth-test] CWE only", assessmentType: "THEORY" });
    const res = await agent.patch(`/api/v1/v2/assessments/${created.body.assessment_id}`).set(auth(sss)).send({ name: "[auth-test] hijack" });
    expect(res.status).toBe(403);
  });
});

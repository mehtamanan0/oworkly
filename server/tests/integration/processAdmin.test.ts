// M7: process + level authoring (default 2 levels, add-level, archive with
// dependency checks) and the generic level-progression-rule engine wired
// into finalizeAttempt.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PREFIX = "ZZPROC";

describe("process & level admin + progression rules (M7)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let sssAdminToken: string;
  let orgUnitId: string;
  const createdProcessIds: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
    const unit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [fixtures.cweCompanyId]);
    orgUnitId = unit.rows[0].org_unit_id;
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  afterAll(async () => {
    for (const processId of createdProcessIds) {
      await pool.query(`DELETE FROM approval_policy_stage WHERE approval_policy_id IN (SELECT approval_policy_id FROM approval_policy WHERE process_id = $1)`, [processId]);
      await pool.query(`DELETE FROM approval_policy WHERE process_id = $1`, [processId]);
      await pool.query(`DELETE FROM worker_process_enrollment WHERE process_id = $1`, [processId]);
      await pool.query(
        `DELETE FROM assessment_template_role_scope WHERE assessment_template_id IN (SELECT assessment_template_id FROM assessment_template WHERE process_level_id IN (SELECT process_level_id FROM process_level WHERE process_id = $1))`,
        [processId]
      );
      await pool.query(`DELETE FROM assessment_template WHERE process_level_id IN (SELECT process_level_id FROM process_level WHERE process_id = $1)`, [processId]);
      await pool.query(`DELETE FROM process_level_progression_rule WHERE process_level_id IN (SELECT process_level_id FROM process_level WHERE process_id = $1)`, [processId]);
      await pool.query(`DELETE FROM process_level WHERE process_id = $1`, [processId]);
      await pool.query(`DELETE FROM audit_log WHERE entity_name = 'process' AND entity_id = $1`, [processId]);
      await pool.query(`DELETE FROM process WHERE process_id = $1`, [processId]);
    }
  });

  it("creates a process with two default levels, rejects a duplicate code, and supports add-level with archive dependency checks", async () => {
    const code = `${PREFIX}${Math.floor(Math.random() * 100000)}`;
    const created = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/processes`).set(auth(adminToken)).send({ orgUnitId, code, name: "Test Process" });
    expect(created.status).toBe(201);
    createdProcessIds.push(created.body.process_id);
    expect(created.body.levels).toHaveLength(2);
    expect(created.body.levels.map((l: any) => l.code)).toEqual(["E1", "E2"]);

    const dup = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/processes`).set(auth(adminToken)).send({ orgUnitId, code, name: "Duplicate" });
    expect(dup.status).toBe(409);

    const level3 = await agent.post(`/api/v1/v2/processes/${created.body.process_id}/levels`).set(auth(adminToken)).send({ code: "E3", name: "Proficient" });
    expect(level3.status).toBe(201);
    expect(level3.body.ordinal).toBe(3);

    const dupLevel = await agent.post(`/api/v1/v2/processes/${created.body.process_id}/levels`).set(auth(adminToken)).send({ code: "E3", name: "Dup" });
    expect(dupLevel.status).toBe(409);

    // no template/enrollment references it yet -> archive succeeds
    const archived = await agent.post(`/api/v1/v2/process-levels/${level3.body.process_level_id}/archive`).set(auth(adminToken)).send({});
    expect(archived.status).toBe(200);
    expect(archived.body.is_active).toBe(false);

    const restored = await agent.post(`/api/v1/v2/process-levels/${level3.body.process_level_id}/restore`).set(auth(adminToken)).send({});
    expect(restored.status).toBe(200);
    expect(restored.body.is_active).toBe(true);
  });

  it("a cross-company admin cannot create a process for another company", async () => {
    const res = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/processes`).set(auth(sssAdminToken)).send({ orgUnitId, code: `${PREFIX}X`, name: "Should fail" });
    expect(res.status).toBe(403);
  });

  describe("progression rules gate finalizeAttempt", () => {
    let processId: string;
    let e2LevelId: string;
    let ruleId: string;
    const supervisorToken = () => devLogin("sunil_trainer").then((r) => r.accessToken);

    beforeAll(async () => {
      const code = `${PREFIX}${Math.floor(Math.random() * 100000)}`;
      const created = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/processes`).set(auth(adminToken)).send({ orgUnitId, code, name: "Progression Test Process" });
      processId = created.body.process_id;
      createdProcessIds.push(processId);
      e2LevelId = created.body.levels[1].process_level_id;

      // Link a real (no-critical-question) assessment to E2 and activate at 100%.
      const behaviour = await pool.query(`SELECT assessment_id FROM assessment WHERE name = 'BRA Behavioural Rating'`);
      const tpl = await agent.post("/api/v1/v2/assessment-templates").set(auth(adminToken)).send({ processLevelId: e2LevelId });
      await agent.post(`/api/v1/v2/assessment-templates/${tpl.body.assessment_template_id}/assessments`).set(auth(adminToken)).send({ assessmentId: behaviour.rows[0].assessment_id, weightPct: 100, minGatePct: 0 });
      await agent.post(`/api/v1/v2/assessment-templates/${tpl.body.assessment_template_id}/activate`).set(auth(adminToken)).send({});

      // Enroll Rajesh in this brand-new process.
      await agent.post(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/enroll`).set(auth(adminToken)).send({ processId, targetProcessLevelId: e2LevelId });

      // finalizeAttempt's PASS branch requires an approval_policy for the
      // process (or a company-wide default, which CWE doesn't seed) --
      // a brand-new process has none until an admin configures one. Approval-
      // policy authoring isn't part of M7's scope; seed the minimal policy
      // directly so finalize can reach its progression-rule check at all.
      const supervisorRole = await pool.query(`SELECT role_id FROM role WHERE role_code = 'SUPERVISOR'`);
      const policy = await pool.query(
        `INSERT INTO approval_policy (company_id, process_id, name) VALUES ($1,$2,'Test Policy') RETURNING approval_policy_id`,
        [fixtures.cweCompanyId, processId]
      );
      await pool.query(
        `INSERT INTO approval_policy_stage (approval_policy_id, sequence_no, role_id, stage_label) VALUES ($1,1,$2,'Supervisor')`,
        [policy.rows[0].approval_policy_id, supervisorRole.rows[0].role_id]
      );
    });

    // Sets up ONE scored, in-progress attempt (case + attempt + full-marks
    // score) and returns its id -- finalize is called separately, and can be
    // retried against the same attempt after a rule change without
    // re-scoring, since a failed (rule-blocked) finalize rolls back and
    // leaves the attempt untouched.
    async function setupScoredAttempt(): Promise<{ token: string; attemptId: string }> {
      const token = await supervisorToken();
      const qcase = await agent.post("/api/v1/v2/qualification-cases").set(auth(token)).set("Idempotency-Key", `test-proc-qc-${Math.random()}`).send({ workerId: fixtures.rajeshWorkerId, processId, targetProcessLevelId: e2LevelId });
      expect([200, 201]).toContain(qcase.status);
      const attempt = await agent.post(`/api/v1/v2/qualification-cases/${qcase.body.qualification_case_id}/attempts`).set(auth(token)).set("Idempotency-Key", `test-proc-att-${Math.random()}`).send({});
      expect(attempt.status).toBe(201);
      const detail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.body.assessment_attempt_id}`).set(auth(token));
      const section = detail.body.componentAttempts[0];
      const items = await agent.get(`/api/v1/v2/assessment-attempt-sections/${section.assessment_attempt_section_id}/items`).set(auth(token));
      const responses = items.body.map((it: any) => ({ questionId: it.question_id, score: Number(it.max_score) }));
      const score = await agent.post(`/api/v1/v2/assessment-attempt-sections/${section.assessment_attempt_section_id}/score`).set(auth(token)).send({ responses });
      expect(score.status).toBe(200);
      return { token, attemptId: attempt.body.assessment_attempt_id };
    }
    const finalize = (token: string, attemptId: string) => agent.post(`/api/v1/v2/assessment-attempts/${attemptId}/finalize`).set(auth(token)).send({});

    it("rejects an impossible tenure requirement, accepts a real one, and CUSTOM rules cannot be BLOCKING", async () => {
      const customBlocking = await agent.post(`/api/v1/v2/process-levels/${e2LevelId}/progression-rules`).set(auth(adminToken)).send({ ruleType: "CUSTOM", label: "Custom check", severity: "BLOCKING" });
      expect(customBlocking.status).toBe(422);

      const rule = await agent.post(`/api/v1/v2/process-levels/${e2LevelId}/progression-rules`).set(auth(adminToken)).send({
        ruleType: "MIN_TENURE_MONTHS", label: "Must have 9999 months tenure", severity: "BLOCKING", params: { months: 9999 },
      });
      expect(rule.status).toBe(201);
      ruleId = rule.body.process_level_progression_rule_id;

      const { token, attemptId } = await setupScoredAttempt();
      const blocked = await finalize(token, attemptId);
      expect(blocked.status).toBe(422);
      expect(blocked.body.title).toMatch(/progression rule/i);

      // realistic tenure requirement (Rajesh joined 2021) passes -- same
      // attempt, retried after the rule-blocked finalize rolled back.
      const relaxed = await agent.patch(`/api/v1/v2/progression-rules/${ruleId}`).set(auth(adminToken)).send({ params: { months: 1 } });
      expect(relaxed.status).toBe(200);
      const passed = await finalize(token, attemptId);
      expect(passed.status).toBe(200);
      expect(passed.body.result).toBe("PASS");

      const ruleCheck = await pool.query(
        `SELECT passed FROM qualification_rule_check WHERE rule_code = 'PROGRESSION_RULE' AND qualification_result_id = $1`,
        [passed.body.qualificationResultId]
      );
      expect(ruleCheck.rows[0]?.passed).toBe(true);
    });

    it("an ADVISORY rule that fails is recorded but does not block finalize", async () => {
      await agent.patch(`/api/v1/v2/progression-rules/${ruleId}`).set(auth(adminToken)).send({ severity: "ADVISORY", params: { months: 9999 } });
      const { token, attemptId } = await setupScoredAttempt();
      const result = await finalize(token, attemptId);
      expect(result.status).toBe(200);
      expect(result.body.result).toBe("PASS");
      const ruleCheck = await pool.query(
        `SELECT passed FROM qualification_rule_check WHERE rule_code = 'PROGRESSION_RULE' AND qualification_result_id = $1`,
        [result.body.qualificationResultId]
      );
      expect(ruleCheck.rows[0]?.passed).toBe(false);

      const deleted = await agent.delete(`/api/v1/v2/progression-rules/${ruleId}`).set(auth(adminToken));
      expect(deleted.status).toBe(200);
    });
  });
});

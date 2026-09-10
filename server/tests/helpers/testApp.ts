// Shared plumbing for the integration/e2e suite. Deliberately talks to the
// same real local Postgres the dev server uses (per the project's standing
// rule: behavior this safety-critical is proven against real constraints,
// not a mocked DB) — every test cleans up exactly what it created.
import request from "supertest";
import { app } from "../../src/app.js";
import { pool } from "../../src/db.js";
import { signAccessToken, type CurrentUser } from "../../src/middleware/authentication/jwt.js";

export const agent = request(app);

export interface DevLoginResult {
  accessToken: string;
  user: CurrentUser;
}

export async function devLogin(username: string): Promise<DevLoginResult> {
  const res = await agent.post("/api/v1/auth/dev-login").send({ username });
  if (res.status !== 200) {
    throw new Error(`dev-login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

// Signs a token directly for scenarios dev-login can't construct on its own
// (e.g. a user who is simultaneously a worker AND holds an approval role —
// no such person exists in the seed data, but the authorization code path
// must still be proven). This is the exact function production auth uses to
// mint tokens, just invoked directly instead of through the dev-login route.
export function tokenFor(user: CurrentUser): string {
  return signAccessToken(user);
}

export interface Fixtures {
  cweCompanyId: string;
  sssCompanyId: string;
  rajeshWorkerId: string;
  braProcessId: string;
  levelIdByCode: Record<string, string>;
}

export async function loadFixtures(): Promise<Fixtures> {
  const cwe = await pool.query(`SELECT company_id FROM company WHERE code = 'CWE'`);
  const sss = await pool.query(`SELECT company_id FROM company WHERE code = 'SSS'`);
  const worker = await pool.query(`SELECT worker_id FROM worker WHERE hrms_employee_code = 'EMP-2847'`);
  const process = await pool.query(`SELECT process_id FROM process WHERE code = 'BRA' AND company_id = $1`, [cwe.rows[0].company_id]);
  const levels = await pool.query(`SELECT process_level_id, code FROM process_level WHERE process_id = $1`, [process.rows[0].process_id]);
  return {
    cweCompanyId: cwe.rows[0].company_id,
    sssCompanyId: sss.rows[0].company_id,
    rajeshWorkerId: worker.rows[0].worker_id,
    braProcessId: process.rows[0].process_id,
    levelIdByCode: Object.fromEntries(levels.rows.map((r: any) => [r.code, r.process_level_id])),
  };
}

// Deletes every qualification-case-model row created for one worker, in
// FK-safe order (mirrors scripts/reset_demo_journey_state.sh) — run this in
// afterEach/afterAll so tests stay independently re-runnable rather than
// accumulating state across runs.
export async function resetWorkerQualificationState(workerId: string) {
  await pool.query(
    `DELETE FROM certificate WHERE qualification_case_id IN (SELECT qualification_case_id FROM qualification_case WHERE worker_id = $1)`,
    [workerId]
  );
  await pool.query(
    `DELETE FROM qualification_result WHERE qualification_case_id IN (SELECT qualification_case_id FROM qualification_case WHERE worker_id = $1)`,
    [workerId]
  );
  await pool.query(
    `DELETE FROM self_assessment_review WHERE assessment_attempt_id IN (
       SELECT assessment_attempt_id FROM assessment_attempt WHERE qualification_case_id IN (
         SELECT qualification_case_id FROM qualification_case WHERE worker_id = $1))`,
    [workerId]
  );
  await pool.query(
    `DELETE FROM assessment_attempt WHERE qualification_case_id IN (SELECT qualification_case_id FROM qualification_case WHERE worker_id = $1)`,
    [workerId]
  );
  await pool.query(`DELETE FROM qualification_case WHERE worker_id = $1`, [workerId]);
  // Sub-level sign-offs (migration 0014) — the finalize gate reads these, so a
  // test that completes them must not leak into the next test's assumptions.
  await pool.query(`DELETE FROM worker_process_sub_level_progress WHERE worker_id = $1`, [workerId]);
  // Certifying advances worker_process_enrollment.current_process_level_id
  // for real (that's the entire point of certifying) — reset it back to the
  // seeded E2/target-E3 state so a certify test doesn't leak into the next
  // test's assumption that this worker starts at E2.
  await pool.query(
    `UPDATE worker_process_enrollment SET current_process_level_id = e2.process_level_id, target_process_level_id = e3.process_level_id
     FROM process_level e2, process_level e3
     WHERE worker_process_enrollment.worker_id = $1
       AND e2.process_id = worker_process_enrollment.process_id AND e2.code = 'E2'
       AND e3.process_id = worker_process_enrollment.process_id AND e3.code = 'E3'`,
    [workerId]
  );
}

// Every test-created idempotency key is prefixed "test-" (the manual replay
// script uses "demo-") so cleanup here can never touch the other's keys.
export async function resetTestIdempotencyKeys() {
  await pool.query(`DELETE FROM idempotency_key WHERE idempotency_key LIKE 'test-%'`);
}

export async function resetWorkerVerificationLockout(workerId: string) {
  await pool.query(`UPDATE worker_verification_credential SET failed_attempt_count = 0, locked_until = NULL WHERE worker_id = $1`, [workerId]);
}

// MCQ items are objectively server-graded from responseJson (never trusted
// from a client-submitted score) — the /items API deliberately never exposes
// correct_answer_json, so a test that wants a guaranteed-correct submission
// has to look it up directly, the same way a real client never could.
export async function getCorrectOptionKey(questionId: string): Promise<string> {
  const row = await pool.query(`SELECT correct_answer_json FROM question WHERE question_id = $1`, [questionId]);
  const keys = row.rows[0]?.correct_answer_json;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`Item ${questionId} has no correct_answer_json`);
  return keys[0];
}

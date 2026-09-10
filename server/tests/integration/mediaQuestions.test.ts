// Migration 0015: VIDEO / AUDIO / IMAGE question types + object storage.
// Runs against the `local` storage driver (config default) so CI needs no R2:
// the "presigned" upload URL points back at the API's own /media/local route.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const CONTENT_TYPE = { image: "image/png", video: "video/mp4", audio: "audio/mpeg" } as const;

async function uploadFake(token: string, kind: keyof typeof CONTENT_TYPE): Promise<string> {
  const bytes = Buffer.from(`fake-${kind}-${Math.random()}`);
  const ticket = await agent
    .post("/api/v1/v2/media/uploads")
    .set("Authorization", `Bearer ${token}`)
    .send({ kind, contentType: CONTENT_TYPE[kind], sizeBytes: bytes.length, filename: `evidence.${kind}` });
  expect(ticket.status).toBe(201);
  expect(ticket.body.uploadUrl).toBeTruthy();

  const put = await agent.put(ticket.body.uploadUrl).set("Content-Type", CONTENT_TYPE[kind]).send(bytes);
  expect(put.status).toBe(200);

  const confirm = await agent
    .post(`/api/v1/v2/media/uploads/${ticket.body.evidenceFileId}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send({ sha256: "a".repeat(64), sizeBytes: bytes.length });
  expect(confirm.status).toBe(200);
  expect(confirm.body.status).toBe("ready");
  return ticket.body.evidenceFileId;
}

describe("media question types + object storage (migration 0015)", () => {
  let fixtures: Fixtures;
  let supervisorToken: string;
  let e4LevelId: string;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    supervisorToken = (await devLogin("sunil_trainer")).accessToken;
    const e4 = await pool.query(`SELECT process_level_id FROM process_level WHERE process_id = $1 AND code = 'E4'`, [fixtures.braProcessId]);
    e4LevelId = e4.rows[0].process_level_id;
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
    await pool.query(`DELETE FROM evidence_file WHERE original_filename LIKE 'evidence.%'`);
  });

  async function startE4Attempt() {
    const qcase = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .set("Idempotency-Key", `test-media-qc-${Math.random()}`)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: e4LevelId });
    expect([200, 201]).toContain(qcase.status);
    const attempt = await agent
      .post(`/api/v1/v2/qualification-cases/${qcase.body.qualification_case_id}/attempts`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .set("Idempotency-Key", `test-media-att-${Math.random()}`)
      .send({});
    expect(attempt.status).toBe(201);
    const detail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.body.assessment_attempt_id}`).set("Authorization", `Bearer ${supervisorToken}`);
    const section = detail.body.componentAttempts[0];
    const items = await agent.get(`/api/v1/v2/assessment-attempt-sections/${section.assessment_attempt_section_id}/items`).set("Authorization", `Bearer ${supervisorToken}`);
    return { attemptId: attempt.body.assessment_attempt_id, sectionId: section.assessment_attempt_section_id, items: items.body as any[] };
  }

  it("presign -> upload -> confirm -> score a media component, then finalize PASS", async () => {
    const { attemptId, sectionId, items } = await startE4Attempt();
    expect(items.map((i) => i.question_type).sort()).toEqual(["AUDIO", "IMAGE", "VIDEO"]);

    const responses = [];
    for (const it of items) {
      const kind = it.question_type.toLowerCase() as keyof typeof CONTENT_TYPE;
      const evidenceFileId = await uploadFake(supervisorToken, kind);
      responses.push({ questionId: it.question_id, score: Number(it.max_score), evidenceFileId, assessorRemark: "ok" });
    }

    const score = await agent
      .post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/score`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ responses });
    expect(score.status).toBe(200);
    expect(score.body.weightedPct).toBe(100);

    const stored = await pool.query(
      `SELECT question_id, evidence_file_id FROM question_response WHERE assessment_attempt_section_id = $1`,
      [sectionId]
    );
    expect(stored.rows).toHaveLength(3);
    expect(stored.rows.every((r) => r.evidence_file_id)).toBe(true);
    const joinRows = await pool.query(
      `SELECT count(*)::int AS n FROM assessment_evidence ae JOIN question_response qr ON qr.question_response_id = ae.question_response_id
       WHERE qr.assessment_attempt_section_id = $1`,
      [sectionId]
    );
    expect(joinRows.rows[0].n).toBe(3);

    const finalize = await agent
      .post(`/api/v1/v2/assessment-attempts/${attemptId}/finalize`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({});
    expect(finalize.status).toBe(200);
    expect(finalize.body.result).toBe("PASS");
  });

  it("scoring a media question with no attached file is rejected", async () => {
    const { sectionId, items } = await startE4Attempt();
    const responses = items.map((it) => ({ questionId: it.question_id, score: Number(it.max_score) }));
    const score = await agent
      .post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/score`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ responses });
    expect(score.status).toBe(422);
    expect(score.body.title).toMatch(/evidenceFileId/);
  });

  it("GET /media/:id/url is company-scoped", async () => {
    const sssToken = (await devLogin("sss_admin")).accessToken;
    const evidenceFileId = await uploadFake(supervisorToken, "image"); // CWE-owned

    const own = await agent.get(`/api/v1/v2/media/${evidenceFileId}/url`).set("Authorization", `Bearer ${supervisorToken}`);
    expect(own.status).toBe(200);
    expect(own.body.url).toBeTruthy();

    const other = await agent.get(`/api/v1/v2/media/${evidenceFileId}/url`).set("Authorization", `Bearer ${sssToken}`);
    expect(other.status).toBe(403);
  });

  it("the worker self-check endpoint refuses a media question", async () => {
    const { sectionId, items } = await startE4Attempt();
    const res = await agent
      .post(`/api/v1/v2/assessment-attempt-sections/${sectionId}/check-item`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ questionId: items[0].question_id, responseJson: { chosen: "A" } });
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/cannot be self-checked/i);
  });
});

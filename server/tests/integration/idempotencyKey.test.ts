// Regression test for a real bug: the idempotency middleware persisted
// FAILED responses too (the global error handler calls the same
// monkey-patched res.json), so a transient/buggy 500 would replay forever
// on retry with the same key, even after whatever caused it was fixed.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

describe("idempotency key semantics", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  it("a failed attempt does not permanently poison the key — a corrected retry with the same key can still succeed", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const key = "test-idem-failure-then-retry";

    // First call: deliberately invalid (bad targetProcessLevelId) -> fails.
    const failing = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: "00000000-0000-0000-0000-000000000000" });
    expect(failing.status).toBe(422);

    // The failed claim must not remain stored with a response.
    const stored = await pool.query(`SELECT response_status FROM idempotency_key WHERE idempotency_key = $1`, [key]);
    expect(stored.rows[0]?.response_status ?? null).toBeNull();

    // Retry with the SAME key, now with a valid request -> must actually run,
    // not replay the earlier 422 forever.
    const retry = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe("READY_FOR_ASSESSMENT");
  });

  it("a successful call replays its stored response on retry with the same key, without re-running the handler", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const key = "test-idem-success-replay";

    const first = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(first.status).toBe(201);

    const second = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(second.status).toBe(201);
    expect(second.body.qualification_case_id).toBe(first.body.qualification_case_id);

    const count = await pool.query(`SELECT count(*)::int AS cnt FROM qualification_case WHERE worker_id = $1`, [fixtures.rajeshWorkerId]);
    expect(count.rows[0].cnt).toBe(1); // never created twice
  });
});

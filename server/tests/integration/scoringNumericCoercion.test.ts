// Regression test for a real bug: pg returns NUMERIC columns as strings, so
// assessment_item.max_score arrives over the wire as e.g. "5.00". A client
// that round-trips that value back as the submitted score (score: "5.00")
// used to make `raw += r.score` do JS string concatenation instead of
// numeric addition, corrupting the total and crashing on save.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { createCase, startAttempt } from "../helpers/journey.js";

describe("scoring numeric coercion", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  it("scores submitted as numeric strings (as max_score itself arrives from the API) sum correctly, not as concatenation", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "numeric-coercion");
    const attempt = await startAttempt(supervisor.accessToken, qcase.qualification_case_id, "numeric-coercion");
    const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    const practical = attemptDetail.body.componentAttempts.find((c: any) => c.component_type === "PRACTICAL");

    const itemsRes = await agent.get(`/api/v1/v2/assessment-component-attempts/${practical.assessment_component_attempt_id}/items`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(typeof itemsRes.body[0].max_score).toBe("string"); // confirms the precondition this bug depended on

    // Submit every score as the STRING value straight off max_score, exactly
    // as a naive client would if it just echoed the field back.
    const responses = itemsRes.body.map((it: any) => ({ assessmentItemId: it.assessment_item_id, score: it.max_score }));
    const scoreRes = await agent
      .post(`/api/v1/v2/assessment-component-attempts/${practical.assessment_component_attempt_id}/score`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({ responses });

    expect(scoreRes.status).toBe(200);
    const expectedMax = itemsRes.body.reduce((sum: number, it: any) => sum + Number(it.max_score), 0);
    expect(scoreRes.body.raw).toBe(expectedMax); // a number, not a mangled string
    expect(scoreRes.body.max).toBe(expectedMax);
    expect(scoreRes.body.weightedPct).toBe(100);
  });

  it("rejects a non-numeric score outright instead of silently coercing garbage", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "numeric-garbage");
    const attempt = await startAttempt(supervisor.accessToken, qcase.qualification_case_id, "numeric-garbage");
    const attemptDetail = await agent.get(`/api/v1/v2/assessment-attempts/${attempt.assessment_attempt_id}`).set("Authorization", `Bearer ${supervisor.accessToken}`);
    const practical = attemptDetail.body.componentAttempts.find((c: any) => c.component_type === "PRACTICAL");
    const itemsRes = await agent.get(`/api/v1/v2/assessment-component-attempts/${practical.assessment_component_attempt_id}/items`).set("Authorization", `Bearer ${supervisor.accessToken}`);

    const res = await agent
      .post(`/api/v1/v2/assessment-component-attempts/${practical.assessment_component_attempt_id}/score`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({ responses: [{ assessmentItemId: itemsRes.body[0].assessment_item_id, score: "not-a-number" }] });
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/must be a number/);
  });
});

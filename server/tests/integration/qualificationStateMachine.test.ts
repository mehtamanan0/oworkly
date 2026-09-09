import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, devLogin, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { createCase, startAttempt } from "../helpers/journey.js";

describe("qualification-case state machine", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  it("a fresh case starts READY_FOR_ASSESSMENT (worker is enrolled)", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "sm-fresh");
    expect(qcase.status).toBe("READY_FOR_ASSESSMENT");
  });

  it("rejects certify attempted directly from ASSESSMENT_IN_PROGRESS, skipping approval entirely", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "sm-skip-approval");
    await startAttempt(supervisor.accessToken, qcase.qualification_case_id, "sm-skip-approval");

    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/certify`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/Cannot certify from status ASSESSMENT_IN_PROGRESS/);
  });

  it("rejects acting on approval before the case has ever reached PENDING_APPROVAL", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "sm-no-approval-yet");

    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/approval/1/act`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({ action: "approved" });
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/Cannot act on approval from status READY_FOR_ASSESSMENT/);
  });

  it("rejects starting a second attempt while the case is not in a startable status (already ASSESSMENT_IN_PROGRESS's own case is fine to re-enter, but a CERTIFIED case must not accept a new attempt)", async () => {
    // A cheaper proxy for "terminal states reject new attempts": fabricate the
    // precondition directly rather than running the full approval+certify
    // chain again (already covered end-to-end in tests/e2e/fullJourney.test.ts).
    const supervisor = await devLogin("sunil_trainer");
    const qcase = await createCase(fixtures, supervisor.accessToken, "sm-terminal");
    const { pool } = await import("../../src/db.js");
    await pool.query(`UPDATE qualification_case SET status = 'CERTIFIED' WHERE qualification_case_id = $1`, [qcase.qualification_case_id]);

    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${qcase.qualification_case_id}/attempts`)
      .set("Authorization", `Bearer ${supervisor.accessToken}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.title).toMatch(/Cannot start an attempt from status CERTIFIED/);
  });

  it("404s for a qualification case that does not exist", async () => {
    const supervisor = await devLogin("sunil_trainer");
    const res = await agent.get("/api/v1/v2/qualification-cases/00000000-0000-0000-0000-000000000000").set("Authorization", `Bearer ${supervisor.accessToken}`);
    expect(res.status).toBe(404);
  });
});

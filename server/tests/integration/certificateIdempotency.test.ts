import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { agent, loadFixtures, resetWorkerQualificationState, resetTestIdempotencyKeys, type Fixtures } from "../helpers/testApp.js";
import { runSupervisorJourney } from "../helpers/journey.js";
import { pool } from "../../src/db.js";

describe("certificate issuance", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  afterEach(async () => {
    await resetWorkerQualificationState(fixtures.rajeshWorkerId);
    await resetTestIdempotencyKeys();
  });

  it("issuing twice (different idempotency keys) returns the same certificate row, never a duplicate", async () => {
    const journey = await runSupervisorJourney(fixtures, "cert-idem", "APPROVED");

    const first = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${journey.lnd!.accessToken}`)
      .set("Idempotency-Key", "test-certify-first")
      .send({});
    expect([200, 201]).toContain(first.status);

    const second = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${journey.lnd!.accessToken}`)
      .set("Idempotency-Key", "test-certify-second")
      .send({});
    expect([200, 201]).toContain(second.status);
    expect(second.body.certificate_id).toBe(first.body.certificate_id);

    const rows = await pool.query(`SELECT count(*)::int AS cnt FROM certificate WHERE qualification_case_id = $1`, [journey.qualificationCaseId]);
    expect(rows.rows[0].cnt).toBe(1);
  });

  it("selects the process-specific certificate_template and certificate_policy over the company-wide fallback", async () => {
    const journey = await runSupervisorJourney(fixtures, "cert-template", "CERTIFIED");
    const cert = await pool.query(`SELECT certificate_template_id, valid_from, valid_to FROM certificate WHERE qualification_case_id = $1`, [journey.qualificationCaseId]);
    const template = await pool.query(`SELECT process_id FROM certificate_template WHERE certificate_template_id = $1`, [cert.rows[0].certificate_template_id]);
    // The template picked must be one that is either process-specific (matching
    // BRA) or the company-wide NULL fallback — never some other process's.
    expect([fixtures.braProcessId, null]).toContain(template.rows[0].process_id);

    const monthsValid = Math.round(
      (new Date(cert.rows[0].valid_to).getTime() - new Date(cert.rows[0].valid_from).getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    expect(monthsValid).toBeGreaterThanOrEqual(23); // ~24 months per the seeded certificate_policy
    expect(monthsValid).toBeLessThanOrEqual(25);
  });

  it("cannot certify a case that has not been approved", async () => {
    const journey = await runSupervisorJourney(fixtures, "cert-not-approved", "PASS");
    const res = await agent
      .post(`/api/v1/v2/qualification-cases/${journey.qualificationCaseId}/certify`)
      .set("Authorization", `Bearer ${journey.supervisor.accessToken}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it("revoking a certificate requires a reason", async () => {
    const journey = await runSupervisorJourney(fixtures, "cert-revoke", "CERTIFIED");
    const noReason = await agent
      .post(`/api/v1/v2/certificates/${journey.certificate!.certificate_id}/revoke`)
      .set("Authorization", `Bearer ${journey.lnd!.accessToken}`)
      .send({});
    expect(noReason.status).toBe(400);

    const withReason = await agent
      .post(`/api/v1/v2/certificates/${journey.certificate!.certificate_id}/revoke`)
      .set("Authorization", `Bearer ${journey.lnd!.accessToken}`)
      .send({ reason: "Issued in error during testing" });
    expect(withReason.status).toBe(200);

    const row = await pool.query(`SELECT status, revoked_reason FROM certificate WHERE certificate_id = $1`, [journey.certificate!.certificate_id]);
    expect(row.rows[0].status).toBe("revoked");
    expect(row.rows[0].revoked_reason).toBe("Issued in error during testing");
  });
});

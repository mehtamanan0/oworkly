import { describe, it, expect, beforeAll } from "vitest";
import { agent, devLogin, loadFixtures, type Fixtures } from "../helpers/testApp.js";

describe("company isolation", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await loadFixtures();
  });

  it("a CWE-scoped user can read a CWE worker's profile", async () => {
    const cwe = await devLogin("sunil_trainer");
    const res = await agent.get(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/profile`).set("Authorization", `Bearer ${cwe.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.hrms_employee_code).toBe("EMP-2847");
  });

  it("an SSS-scoped user cannot read a CWE worker's profile (cross-tenant leak)", async () => {
    const sss = await devLogin("sss_admin");
    expect(sss.user.companyId).toBe(fixtures.sssCompanyId);
    const res = await agent.get(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/profile`).set("Authorization", `Bearer ${sss.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("an SSS-scoped user cannot create a qualification case for a CWE worker", async () => {
    const sss = await devLogin("sss_admin");
    const res = await agent
      .post("/api/v1/v2/qualification-cases")
      .set("Authorization", `Bearer ${sss.accessToken}`)
      .send({ workerId: fixtures.rajeshWorkerId, processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(res.status).toBe(403);
  });

  it("GET /v2/companies scopes to the caller's own company, never returning the other tenant", async () => {
    const cwe = await devLogin("sunil_trainer");
    const res = await agent.get("/api/v1/v2/companies").set("Authorization", `Bearer ${cwe.accessToken}`);
    expect(res.status).toBe(200);
    const codes = res.body.map((c: any) => c.code);
    expect(codes).toContain("CWE");
    expect(codes).not.toContain("SSS");
  });

  it("worker search is scoped to the caller's company — an SSS admin never sees CWE's workers", async () => {
    const sss = await devLogin("sss_admin");
    const res = await agent.get("/api/v1/v2/workers/search?q=rajesh").set("Authorization", `Bearer ${sss.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.find((w: any) => w.hrms_employee_code === "EMP-2847")).toBeUndefined();
  });

  it("rejects every new-model request with no bearer token at all", async () => {
    const res = await agent.get(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/profile`);
    expect(res.status).toBe(401);
  });
});

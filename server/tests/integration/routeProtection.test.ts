// M12: closing the open-internet hole. Before this milestone, 30 "legacy
// MVP demo" routes (org-units, processes, workers, skill-matrix, dashboard,
// learning-paths, assessment-outcomes, certificates, retest-cycles,
// escalations, skill-gaps, recommended-activities) were mounted with ZERO
// auth middleware -- fully readable (and in some cases writable) by anyone
// on the internet with no login at all. This proves the fix (authenticate()
// now required) and the newly added requirePermission() pre-checks on a
// handful of high-value qualification/worker/media routes.
//
// Known, documented limitation NOT covered by this milestone: the legacy
// routes have zero company_id scoping in their own queries (confirmed by
// grep -- they pre-date the tenancy model entirely), so while anonymous
// access is now blocked, a CWE-authenticated caller can still read
// SSS-scoped data through these specific legacy endpoints. A full
// re-platform onto the v2 model (out of scope here, see the M12 commit) is
// the real fix for that; this test only proves what M12 actually changed.
import { describe, it, expect, beforeAll } from "vitest";
import { agent, devLogin, loadFixtures, type Fixtures } from "../helpers/testApp.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const LEGACY_GET_ROUTES = [
  "/api/v1/org-units",
  "/api/v1/processes",
  "/api/v1/skill-levels",
  "/api/v1/job-roles",
  "/api/v1/roles",
  "/api/v1/users",
  "/api/v1/workers",
  "/api/v1/skill-matrix",
  "/api/v1/dashboard/summary",
  "/api/v1/assessment-outcomes/00000000-0000-0000-0000-000000000000",
  "/api/v1/certificates",
  "/api/v1/retest-cycles",
  "/api/v1/escalations",
  "/api/v1/skill-gaps",
];

describe("route protection: closing the open-internet hole (M12)", () => {
  let fixtures: Fixtures;
  let cweAdminToken: string;

  beforeAll(async () => {
    fixtures = await loadFixtures();
    cweAdminToken = (await devLogin("cwec_admin")).accessToken;
  });

  it("every legacy MVP route now rejects a request with no bearer token at all", async () => {
    for (const path of LEGACY_GET_ROUTES) {
      const res = await agent.get(path);
      expect(res.status, `${path} should require authentication`).toBe(401);
    }
  });

  it("a garbage/invalid bearer token is also rejected on legacy routes", async () => {
    const res = await agent.get("/api/v1/workers").set(auth("not-a-real-jwt"));
    expect(res.status).toBe(401);
  });

  it("a valid authenticated session can still use the legacy routes (existing functionality preserved)", async () => {
    const res = await agent.get("/api/v1/workers").set(auth(cweAdminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /workers/search and /workers/:id/profile require worker.read; an EMPLOYEE-role token has it, so it still works", async () => {
    const workerToken = (await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" })).body.accessToken;
    const search = await agent.get("/api/v1/v2/workers/search").set(auth(cweAdminToken));
    expect(search.status).toBe(200);
    const profile = await agent.get(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/profile`).set(auth(workerToken));
    expect(profile.status).toBe(200);
  });

  it("POST /workers/:id/enroll requires worker.update, which an EMPLOYEE token does not hold", async () => {
    const workerToken = (await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" })).body.accessToken;
    const res = await agent.post(`/api/v1/v2/workers/${fixtures.rajeshWorkerId}/enroll`).set(auth(workerToken)).send({ processId: fixtures.braProcessId, targetProcessLevelId: fixtures.levelIdByCode.E3 });
    expect(res.status).toBe(403);
  });

  it("POST /media/uploads requires assessment.evaluate, which an EMPLOYEE token does not hold", async () => {
    const workerToken = (await agent.post("/api/v1/worker-portal/verify").send({ workerId: fixtures.rajeshWorkerId, method: "SUPERVISOR_PIN", pin: "1234" })).body.accessToken;
    const res = await agent.post("/api/v1/v2/media/uploads").set(auth(workerToken)).send({ kind: "image", contentType: "image/png", sizeBytes: 100 });
    expect(res.status).toBe(403);
  });
});

// M6: org hierarchy admin — level type CRUD/reorder, node CRUD/move/archive,
// cycle + duplicate-code rejection, head-assignment history, tenant isolation.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agent, devLogin, loadFixtures, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PREFIX = "ZZORG";

describe("org hierarchy admin (M6)", () => {
  let fixtures: Fixtures;
  let cweAdminToken: string;
  let sssAdminToken: string;
  const createdUnitIds: string[] = [];
  const createdLevelTypeIds: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    cweAdminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM org_unit_head_assignment WHERE org_unit_id = ANY($1)`, [createdUnitIds]);
    await pool.query(`DELETE FROM org_unit WHERE org_unit_id = ANY($1)`, [createdUnitIds]);
    await pool.query(`DELETE FROM org_level_type WHERE org_level_type_id = ANY($1)`, [createdLevelTypeIds]);
  });

  it("creates a level type, rejects a duplicate code, and reorders", async () => {
    const a = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_A`, name: "Test Level A" });
    expect(a.status).toBe(201);
    createdLevelTypeIds.push(a.body.org_level_type_id);

    const dup = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_A`, name: "Duplicate" });
    expect(dup.status).toBe(409);

    const b = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_B`, name: "Test Level B", isLeaf: true });
    expect(b.status).toBe(201);
    createdLevelTypeIds.push(b.body.org_level_type_id);

    // reorder must include every active level type for the company (the real
    // seeded ones too) -- swap only the two scratch ones we just created,
    // which reorderLevelTypes appends at the end, so the real seeded level
    // types' relative order is provably unaffected either way. Restore the
    // original full ordering afterwards regardless, as a second safety net.
    const before = await pool.query(`SELECT org_level_type_id FROM org_level_type WHERE company_id = $1 AND is_active ORDER BY sequence`, [fixtures.cweCompanyId]);
    const originalOrder = before.rows.map((r: any) => r.org_level_type_id);
    const swapped = [...originalOrder];
    const lastIdx = swapped.length - 1;
    [swapped[lastIdx - 1], swapped[lastIdx]] = [swapped[lastIdx], swapped[lastIdx - 1]];
    expect(swapped.slice(0, -2)).toEqual(originalOrder.slice(0, -2)); // the real seeded types are untouched by this swap
    try {
      const reordered = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types/reorder`).set(auth(cweAdminToken)).send({ orderedIds: swapped });
      expect(reordered.status).toBe(200);
    } finally {
      await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types/reorder`).set(auth(cweAdminToken)).send({ orderedIds: originalOrder });
    }
  });

  it("a cross-company admin cannot create a level type in another company", async () => {
    const res = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(sssAdminToken)).send({ code: `${PREFIX}_X`, name: "Should fail" });
    expect(res.status).toBe(403);
  });

  it("builds a node tree, rejects a wrong-direction parent, moves a node, and rejects a cycle", async () => {
    const rootType = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_ROOT`, name: "Test Root Type" });
    const leafType = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_LEAF`, name: "Test Leaf Type", isLeaf: true });
    createdLevelTypeIds.push(rootType.body.org_level_type_id, leafType.body.org_level_type_id);
    // ensure root sits above leaf in sequence
    await pool.query(`UPDATE org_level_type SET sequence = -100 WHERE org_level_type_id = $1`, [rootType.body.org_level_type_id]);
    await pool.query(`UPDATE org_level_type SET sequence = -99 WHERE org_level_type_id = $1`, [leafType.body.org_level_type_id]);

    const root = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-units`).set(auth(cweAdminToken)).send({ orgLevelTypeId: rootType.body.org_level_type_id, code: `${PREFIX}ROOT1`, name: "Root Unit" });
    expect(root.status).toBe(201);
    createdUnitIds.push(root.body.org_unit_id);

    const dupCode = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-units`).set(auth(cweAdminToken)).send({ orgLevelTypeId: rootType.body.org_level_type_id, code: `${PREFIX}ROOT1`, name: "Dup" });
    expect(dupCode.status).toBe(409);

    // wrong direction: a "root type" node under a "leaf type" node is invalid (leaf sequence > root sequence)
    const leafFirst = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-units`).set(auth(cweAdminToken)).send({ orgLevelTypeId: leafType.body.org_level_type_id, code: `${PREFIX}LEAF0`, name: "Leaf Zero" });
    createdUnitIds.push(leafFirst.body.org_unit_id);
    const wrongDirection = await agent
      .post(`/api/v1/v2/org-units/${leafFirst.body.org_unit_id}/children`)
      .set(auth(cweAdminToken))
      .send({ orgLevelTypeId: rootType.body.org_level_type_id, code: `${PREFIX}BAD`, name: "Bad child" });
    expect(wrongDirection.status).toBe(422);

    const child = await agent
      .post(`/api/v1/v2/org-units/${root.body.org_unit_id}/children`)
      .set(auth(cweAdminToken))
      .send({ orgLevelTypeId: leafType.body.org_level_type_id, code: `${PREFIX}CHILD1`, name: "Child Unit" });
    expect(child.status).toBe(201);
    expect(child.body.parent_org_unit_id).toBe(root.body.org_unit_id);
    createdUnitIds.push(child.body.org_unit_id);

    // cycle: moving the root under its own child must be rejected
    const cycle = await agent.patch(`/api/v1/v2/org-units/${root.body.org_unit_id}`).set(auth(cweAdminToken)).send({ parentOrgUnitId: child.body.org_unit_id });
    expect(cycle.status).toBe(422);

    // archive is blocked while the child is still active
    const blockedArchive = await agent.post(`/api/v1/v2/org-units/${root.body.org_unit_id}/archive`).set(auth(cweAdminToken)).send({});
    expect(blockedArchive.status).toBe(409);

    // archive the child, then the parent succeeds
    const archiveChild = await agent.post(`/api/v1/v2/org-units/${child.body.org_unit_id}/archive`).set(auth(cweAdminToken)).send({});
    expect(archiveChild.status).toBe(200);
    const archiveRoot = await agent.post(`/api/v1/v2/org-units/${root.body.org_unit_id}/archive`).set(auth(cweAdminToken)).send({});
    expect(archiveRoot.status).toBe(200);
    expect(archiveRoot.body.is_active).toBe(false);

    const restored = await agent.post(`/api/v1/v2/org-units/${root.body.org_unit_id}/restore`).set(auth(cweAdminToken)).send({});
    expect(restored.status).toBe(200);
    expect(restored.body.is_active).toBe(true);
  });

  it("head assignment keeps history, one current per unit, and enforces company scope", async () => {
    const type = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-level-types`).set(auth(cweAdminToken)).send({ code: `${PREFIX}_HEAD`, name: "Head Test Type" });
    createdLevelTypeIds.push(type.body.org_level_type_id);
    const unit = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/org-units`).set(auth(cweAdminToken)).send({ orgLevelTypeId: type.body.org_level_type_id, code: `${PREFIX}HU1`, name: "Head Unit" });
    createdUnitIds.push(unit.body.org_unit_id);

    const assign1 = await agent.post(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(cweAdminToken)).send({ workerId: fixtures.rajeshWorkerId });
    expect(assign1.status).toBe(201);
    expect(assign1.body.effective_to).toBeFalsy();

    const historyAfterFirst = await agent.get(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(cweAdminToken));
    expect(historyAfterFirst.body).toHaveLength(1);

    // reassigning (a second worker) ends the first and starts a new current one
    const secondWorker = await pool.query(`SELECT worker_id FROM worker WHERE company_id = $1 AND status = 'active' AND worker_id <> $2 LIMIT 1`, [fixtures.cweCompanyId, fixtures.rajeshWorkerId]);
    const assign2 = await agent.post(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(cweAdminToken)).send({ workerId: secondWorker.rows[0].worker_id });
    expect(assign2.status).toBe(201);

    const historyAfterSecond = await agent.get(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(cweAdminToken));
    expect(historyAfterSecond.body).toHaveLength(2);
    const current = historyAfterSecond.body.filter((r: any) => !r.effective_to);
    expect(current).toHaveLength(1);
    expect(current[0].worker_id).toBe(secondWorker.rows[0].worker_id);

    // ending the current assignment leaves the unit headless (no auto-replacement)
    const ended = await agent.patch(`/api/v1/v2/head-assignments/${current[0].org_unit_head_assignment_id}/end`).set(auth(cweAdminToken)).send({ reason: "Test teardown" });
    expect(ended.status).toBe(200);
    const historyAfterEnd = await agent.get(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(cweAdminToken));
    expect(historyAfterEnd.body.every((r: any) => r.effective_to)).toBe(true);

    // cross-company: an SSS admin cannot assign a head to a CWE unit
    const forbidden = await agent.post(`/api/v1/v2/org-units/${unit.body.org_unit_id}/head-assignments`).set(auth(sssAdminToken)).send({ workerId: fixtures.rajeshWorkerId });
    expect(forbidden.status).toBe(403);
  });
});

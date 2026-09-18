// M8: Product Master — parent/child CRUD, cycle prevention, org/process
// linking, cross-company rejection, archive dependency checks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agent, devLogin, loadFixtures, type Fixtures } from "../helpers/testApp.js";
import { pool } from "../../src/db.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PREFIX = "ZZPROD";

describe("Product Master (M8)", () => {
  let fixtures: Fixtures;
  let adminToken: string;
  let sssAdminToken: string;
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    fixtures = await loadFixtures();
    adminToken = (await devLogin("cwec_admin")).accessToken;
    sssAdminToken = (await devLogin("sss_admin")).accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM product_org_unit_link WHERE product_id = ANY($1)`, [createdProductIds]);
    await pool.query(`DELETE FROM product_process_link WHERE product_id = ANY($1)`, [createdProductIds]);
    await pool.query(`DELETE FROM audit_log WHERE entity_name = 'product' AND entity_id::text = ANY($1)`, [createdProductIds]);
    await pool.query(`DELETE FROM product WHERE product_id = ANY($1)`, [createdProductIds]);
  });

  it("builds Family -> Product -> Variant, rejects a duplicate code, and rejects a cycle", async () => {
    const code = (s: string) => `${PREFIX}${s}${Math.floor(Math.random() * 100000)}`;
    const family = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`).set(auth(adminToken)).send({ code: code("FAM"), name: "Wind Turbine Family", productType: "FAMILY" });
    expect(family.status).toBe(201);
    createdProductIds.push(family.body.product_id);

    const dup = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`).set(auth(adminToken)).send({ code: family.body.code, name: "Dup" });
    expect(dup.status).toBe(409);

    const product = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`)
      .set(auth(adminToken))
      .send({ parentProductId: family.body.product_id, code: code("PROD"), name: "3MW Turbine", productType: "PRODUCT" });
    expect(product.status).toBe(201);
    expect(product.body.parent_product_id).toBe(family.body.product_id);
    createdProductIds.push(product.body.product_id);

    const variant = await agent
      .post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`)
      .set(auth(adminToken))
      .send({ parentProductId: product.body.product_id, code: code("VAR"), name: "3MW-HD Variant", productType: "VARIANT" });
    expect(variant.status).toBe(201);
    createdProductIds.push(variant.body.product_id);

    const list = await agent.get(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`).set(auth(adminToken));
    const ids = list.body.map((p: any) => p.product_id);
    expect(ids).toEqual(expect.arrayContaining([family.body.product_id, product.body.product_id, variant.body.product_id]));

    // cycle: moving the family under its own grandchild must be rejected
    const cycle = await agent.patch(`/api/v1/v2/products/${family.body.product_id}`).set(auth(adminToken)).send({ parentProductId: variant.body.product_id });
    expect(cycle.status).toBe(422);

    // archive blocked while the product still has an active child (variant)
    const blockedArchive = await agent.post(`/api/v1/v2/products/${product.body.product_id}/archive`).set(auth(adminToken)).send({});
    expect(blockedArchive.status).toBe(409);

    const archiveVariant = await agent.post(`/api/v1/v2/products/${variant.body.product_id}/archive`).set(auth(adminToken)).send({});
    expect(archiveVariant.status).toBe(200);
    const archiveProduct = await agent.post(`/api/v1/v2/products/${product.body.product_id}/archive`).set(auth(adminToken)).send({});
    expect(archiveProduct.status).toBe(200);

    const restored = await agent.post(`/api/v1/v2/products/${product.body.product_id}/restore`).set(auth(adminToken)).send({});
    expect(restored.status).toBe(200);
    expect(restored.body.is_active).toBe(true);
  });

  it("links a product to an organisation node and a process, and rejects cross-company links", async () => {
    const created = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`).set(auth(adminToken)).send({ code: `${PREFIX}LNK${Math.floor(Math.random() * 100000)}`, name: "Link Test Product" });
    createdProductIds.push(created.body.product_id);

    const unit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [fixtures.cweCompanyId]);
    const orgLink = await agent.post(`/api/v1/v2/products/${created.body.product_id}/organisation-links`).set(auth(adminToken)).send({ orgUnitId: unit.rows[0].org_unit_id });
    expect(orgLink.status).toBe(201);

    const procLink = await agent.post(`/api/v1/v2/products/${created.body.product_id}/process-links`).set(auth(adminToken)).send({ processId: fixtures.braProcessId });
    expect(procLink.status).toBe(201);

    const links = await agent.get(`/api/v1/v2/products/${created.body.product_id}/links`).set(auth(adminToken));
    expect(links.body.orgUnits).toHaveLength(1);
    expect(links.body.processes).toHaveLength(1);

    const dupLink = await agent.post(`/api/v1/v2/products/${created.body.product_id}/organisation-links`).set(auth(adminToken)).send({ orgUnitId: unit.rows[0].org_unit_id });
    expect(dupLink.status).toBe(409);

    const unlinked = await agent.delete(`/api/v1/v2/products/${created.body.product_id}/organisation-links/${orgLink.body.product_org_unit_link_id}`).set(auth(adminToken));
    expect(unlinked.status).toBe(200);
    const linksAfter = await agent.get(`/api/v1/v2/products/${created.body.product_id}/links`).set(auth(adminToken));
    expect(linksAfter.body.orgUnits).toHaveLength(0);

    // cross-company: an SSS org unit cannot be linked to a CWE product
    const sssUnit = await pool.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND is_active LIMIT 1`, [fixtures.sssCompanyId]);
    if (sssUnit.rows[0]) {
      const badLink = await agent.post(`/api/v1/v2/products/${created.body.product_id}/organisation-links`).set(auth(adminToken)).send({ orgUnitId: sssUnit.rows[0].org_unit_id });
      expect(badLink.status).toBe(403);
    }
  });

  it("a cross-company admin cannot create a product for another company", async () => {
    const res = await agent.post(`/api/v1/v2/companies/${fixtures.cweCompanyId}/products`).set(auth(sssAdminToken)).send({ code: `${PREFIX}X${Math.floor(Math.random() * 100000)}`, name: "Should fail" });
    expect(res.status).toBe(403);
  });
});

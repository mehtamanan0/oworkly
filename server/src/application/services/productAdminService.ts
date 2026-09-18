// Product Master: a company-scoped, self-referencing product tree (Family ->
// Product -> Variant), explicitly linked to organisation nodes and processes.
// Tree is built flat-fetch + in-memory (matching orgUnits.ts's existing
// convention — this codebase has never used a SQL recursive CTE) rather than
// walked in the database.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

const PRODUCT_TYPES = ["FAMILY", "PRODUCT", "VARIANT"];

function assertCompanyScope(currentUser: CurrentUser, companyId: string) {
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}

export async function listProducts(companyId: string, currentUser: CurrentUser, includeInactive = false) {
  assertCompanyScope(currentUser, companyId);
  return query<any>(
    `SELECT * FROM product WHERE company_id = $1 ${includeInactive ? "" : "AND is_active"} ORDER BY sequence, name`,
    [companyId]
  );
}

async function loadProduct(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM product WHERE product_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Product not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

async function ancestorIdsOf(productId: string): Promise<string[]> {
  const ids: string[] = [];
  let current = productId;
  for (let i = 0; i < 50; i++) {
    const row = await queryOne<{ parent_product_id: string | null }>(`SELECT parent_product_id FROM product WHERE product_id = $1`, [current]);
    if (!row?.parent_product_id) break;
    ids.push(row.parent_product_id);
    current = row.parent_product_id;
  }
  return ids;
}

export async function createProduct(
  companyId: string,
  body: { parentProductId?: string | null; code?: string; name?: string; productType?: string; description?: string; sequence?: number },
  currentUser: CurrentUser
) {
  assertCompanyScope(currentUser, companyId);
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw new ApiError(422, "code is required");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const productType = body.productType ?? "PRODUCT";
  if (!PRODUCT_TYPES.includes(productType)) throw new ApiError(422, `productType must be one of ${PRODUCT_TYPES.join(", ")}`);
  if (body.parentProductId) {
    const parent = await queryOne<{ company_id: string }>(`SELECT company_id FROM product WHERE product_id = $1 AND is_active`, [body.parentProductId]);
    if (!parent) throw new ApiError(422, "Unknown or archived parentProductId");
    if (parent.company_id !== companyId) throw new ApiError(422, "parentProductId belongs to a different company");
  }
  const nextSeq = body.sequence ?? (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM product WHERE company_id = $1 AND parent_product_id IS NOT DISTINCT FROM $2`,
    [companyId, body.parentProductId ?? null]
  ))?.n ?? 1;
  try {
    const row = await queryOne<any>(
      `INSERT INTO product (company_id, parent_product_id, code, name, product_type, description, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [companyId, body.parentProductId ?? null, code, name, productType, body.description ?? null, Number(nextSeq)]
    );
    await recordAudit(pool, { entityName: "product", entityId: row.product_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, `Product code "${code}" already exists for this company`);
    throw e;
  }
}

export async function updateProduct(
  id: string,
  body: { name?: string; description?: string; productType?: string; parentProductId?: string | null; sequence?: number },
  currentUser: CurrentUser
) {
  const before = await loadProduct(id, currentUser);
  const productType = body.productType ?? before.product_type;
  if (!PRODUCT_TYPES.includes(productType)) throw new ApiError(422, `productType must be one of ${PRODUCT_TYPES.join(", ")}`);
  let parentProductId = before.parent_product_id;
  if (body.parentProductId !== undefined && body.parentProductId !== before.parent_product_id) {
    if (body.parentProductId === id) throw new ApiError(422, "A product cannot be its own parent");
    if (body.parentProductId) {
      const parent = await queryOne<{ company_id: string }>(`SELECT company_id FROM product WHERE product_id = $1 AND is_active`, [body.parentProductId]);
      if (!parent) throw new ApiError(422, "Unknown or archived parentProductId");
      if (parent.company_id !== before.company_id) throw new ApiError(422, "parentProductId belongs to a different company");
      const ancestors = await ancestorIdsOf(body.parentProductId);
      if (ancestors.includes(id)) throw new ApiError(422, "Cannot move a product under one of its own descendants");
    }
    parentProductId = body.parentProductId;
  }
  const row = await queryOne<any>(
    `UPDATE product SET name = $1, description = $2, product_type = $3, parent_product_id = $4, sequence = $5 WHERE product_id = $6 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() || before.name : before.name,
      body.description !== undefined ? body.description : before.description,
      productType,
      parentProductId,
      Number(body.sequence ?? before.sequence),
      id,
    ]
  );
  await recordAudit(pool, { entityName: "product", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function archiveProduct(id: string, currentUser: CurrentUser) {
  const before = await loadProduct(id, currentUser);
  const children = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM product WHERE parent_product_id = $1 AND is_active`, [id]);
  if (Number(children?.n ?? 0) > 0) throw new ApiError(409, `${children!.n} active sub-product(s) still exist — archive them first`);
  const row = await queryOne<any>(`UPDATE product SET is_active = FALSE WHERE product_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "product", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: false } });
  return row;
}

export async function restoreProduct(id: string, currentUser: CurrentUser) {
  const before = await loadProduct(id, currentUser);
  const row = await queryOne<any>(`UPDATE product SET is_active = TRUE WHERE product_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "product", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: true } });
  return row;
}

// ===========================================================================
// Links
// ===========================================================================
export async function listLinks(productId: string, currentUser: CurrentUser) {
  const product = await loadProduct(productId, currentUser);
  const orgUnits = await query<any>(
    `SELECT poul.product_org_unit_link_id, ou.org_unit_id, ou.name, ou.code, olt.name AS level_type_name
     FROM product_org_unit_link poul JOIN org_unit ou ON ou.org_unit_id = poul.org_unit_id
     JOIN org_level_type olt ON olt.org_level_type_id = ou.org_level_type_id
     WHERE poul.product_id = $1 ORDER BY ou.name`,
    [productId]
  );
  const processes = await query<any>(
    `SELECT ppl.product_process_link_id, p.process_id, p.name, p.code
     FROM product_process_link ppl JOIN process p ON p.process_id = ppl.process_id
     WHERE ppl.product_id = $1 ORDER BY p.name`,
    [productId]
  );
  void product;
  return { orgUnits, processes };
}

export async function linkOrgUnit(productId: string, orgUnitId: string, currentUser: CurrentUser) {
  const product = await loadProduct(productId, currentUser);
  const unit = await queryOne<{ company_id: string }>(`SELECT company_id FROM org_unit WHERE org_unit_id = $1`, [orgUnitId]);
  if (!unit) throw new ApiError(404, "Organisation node not found");
  if (unit.company_id !== product.company_id) throw new ApiError(403, "That organisation node belongs to a different company");
  try {
    const row = await queryOne<any>(
      `INSERT INTO product_org_unit_link (product_id, org_unit_id) VALUES ($1,$2) RETURNING *`,
      [productId, orgUnitId]
    );
    await recordAudit(pool, { entityName: "product_org_unit_link", entityId: row.product_org_unit_link_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, "Already linked to this organisation node");
    throw e;
  }
}

export async function unlinkOrgUnit(linkId: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT poul.*, p.company_id FROM product_org_unit_link poul JOIN product p ON p.product_id = poul.product_id WHERE poul.product_org_unit_link_id = $1`,
    [linkId]
  );
  if (!row) throw new ApiError(404, "Link not found");
  assertCompanyScope(currentUser, row.company_id);
  await query(`DELETE FROM product_org_unit_link WHERE product_org_unit_link_id = $1`, [linkId]);
  await recordAudit(pool, { entityName: "product_org_unit_link", entityId: linkId, action: "DELETE", actorUserId: currentUser.userId, before: row });
  return { status: "unlinked" };
}

export async function linkProcess(productId: string, processId: string, currentUser: CurrentUser) {
  const product = await loadProduct(productId, currentUser);
  const process = await queryOne<{ company_id: string }>(`SELECT company_id FROM process WHERE process_id = $1`, [processId]);
  if (!process) throw new ApiError(404, "Process not found");
  if (process.company_id !== product.company_id) throw new ApiError(403, "That process belongs to a different company");
  try {
    const row = await queryOne<any>(
      `INSERT INTO product_process_link (product_id, process_id) VALUES ($1,$2) RETURNING *`,
      [productId, processId]
    );
    await recordAudit(pool, { entityName: "product_process_link", entityId: row.product_process_link_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, "Already linked to this process");
    throw e;
  }
}

export async function unlinkProcess(linkId: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT ppl.*, p.company_id FROM product_process_link ppl JOIN product p ON p.product_id = ppl.product_id WHERE ppl.product_process_link_id = $1`,
    [linkId]
  );
  if (!row) throw new ApiError(404, "Link not found");
  assertCompanyScope(currentUser, row.company_id);
  await query(`DELETE FROM product_process_link WHERE product_process_link_id = $1`, [linkId]);
  await recordAudit(pool, { entityName: "product_process_link", entityId: linkId, action: "DELETE", actorUserId: currentUser.userId, before: row });
  return { status: "unlinked" };
}

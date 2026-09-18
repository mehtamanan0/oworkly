// Org hierarchy authoring: level types (the configurable rungs of a
// company's hierarchy — Company/Vertical/Plant/Department/... or whatever a
// tenant defines), org_unit nodes on that ladder, and head-of-unit
// assignments (a real history table, not a single overwritten row). Follows
// the scoped-load / validate / audit pattern from processConfigService.ts.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

function assertCompanyScope(currentUser: CurrentUser, companyId: string) {
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}

// ===========================================================================
// Level types
// ===========================================================================
export async function createLevelType(
  companyId: string,
  body: { code?: string; name?: string; description?: string; isLeaf?: boolean; sequence?: number },
  currentUser: CurrentUser
) {
  assertCompanyScope(currentUser, companyId);
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw new ApiError(422, "code is required");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const nextSeq = body.sequence ?? (await queryOne<{ n: string }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM org_level_type WHERE company_id = $1`, [companyId]
  ))?.n ?? 1;
  const existing = await queryOne(`SELECT 1 FROM org_level_type WHERE company_id = $1 AND code = $2`, [companyId, code]);
  if (existing) throw new ApiError(409, `Level type code "${code}" already exists for this company`);
  const row = await queryOne<any>(
    `INSERT INTO org_level_type (company_id, code, name, description, sequence, is_leaf) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [companyId, code, name, body.description ?? null, Number(nextSeq), body.isLeaf ?? false]
  );
  await recordAudit(pool, { entityName: "org_level_type", entityId: row.org_level_type_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
  return row;
}

async function loadLevelType(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM org_level_type WHERE org_level_type_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Level type not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

export async function updateLevelType(id: string, body: { name?: string; description?: string; isLeaf?: boolean }, currentUser: CurrentUser) {
  const before = await loadLevelType(id, currentUser);
  const row = await queryOne<any>(
    `UPDATE org_level_type SET name = $1, description = $2, is_leaf = $3 WHERE org_level_type_id = $4 RETURNING *`,
    [
      body.name != null ? String(body.name).trim() || before.name : before.name,
      body.description !== undefined ? body.description : before.description,
      body.isLeaf ?? before.is_leaf,
      id,
    ]
  );
  await recordAudit(pool, { entityName: "org_level_type", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
  return row;
}

export async function reorderLevelTypes(companyId: string, orderedIds: string[], currentUser: CurrentUser) {
  assertCompanyScope(currentUser, companyId);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) throw new ApiError(422, "orderedIds must be a non-empty array");
  const owned = await query<{ org_level_type_id: string }>(`SELECT org_level_type_id FROM org_level_type WHERE company_id = $1 AND is_active`, [companyId]);
  const ownedSet = new Set(owned.map((r) => r.org_level_type_id));
  if (orderedIds.length !== ownedSet.size || !orderedIds.every((id) => ownedSet.has(id))) {
    throw new ApiError(422, "orderedIds must include every active level type for this company, exactly once");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Bump every sequence out of the way first so the UNIQUE(company_id, sequence)
    // constraint never collides mid-reorder.
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE org_level_type SET sequence = sequence + 1000 WHERE org_level_type_id = $1`, [orderedIds[i]]);
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE org_level_type SET sequence = $1 WHERE org_level_type_id = $2`, [i + 1, orderedIds[i]]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await recordAudit(pool, { entityName: "org_level_type", entityId: companyId, action: "UPDATE", actorUserId: currentUser.userId, after: { reordered: orderedIds } });
  return { status: "reordered" };
}

export async function setLevelTypeActive(id: string, isActive: boolean, currentUser: CurrentUser) {
  const before = await loadLevelType(id, currentUser);
  if (!isActive) {
    const inUse = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM org_unit WHERE org_level_type_id = $1 AND is_active`, [id]);
    if (Number(inUse?.n ?? 0) > 0) {
      throw new ApiError(409, `${inUse!.n} active organisation node(s) still use this level type — reassign or archive them first`);
    }
  }
  const row = await queryOne<any>(`UPDATE org_level_type SET is_active = $1 WHERE org_level_type_id = $2 RETURNING *`, [isActive, id]);
  await recordAudit(pool, { entityName: "org_level_type", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: isActive } });
  return row;
}

// ===========================================================================
// Org unit nodes
// ===========================================================================
async function loadUnit(id: string, currentUser: CurrentUser) {
  const row = await queryOne<any>(`SELECT * FROM org_unit WHERE org_unit_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Organisation node not found");
  assertCompanyScope(currentUser, row.company_id);
  return row;
}

// Walks parent_org_unit_id up to the root, returning the ordered list of
// ancestor ids (flat repeated single-row lookups, matching this codebase's
// existing tree convention rather than a SQL recursive CTE — see orgUnits.ts).
async function ancestorIdsOf(orgUnitId: string): Promise<string[]> {
  const ids: string[] = [];
  let current = orgUnitId;
  for (let i = 0; i < 50; i++) {
    const row = await queryOne<{ parent_org_unit_id: string | null }>(`SELECT parent_org_unit_id FROM org_unit WHERE org_unit_id = $1`, [current]);
    if (!row?.parent_org_unit_id) break;
    ids.push(row.parent_org_unit_id);
    current = row.parent_org_unit_id;
  }
  return ids;
}

async function assertValidParentChild(companyId: string, parentOrgUnitId: string | null, orgLevelTypeId: string) {
  const childType = await queryOne<{ sequence: number; company_id: string }>(`SELECT sequence, company_id FROM org_level_type WHERE org_level_type_id = $1`, [orgLevelTypeId]);
  if (!childType) throw new ApiError(422, "Unknown orgLevelTypeId");
  if (childType.company_id !== companyId) throw new ApiError(422, "orgLevelTypeId does not belong to this company");
  if (!parentOrgUnitId) return;
  const parent = await queryOne<any>(
    `SELECT ou.company_id, olt.sequence FROM org_unit ou JOIN org_level_type olt ON olt.org_level_type_id = ou.org_level_type_id WHERE ou.org_unit_id = $1`,
    [parentOrgUnitId]
  );
  if (!parent) throw new ApiError(422, "Unknown parentOrgUnitId");
  if (parent.company_id !== companyId) throw new ApiError(422, "parentOrgUnitId belongs to a different company");
  if (Number(parent.sequence) >= Number(childType.sequence)) {
    throw new ApiError(422, "A node's level type must sit below its parent's level type in the hierarchy sequence");
  }
}

export async function createOrgUnit(
  companyId: string,
  body: { parentOrgUnitId?: string | null; orgLevelTypeId?: string; code?: string; name?: string; description?: string },
  currentUser: CurrentUser
) {
  assertCompanyScope(currentUser, companyId);
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) throw new ApiError(422, "code is required");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError(422, "name is required");
  const orgLevelTypeId = String(body.orgLevelTypeId ?? "");
  if (!orgLevelTypeId) throw new ApiError(422, "orgLevelTypeId is required");
  await assertValidParentChild(companyId, body.parentOrgUnitId ?? null, orgLevelTypeId);

  try {
    const row = await queryOne<any>(
      `INSERT INTO org_unit (parent_org_unit_id, code, name, company_id, org_level_type_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.parentOrgUnitId ?? null, code, name, companyId, orgLevelTypeId]
    );
    await recordAudit(pool, { entityName: "org_unit", entityId: row.org_unit_id, action: "INSERT", actorUserId: currentUser.userId, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, `Code "${code}" is already used at this level`);
    throw e;
  }
}

export async function updateOrgUnit(
  id: string,
  body: { name?: string; code?: string; parentOrgUnitId?: string | null },
  currentUser: CurrentUser
) {
  const before = await loadUnit(id, currentUser);
  let parentOrgUnitId = before.parent_org_unit_id;
  if (body.parentOrgUnitId !== undefined && body.parentOrgUnitId !== before.parent_org_unit_id) {
    if (body.parentOrgUnitId === id) throw new ApiError(422, "A node cannot be its own parent");
    if (body.parentOrgUnitId) {
      const ancestors = await ancestorIdsOf(body.parentOrgUnitId);
      if (body.parentOrgUnitId === id || ancestors.includes(id)) {
        throw new ApiError(422, "Cannot move a node under one of its own descendants");
      }
    }
    await assertValidParentChild(before.company_id, body.parentOrgUnitId ?? null, before.org_level_type_id);
    parentOrgUnitId = body.parentOrgUnitId;
  }
  try {
    const row = await queryOne<any>(
      `UPDATE org_unit SET name = $1, code = $2, parent_org_unit_id = $3, updated_at = now() WHERE org_unit_id = $4 RETURNING *`,
      [
        body.name != null ? String(body.name).trim() || before.name : before.name,
        body.code != null ? String(body.code).trim().toUpperCase() || before.code : before.code,
        parentOrgUnitId,
        id,
      ]
    );
    await recordAudit(pool, { entityName: "org_unit", entityId: id, action: "UPDATE", actorUserId: currentUser.userId, before, after: row });
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw new ApiError(409, "That code is already used at this level");
    throw e;
  }
}

export async function archiveOrgUnit(id: string, currentUser: CurrentUser) {
  const before = await loadUnit(id, currentUser);
  const blockers: string[] = [];
  const children = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM org_unit WHERE parent_org_unit_id = $1 AND is_active`, [id]);
  if (Number(children?.n ?? 0) > 0) blockers.push(`${children!.n} active child node(s)`);
  const workers = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM worker WHERE org_unit_id = $1 AND status = 'active'`, [id]);
  if (Number(workers?.n ?? 0) > 0) blockers.push(`${workers!.n} active worker(s) assigned`);
  const processes = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM process WHERE org_unit_id = $1 AND is_active`, [id]);
  if (Number(processes?.n ?? 0) > 0) blockers.push(`${processes!.n} active process(es) scoped here`);
  if (blockers.length > 0) throw new ApiError(409, `Cannot archive — ${blockers.join(", ")}. Reassign or archive those first.`);

  const row = await queryOne<any>(`UPDATE org_unit SET is_active = FALSE, updated_at = now() WHERE org_unit_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "org_unit", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: false } });
  return row;
}

export async function restoreOrgUnit(id: string, currentUser: CurrentUser) {
  const before = await loadUnit(id, currentUser);
  const row = await queryOne<any>(`UPDATE org_unit SET is_active = TRUE, updated_at = now() WHERE org_unit_id = $1 RETURNING *`, [id]);
  await recordAudit(pool, { entityName: "org_unit", entityId: id, action: "STATUS_CHANGE", actorUserId: currentUser.userId, before: { is_active: before.is_active }, after: { is_active: true } });
  return row;
}

// ===========================================================================
// Head-of-unit assignment (history)
// ===========================================================================
export async function assignHead(
  orgUnitId: string,
  body: { workerId?: string; effectiveFrom?: string },
  currentUser: CurrentUser
) {
  const unit = await loadUnit(orgUnitId, currentUser);
  const workerId = String(body.workerId ?? "");
  if (!workerId) throw new ApiError(422, "workerId is required");
  const worker = await queryOne<{ company_id: string; status: string }>(`SELECT company_id, status FROM worker WHERE worker_id = $1`, [workerId]);
  if (!worker) throw new ApiError(404, "Worker not found");
  if (worker.company_id !== unit.company_id) throw new ApiError(422, "Worker belongs to a different company");
  if (worker.status !== "active") throw new ApiError(422, "Only an active worker may be assigned as head");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `UPDATE org_unit_head_assignment SET effective_to = now(), ended_by_user_id = $1, end_reason = 'Reassigned'
       WHERE org_unit_id = $2 AND effective_to IS NULL RETURNING org_unit_head_assignment_id`,
      [currentUser.userId, orgUnitId]
    );
    const row = await client.query(
      `INSERT INTO org_unit_head_assignment (org_unit_id, worker_id, assigned_by_user_id, effective_from)
       VALUES ($1,$2,$3, COALESCE($4::timestamptz, now())) RETURNING *`,
      [orgUnitId, workerId, currentUser.userId, body.effectiveFrom ?? null]
    );
    await client.query("COMMIT");
    await recordAudit(pool, {
      entityName: "org_unit_head_assignment", entityId: row.rows[0].org_unit_head_assignment_id, action: "INSERT",
      actorUserId: currentUser.userId, after: row.rows[0], before: current.rows[0] ? { replaced: current.rows[0].org_unit_head_assignment_id } : undefined,
    });
    return row.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function endHeadAssignment(assignmentId: string, body: { reason?: string }, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `SELECT hoa.*, ou.company_id FROM org_unit_head_assignment hoa JOIN org_unit ou ON ou.org_unit_id = hoa.org_unit_id
     WHERE hoa.org_unit_head_assignment_id = $1`,
    [assignmentId]
  );
  if (!row) throw new ApiError(404, "Head assignment not found");
  assertCompanyScope(currentUser, row.company_id);
  if (row.effective_to) throw new ApiError(422, "This assignment has already ended");
  const updated = await queryOne<any>(
    `UPDATE org_unit_head_assignment SET effective_to = now(), ended_by_user_id = $1, end_reason = $2
     WHERE org_unit_head_assignment_id = $3 RETURNING *`,
    [currentUser.userId, body.reason ?? null, assignmentId]
  );
  await recordAudit(pool, { entityName: "org_unit_head_assignment", entityId: assignmentId, action: "UPDATE", actorUserId: currentUser.userId, before: row, after: updated });
  return updated;
}

export async function listHeadHistory(orgUnitId: string, currentUser: CurrentUser) {
  await loadUnit(orgUnitId, currentUser);
  return query<any>(
    `SELECT hoa.*, w.first_name, w.last_name, u.display_name AS assigned_by_name
     FROM org_unit_head_assignment hoa
     JOIN worker w ON w.worker_id = hoa.worker_id
     LEFT JOIN app_user u ON u.user_id = hoa.assigned_by_user_id
     WHERE hoa.org_unit_id = $1 ORDER BY hoa.effective_from DESC`,
    [orgUnitId]
  );
}

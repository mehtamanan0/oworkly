// M13: organisation master-sheet import. Validates a staged CSV batch
// against the company's *existing* configurable hierarchy (org_level_type)
// -- never hardcodes one customer's levels -- then publishes only after an
// explicit, separate confirmation, per the brief's staging->validate->
// preview->publish lifecycle.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { parseCsv, requireHeaders } from "../../infrastructure/import/csvParser.js";
import * as importService from "./importService.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

export const ORGANISATION_IMPORT_HEADERS = [
  "company_code", "level_type_code", "node_code", "node_name", "parent_node_code", "description", "active", "effective_from", "effective_to",
];

export function organisationImportTemplate(): string {
  return ORGANISATION_IMPORT_HEADERS.join(",") + "\n";
}

export async function uploadOrganisationImport(companyId: string, filename: string, fileBuffer: Buffer, currentUser: CurrentUser) {
  const { headers, rows } = parseCsv(fileBuffer);
  requireHeaders(headers, ORGANISATION_IMPORT_HEADERS);
  return importService.createBatch(companyId, "ORGANISATION", filename, rows, currentUser);
}

function parseBoolean(raw: string | undefined, fallback: boolean): { ok: boolean; value: boolean } {
  if (raw == null || raw.trim() === "") return { ok: true, value: fallback };
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes"].includes(v)) return { ok: true, value: true };
  if (["false", "0", "no"].includes(v)) return { ok: true, value: false };
  return { ok: false, value: fallback };
}

function parseDate(raw: string | undefined): { ok: boolean; value: string | null } {
  if (raw == null || raw.trim() === "") return { ok: true, value: null };
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return { ok: false, value: null };
  return { ok: true, value: raw.trim() };
}

export async function validateOrganisationImport(batchId: string, currentUser: CurrentUser) {
  const batch = await importService.loadBatch(batchId, currentUser);
  if (batch.import_type !== "ORGANISATION") throw new ApiError(422, "Not an organisation import batch");
  if (["CANCELLED", "PUBLISHED"].includes(batch.status)) throw new ApiError(422, `Cannot validate a batch with status ${batch.status}`);

  const company = await queryOne<{ code: string }>(`SELECT code FROM company WHERE company_id = $1`, [batch.company_id]);
  const levelTypes = await query<{ org_level_type_id: string; code: string; sequence: number; is_active: boolean }>(
    `SELECT org_level_type_id, code, sequence, is_active FROM org_level_type WHERE company_id = $1`,
    [batch.company_id]
  );
  const levelTypeByCode = new Map(levelTypes.map((l) => [l.code, l]));
  const existingUnits = await query<{ org_unit_id: string; code: string; org_level_type_id: string }>(
    `SELECT org_unit_id, code, org_level_type_id FROM org_unit WHERE company_id = $1`,
    [batch.company_id]
  );
  const existingByCode = new Map(existingUnits.map((u) => [u.code, u]));

  const rows = await importService.listStagingRows(batchId);
  const errors: { rowNumber: number; field?: string; code: string; message: string }[] = [];
  const rowResults: { rowNumber: number; isValid: boolean; normalized?: Record<string, unknown> }[] = [];
  // node_code -> level_type_code seen so far in THIS batch, in file order --
  // this is also what makes "parent defined earlier in the same batch"
  // possible, and (by construction: a parent must already exist or appear
  // earlier) makes a cycle within the batch structurally impossible.
  const seenInBatch = new Map<string, { rowNumber: number; levelTypeCode: string }>();

  for (const row of rows) {
    const r = row.raw_json as Record<string, string>;
    const rowNumber = row.row_number as number;
    const rowErrorsBefore = errors.length;

    if ((r.company_code ?? "").trim() !== company?.code) {
      errors.push({ rowNumber, field: "company_code", code: "COMPANY_MISMATCH", message: `company_code "${r.company_code}" does not match the target company (${company?.code})` });
    }
    const levelTypeCode = (r.level_type_code ?? "").trim();
    const levelType = levelTypeByCode.get(levelTypeCode);
    if (!levelTypeCode) {
      errors.push({ rowNumber, field: "level_type_code", code: "MISSING_REQUIRED_VALUE", message: "level_type_code is required" });
    } else if (!levelType) {
      errors.push({ rowNumber, field: "level_type_code", code: "UNKNOWN_LEVEL_TYPE", message: `Unknown level_type_code "${levelTypeCode}" for this company` });
    } else if (!levelType.is_active) {
      errors.push({ rowNumber, field: "level_type_code", code: "INACTIVE_LEVEL_TYPE", message: `Level type "${levelTypeCode}" is archived` });
    }

    const nodeCode = (r.node_code ?? "").trim();
    if (!nodeCode) errors.push({ rowNumber, field: "node_code", code: "MISSING_REQUIRED_VALUE", message: "node_code is required" });
    const nodeName = (r.node_name ?? "").trim();
    if (!nodeName) errors.push({ rowNumber, field: "node_name", code: "MISSING_REQUIRED_VALUE", message: "node_name is required" });

    if (nodeCode) {
      const dup = seenInBatch.get(nodeCode);
      if (dup) {
        errors.push({ rowNumber, field: "node_code", code: "DUPLICATE_ROW", message: `node_code "${nodeCode}" already appears on row ${dup.rowNumber} in this file` });
      } else {
        seenInBatch.set(nodeCode, { rowNumber, levelTypeCode });
      }
      const existing = existingByCode.get(nodeCode);
      if (existing && !dup && existing.org_level_type_id !== levelType?.org_level_type_id) {
        errors.push({ rowNumber, field: "node_code", code: "DUPLICATE_NODE_CODE", message: `node_code "${nodeCode}" already exists under a different level type` });
      }
    }

    const parentNodeCode = (r.parent_node_code ?? "").trim();
    let parentLevelSequence: number | null = null;
    if (parentNodeCode) {
      if (parentNodeCode === nodeCode) {
        errors.push({ rowNumber, field: "parent_node_code", code: "SELF_PARENT", message: "A node cannot be its own parent" });
      } else {
        const parentInBatch = seenInBatch.get(parentNodeCode);
        const parentExisting = existingByCode.get(parentNodeCode);
        if (parentInBatch) {
          parentLevelSequence = levelTypeByCode.get(parentInBatch.levelTypeCode)?.sequence ?? null;
        } else if (parentExisting) {
          parentLevelSequence = levelTypes.find((l) => l.org_level_type_id === parentExisting.org_level_type_id)?.sequence ?? null;
        } else {
          errors.push({ rowNumber, field: "parent_node_code", code: "PARENT_NOT_FOUND", message: `Parent node "${parentNodeCode}" does not exist for this company (not found in the database or earlier in this file)` });
        }
        if (parentLevelSequence != null && levelType && parentLevelSequence >= levelType.sequence) {
          errors.push({ rowNumber, field: "parent_node_code", code: "INVALID_PARENT_CHILD_TYPE", message: `Parent's level type must precede the child's in hierarchy sequence` });
        }
      }
    }

    const activeResult = parseBoolean(r.active, true);
    if (!activeResult.ok) errors.push({ rowNumber, field: "active", code: "INVALID_BOOLEAN", message: `active must be true/false (got "${r.active}")` });
    const fromResult = parseDate(r.effective_from);
    if (!fromResult.ok) errors.push({ rowNumber, field: "effective_from", code: "INVALID_DATE", message: `effective_from is not a valid date (got "${r.effective_from}")` });
    const toResult = parseDate(r.effective_to);
    if (!toResult.ok) errors.push({ rowNumber, field: "effective_to", code: "INVALID_DATE", message: `effective_to is not a valid date (got "${r.effective_to}")` });
    if (fromResult.ok && toResult.ok && fromResult.value && toResult.value && new Date(fromResult.value) > new Date(toResult.value)) {
      errors.push({ rowNumber, field: "effective_to", code: "INVALID_DATE", message: "effective_to must not be before effective_from" });
    }

    const isValid = errors.length === rowErrorsBefore;
    rowResults.push({
      rowNumber,
      isValid,
      normalized: isValid
        ? {
            levelTypeCode, nodeCode, nodeName, parentNodeCode: parentNodeCode || null,
            description: r.description?.trim() || null, active: activeResult.value,
            effectiveFrom: fromResult.value, effectiveTo: toResult.value,
          }
        : undefined,
    });
  }

  return importService.recordValidationResult(batchId, rowResults, errors);
}

export async function publishOrganisationImport(batchId: string, currentUser: CurrentUser) {
  const batch = await importService.loadBatch(batchId, currentUser);
  if (batch.import_type !== "ORGANISATION") throw new ApiError(422, "Not an organisation import batch");
  if (!["VALID"].includes(batch.status)) throw new ApiError(422, `Cannot publish a batch with status ${batch.status} -- validate it first`);

  const rows = await importService.listStagingRows(batchId);
  const validRows = rows.filter((r) => r.is_valid);
  if (validRows.length === 0) throw new ApiError(422, "No valid rows to publish");

  const levelTypes = await query<{ org_level_type_id: string; code: string }>(`SELECT org_level_type_id, code FROM org_level_type WHERE company_id = $1`, [batch.company_id]);
  const levelTypeByCode = new Map(levelTypes.map((l) => [l.code, l.org_level_type_id]));

  let created = 0, updated = 0, skipped = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Rows are already in file order (listStagingRows orders by row_number),
    // which is exactly the dependency order needed -- a parent row is always
    // processed before any row that references it as a parent (enforced at
    // validation time).
    const nodeIdByCode = new Map<string, string>();
    for (const row of validRows) {
      const n = row.normalized_json as any;
      const orgLevelTypeId = levelTypeByCode.get(n.levelTypeCode);
      if (!orgLevelTypeId) { skipped++; continue; }
      const parentOrgUnitId = n.parentNodeCode
        ? nodeIdByCode.get(n.parentNodeCode) ??
          (await client.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND code = $2`, [batch.company_id, n.parentNodeCode])).rows[0]?.org_unit_id ?? null
        : null;

      const existing = await client.query(`SELECT org_unit_id FROM org_unit WHERE company_id = $1 AND code = $2`, [batch.company_id, n.nodeCode]);
      if (existing.rows[0]) {
        await client.query(
          `UPDATE org_unit SET name = $1, parent_org_unit_id = $2, is_active = $3 WHERE org_unit_id = $4`,
          [n.nodeName, parentOrgUnitId, n.active, existing.rows[0].org_unit_id]
        );
        nodeIdByCode.set(n.nodeCode, existing.rows[0].org_unit_id);
        updated++;
      } else {
        const inserted = await client.query(
          `INSERT INTO org_unit (company_id, org_level_type_id, parent_org_unit_id, code, name, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING org_unit_id`,
          [batch.company_id, orgLevelTypeId, parentOrgUnitId, n.nodeCode, n.nodeName, n.active]
        );
        nodeIdByCode.set(n.nodeCode, inserted.rows[0].org_unit_id);
        created++;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return importService.markPublished(batchId, { created, updated, skipped }, currentUser);
}

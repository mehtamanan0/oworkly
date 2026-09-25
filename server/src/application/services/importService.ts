// M13: the shared batch lifecycle (upload -> stage -> validate -> preview ->
// publish -> result) reused by both the organisation and worker import
// pipelines, so parsing/staging/error-reporting logic isn't duplicated
// between them. Domain-specific validation/publish logic lives in
// organisationImportService.ts / workerImportService.ts, which call into
// these primitives.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { recordAudit } from "../../infrastructure/database/audit.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

export type ImportType = "ORGANISATION" | "WORKER";

function assertCompanyScope(currentUser: CurrentUser, companyId: string) {
  if (currentUser.companyId && currentUser.companyId !== companyId) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
}

export async function createBatch(companyId: string, importType: ImportType, filename: string, rows: Record<string, string>[], currentUser: CurrentUser) {
  assertCompanyScope(currentUser, companyId);
  const batch = await queryOne<any>(
    `INSERT INTO import_batch (company_id, import_type, source_filename, uploaded_by_user_id, row_count, status)
     VALUES ($1,$2,$3,$4,$5,'UPLOADED') RETURNING *`,
    [companyId, importType, filename, currentUser.userId, rows.length]
  );
  for (let i = 0; i < rows.length; i++) {
    await pool.query(
      `INSERT INTO import_staging_row (import_batch_id, row_number, raw_json) VALUES ($1,$2,$3)`,
      [batch!.import_batch_id, i + 1, JSON.stringify(rows[i])]
    );
  }
  await recordAudit(pool, { entityName: "import_batch", entityId: batch!.import_batch_id, action: "INSERT", actorUserId: currentUser.userId, after: { importType, filename, rowCount: rows.length } });
  return batch;
}

export async function loadBatch(batchId: string, currentUser: CurrentUser) {
  const batch = await queryOne<any>(`SELECT * FROM import_batch WHERE import_batch_id = $1`, [batchId]);
  if (!batch) throw new ApiError(404, "Import batch not found");
  assertCompanyScope(currentUser, batch.company_id);
  return batch;
}

export async function listStagingRows(batchId: string) {
  return query<any>(`SELECT * FROM import_staging_row WHERE import_batch_id = $1 ORDER BY row_number`, [batchId]);
}

export async function listErrors(batchId: string) {
  return query<any>(`SELECT * FROM import_row_error WHERE import_batch_id = $1 ORDER BY row_number`, [batchId]);
}

// Wipes any prior validation result for this batch (re-validate support) and
// replaces it with the fresh outcome: each row's normalized_json/is_valid,
// plus a flat error list.
export async function recordValidationResult(
  batchId: string,
  rowResults: { rowNumber: number; isValid: boolean; normalized?: Record<string, unknown> }[],
  errors: { rowNumber: number; field?: string; code: string; message: string }[]
) {
  await pool.query(`DELETE FROM import_row_error WHERE import_batch_id = $1`, [batchId]);
  for (const r of rowResults) {
    await pool.query(
      `UPDATE import_staging_row SET is_valid = $1, normalized_json = $2 WHERE import_batch_id = $3 AND row_number = $4`,
      [r.isValid, r.normalized ? JSON.stringify(r.normalized) : null, batchId, r.rowNumber]
    );
  }
  for (const e of errors) {
    await pool.query(
      `INSERT INTO import_row_error (import_batch_id, row_number, field, code, message) VALUES ($1,$2,$3,$4,$5)`,
      [batchId, e.rowNumber, e.field ?? null, e.code, e.message]
    );
  }
  const status = errors.length > 0 ? "INVALID" : "VALID";
  await pool.query(`UPDATE import_batch SET status = $1, error_count = $2, validated_at = now() WHERE import_batch_id = $3`, [status, errors.length, batchId]);
  return { status, errorCount: errors.length };
}

export async function markPublished(batchId: string, counts: { created: number; updated: number; skipped: number }, currentUser: CurrentUser) {
  const row = await queryOne<any>(
    `UPDATE import_batch SET status = 'PUBLISHED', published_at = now(), created_count = $1, updated_count = $2, skipped_count = $3 WHERE import_batch_id = $4 RETURNING *`,
    [counts.created, counts.updated, counts.skipped, batchId]
  );
  await recordAudit(pool, { entityName: "import_batch", entityId: batchId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { status: "PUBLISHED", ...counts } });
  return row;
}

export async function cancelBatch(batchId: string, currentUser: CurrentUser) {
  const batch = await loadBatch(batchId, currentUser);
  if (["PUBLISHED", "CANCELLED"].includes(batch.status)) {
    throw new ApiError(409, `Cannot cancel a batch with status ${batch.status}`);
  }
  const row = await queryOne<any>(`UPDATE import_batch SET status = 'CANCELLED', cancelled_at = now() WHERE import_batch_id = $1 RETURNING *`, [batchId]);
  await recordAudit(pool, { entityName: "import_batch", entityId: batchId, action: "STATUS_CHANGE", actorUserId: currentUser.userId, after: { status: "CANCELLED" } });
  return row;
}

export async function listBatches(companyId: string, importType: ImportType | undefined, currentUser: CurrentUser) {
  assertCompanyScope(currentUser, companyId);
  return query<any>(
    `SELECT * FROM import_batch WHERE company_id = $1 ${importType ? "AND import_type = $2" : ""} ORDER BY created_at DESC LIMIT 50`,
    importType ? [companyId, importType] : [companyId]
  );
}

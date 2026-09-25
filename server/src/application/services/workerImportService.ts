// M14: worker master-sheet import, sharing the same batch engine as the
// organisation import (M13). The brief's template names plant_code /
// vertical_code / department_code / supervisor_employee_code /
// manager_employee_code / employment_status / source_record_id, but the
// real `worker` table (this app's configurable-hierarchy model) has a
// single org_unit_id, a single reporting_manager_worker_id, a `status`
// column, and no source_record_id column at all -- so this file documents
// and applies the mapping explicitly, per the brief's own "provide a
// documented header mapping if the external format differs" instruction:
//   plant_code / vertical_code / department_code -> one org_unit_id,
//     resolved most-specific-first (department, then vertical, then plant)
//     against this company's existing org_unit codes.
//   designation_code -> job_role.code -> primary_job_role_id.
//   employee_type -> worker.employment_type (DIRECT/CONTRACT/VENDOR).
//   manager_employee_code (falling back to supervisor_employee_code if the
//     former is blank) -> the single reporting_manager_worker_id column.
//   employment_status -> worker.status (active/inactive/on_leave/exited).
//   source_system -> resolved against data_source.name for this company
//     (advisory only -- left null if it doesn't resolve, not a hard error).
//   source_record_id -> captured in the template for completeness but not
//     persisted; no such column exists on worker today.
//
// Publish mode: preview + explicit upsert (the brief's own recommended
// default) -- an existing employee_code updates only master-owned identity/
// organisation fields; qualification_case, assessment_attempt, certificate,
// self_assessment_review, and audit_log rows for that worker are never
// touched by this import.
import { pool, query, queryOne } from "../../db.js";
import { ApiError } from "../../lib/asyncHandler.js";
import { parseCsv, requireHeaders } from "../../infrastructure/import/csvParser.js";
import * as importService from "./importService.js";
import type { CurrentUser } from "../../middleware/authentication/jwt.js";

export const WORKER_IMPORT_HEADERS = [
  "employee_code", "full_name", "date_of_joining", "company_code",
  "plant_code", "vertical_code", "department_code", "designation_code",
  "employee_type", "supervisor_employee_code", "manager_employee_code",
  "employment_status", "source_system", "source_record_id",
];
const EMPLOYMENT_TYPES = ["DIRECT", "CONTRACT", "VENDOR"];
const EMPLOYMENT_STATUSES = ["active", "inactive", "on_leave", "exited"];

export function workerImportTemplate(): string {
  return WORKER_IMPORT_HEADERS.join(",") + "\n";
}

export async function uploadWorkerImport(companyId: string, filename: string, fileBuffer: Buffer, currentUser: CurrentUser) {
  const { headers, rows } = parseCsv(fileBuffer);
  requireHeaders(headers, WORKER_IMPORT_HEADERS);
  return importService.createBatch(companyId, "WORKER", filename, rows, currentUser);
}

function parseDateOfJoining(raw: string | undefined): { ok: boolean; value: string | null } {
  if (!raw?.trim()) return { ok: false, value: null }; // required field
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return { ok: false, value: null };
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (d > tomorrow) return { ok: false, value: null };
  return { ok: true, value: raw.trim() };
}

export async function validateWorkerImport(batchId: string, currentUser: CurrentUser) {
  const batch = await importService.loadBatch(batchId, currentUser);
  if (batch.import_type !== "WORKER") throw new ApiError(422, "Not a worker import batch");
  if (["CANCELLED", "PUBLISHED"].includes(batch.status)) throw new ApiError(422, `Cannot validate a batch with status ${batch.status}`);

  const company = await queryOne<{ code: string }>(`SELECT code FROM company WHERE company_id = $1`, [batch.company_id]);
  const orgUnits = await query<{ org_unit_id: string; code: string }>(`SELECT org_unit_id, code FROM org_unit WHERE company_id = $1 AND is_active`, [batch.company_id]);
  const orgUnitByCode = new Map(orgUnits.map((u) => [u.code, u.org_unit_id]));
  const jobRoles = await query<{ job_role_id: string; code: string }>(`SELECT job_role_id, code FROM job_role WHERE is_active`);
  const jobRoleByCode = new Map(jobRoles.map((j) => [j.code, j.job_role_id]));
  const dataSources = await query<{ data_source_id: string; name: string }>(`SELECT data_source_id, name FROM data_source WHERE company_id = $1`, [batch.company_id]);
  const dataSourceByName = new Map(dataSources.map((d) => [d.name, d.data_source_id]));
  const existingByCode = await query<{ hrms_employee_code: string }>(`SELECT hrms_employee_code FROM worker WHERE company_id = $1`, [batch.company_id]);
  const existingCodes = new Set(existingByCode.map((w) => w.hrms_employee_code));

  const rows = await importService.listStagingRows(batchId);
  const errors: { rowNumber: number; field?: string; code: string; message: string }[] = [];
  const rowResults: { rowNumber: number; isValid: boolean; normalized?: Record<string, unknown> }[] = [];
  const seenInBatch = new Map<string, number>(); // employee_code -> first row_number

  for (const row of rows) {
    const r = row.raw_json as Record<string, string>;
    const rowNumber = row.row_number as number;
    const before = errors.length;

    if ((r.company_code ?? "").trim() !== company?.code) {
      errors.push({ rowNumber, field: "company_code", code: "COMPANY_MISMATCH", message: `company_code "${r.company_code}" does not match the target company (${company?.code})` });
    }
    const employeeCode = (r.employee_code ?? "").trim();
    if (!employeeCode) {
      errors.push({ rowNumber, field: "employee_code", code: "MISSING_REQUIRED_VALUE", message: "employee_code is required" });
    } else {
      const dup = seenInBatch.get(employeeCode);
      if (dup) errors.push({ rowNumber, field: "employee_code", code: "DUPLICATE_ROW", message: `employee_code "${employeeCode}" already appears on row ${dup} in this file` });
      else seenInBatch.set(employeeCode, rowNumber);
    }
    const fullName = (r.full_name ?? "").trim();
    if (!fullName) errors.push({ rowNumber, field: "full_name", code: "MISSING_REQUIRED_VALUE", message: "full_name is required" });
    if (fullName.length > 150) errors.push({ rowNumber, field: "full_name", code: "VALUE_TOO_LONG", message: "full_name exceeds 150 characters" });

    const doj = parseDateOfJoining(r.date_of_joining);
    if (!doj.ok) errors.push({ rowNumber, field: "date_of_joining", code: "INVALID_DATE", message: `date_of_joining is missing, invalid, or in the future (got "${r.date_of_joining}")` });

    const orgUnitCode = (r.department_code || r.vertical_code || r.plant_code || "").trim();
    const orgUnitId = orgUnitCode ? orgUnitByCode.get(orgUnitCode) : undefined;
    if (!orgUnitCode) {
      errors.push({ rowNumber, field: "department_code", code: "MISSING_REQUIRED_VALUE", message: "At least one of department_code, vertical_code, or plant_code is required" });
    } else if (!orgUnitId) {
      errors.push({ rowNumber, field: "department_code", code: "ORG_REFERENCE_NOT_FOUND", message: `No active organisation node matches "${orgUnitCode}" for this company` });
    }

    let jobRoleId: string | null = null;
    const designationCode = (r.designation_code ?? "").trim();
    if (designationCode) {
      jobRoleId = jobRoleByCode.get(designationCode) ?? null;
      if (!jobRoleId) errors.push({ rowNumber, field: "designation_code", code: "UNKNOWN_DESIGNATION", message: `Unknown designation_code "${designationCode}"` });
    }

    const employmentType = (r.employee_type ?? "").trim().toUpperCase() || "DIRECT";
    if (!EMPLOYMENT_TYPES.includes(employmentType)) {
      errors.push({ rowNumber, field: "employee_type", code: "INVALID_ENUM", message: `employee_type must be one of ${EMPLOYMENT_TYPES.join(", ")}` });
    }
    const employmentStatus = (r.employment_status ?? "").trim().toLowerCase() || "active";
    if (!EMPLOYMENT_STATUSES.includes(employmentStatus)) {
      errors.push({ rowNumber, field: "employment_status", code: "INVALID_ENUM", message: `employment_status must be one of ${EMPLOYMENT_STATUSES.join(", ")}` });
    }

    const managerCode = (r.manager_employee_code || r.supervisor_employee_code || "").trim();
    if (managerCode) {
      if (managerCode === employeeCode) {
        errors.push({ rowNumber, field: "manager_employee_code", code: "SELF_SUPERVISOR", message: "A worker cannot be their own supervisor/manager" });
      } else if (!existingCodes.has(managerCode) && !seenInBatch.has(managerCode)) {
        errors.push({ rowNumber, field: "manager_employee_code", code: "MANAGER_NOT_FOUND", message: `manager/supervisor employee_code "${managerCode}" was not found in this company (database or earlier in this file)` });
      }
    }

    const sourceSystem = (r.source_system ?? "").trim();
    const dataSourceId = sourceSystem ? (dataSourceByName.get(sourceSystem) ?? null) : null;

    const isValid = errors.length === before;
    rowResults.push({
      rowNumber,
      isValid,
      normalized: isValid
        ? { employeeCode, fullName, dateOfJoining: doj.value, orgUnitId, jobRoleId, employmentType, employmentStatus, managerCode: managerCode || null, dataSourceId }
        : undefined,
    });
  }

  return importService.recordValidationResult(batchId, rowResults, errors);
}

export async function publishWorkerImport(batchId: string, currentUser: CurrentUser) {
  const batch = await importService.loadBatch(batchId, currentUser);
  if (batch.import_type !== "WORKER") throw new ApiError(422, "Not a worker import batch");
  if (batch.status !== "VALID") throw new ApiError(422, `Cannot publish a batch with status ${batch.status} -- validate it first`);

  const rows = await importService.listStagingRows(batchId);
  const validRows = rows.filter((r) => r.is_valid);
  if (validRows.length === 0) throw new ApiError(422, "No valid rows to publish");

  let created = 0, updated = 0, skipped = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workerIdByCode = new Map<string, string>();
    for (const row of validRows) {
      const n = row.normalized_json as any;
      if (!n.orgUnitId) { skipped++; continue; }
      const [firstName, ...rest] = String(n.fullName).split(/\s+/);
      const lastName = rest.join(" ") || null;
      const managerId = n.managerCode
        ? workerIdByCode.get(n.managerCode) ??
          (await client.query(`SELECT worker_id FROM worker WHERE company_id = $1 AND hrms_employee_code = $2`, [batch.company_id, n.managerCode])).rows[0]?.worker_id ?? null
        : null;

      const existing = await client.query(`SELECT worker_id FROM worker WHERE company_id = $1 AND hrms_employee_code = $2`, [batch.company_id, n.employeeCode]);
      if (existing.rows[0]) {
        // Preview + explicit upsert: only master-owned identity/org fields
        // are touched here -- qualification/assessment/certificate/audit/
        // self-assessment history for this worker is never written by this
        // path.
        await client.query(
          `UPDATE worker SET first_name = $1, last_name = $2, date_of_joining = $3, org_unit_id = $4, primary_job_role_id = $5,
             employment_type = $6, status = $7, reporting_manager_worker_id = $8, data_source_id = COALESCE($9, data_source_id)
           WHERE worker_id = $10`,
          [firstName, lastName, n.dateOfJoining, n.orgUnitId, n.jobRoleId, n.employmentType, n.employmentStatus, managerId, n.dataSourceId, existing.rows[0].worker_id]
        );
        workerIdByCode.set(n.employeeCode, existing.rows[0].worker_id);
        updated++;
      } else {
        const inserted = await client.query(
          `INSERT INTO worker (company_id, hrms_employee_code, first_name, last_name, date_of_joining, org_unit_id, primary_job_role_id, employment_type, status, reporting_manager_worker_id, data_source_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING worker_id`,
          [batch.company_id, n.employeeCode, firstName, lastName, n.dateOfJoining, n.orgUnitId, n.jobRoleId, n.employmentType, n.employmentStatus, managerId, n.dataSourceId]
        );
        workerIdByCode.set(n.employeeCode, inserted.rows[0].worker_id);
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

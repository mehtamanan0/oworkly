// M13: CSV-only for v1 (the brief itself says "CSV or XLSX" throughout --
// CSV satisfies every requirement without a heavier XLSX parsing
// dependency). Shared by both the organisation and worker import pipelines.
import { parse } from "csv-parse/sync";
import { ApiError } from "../../lib/asyncHandler.js";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export function parseCsv(buffer: Buffer): ParsedCsv {
  if (buffer.length === 0) throw new ApiError(422, "The uploaded file is empty");
  if (buffer.length > MAX_FILE_BYTES) throw new ApiError(413, `File exceeds the ${MAX_FILE_BYTES}-byte limit`);
  let records: Record<string, string>[];
  try {
    records = parse(buffer.toString("utf-8"), { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e: any) {
    throw new ApiError(422, `Could not parse CSV: ${e.message}`);
  }
  if (records.length > MAX_ROWS) throw new ApiError(422, `File has ${records.length} rows, exceeding the ${MAX_ROWS}-row limit`);
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

export function requireHeaders(headers: string[], required: string[]) {
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) throw new ApiError(422, `Missing required column(s): ${missing.join(", ")}`);
}

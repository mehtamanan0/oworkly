#!/usr/bin/env python3
"""
Reference ETL parser for the Suzlon-style "WTG Skill Matrix - GAP Analysis.xlsx"
workbook (Form CQA:MBU:HR:FOR-001 layout) into the structured masters defined
in 02_Database_Schema.sql (process, competency_framework, worker,
worker_process_skill).

This is a REFERENCE implementation proving the parsing logic described in
05_Data_Migration_Ingestion_Strategy.md §2 against the real file supplied in
the connected LMS project folder. In production this logic is ported into the
.NET Infrastructure layer as `ExcelSkillMatrixImportService`
(implements `IMasterDataImportSource`) so it runs inside the same
Ingestion/Admin API described in 01_Architecture_Overview.md §6, with each
row wrapped in the same audit_log / sync_log discipline as any other write.

Usage:
    python3 parse_wtg_skill_matrix.py <path-to-xlsx> [--out out.json]
"""
import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from typing import Optional

import openpyxl


@dataclass
class ProcessDef:
    process_code: str          # e.g. "A", "B" ... the workbook's process letter
    process_name: str
    criticality: str           # 'Y' | 'N'
    required_levels: list      # e.g. ["L2","L3","L4"] — which level columns are defined for this process
    headcount_required: dict   # {"L2": 23, "L3": 4, "L4": None}
    col_by_level: dict = field(default_factory=dict)   # {"L2": 8, "L3": 9, ...} — exact column index per level, resolved from the header row


@dataclass
class WorkerSkillRow:
    emp_code: Optional[str]
    name: str
    process_code: str
    process_name: str
    attained_level_mark: Optional[str]   # raw cell value in the level column that was marked (worksheet convention: a number/mark indicates "assessed at this column's level")


def unmerge_forward_fill(ws):
    """
    openpyxl only populates the top-left cell of a merged range; every other
    cell in the range reads back as None. The workbook's header block (process
    name, criticality, skill-level-required rows) relies entirely on merged
    cells, so we forward-fill each merged range's value across its member
    cells into a plain dict[(row,col)] -> value lookup before parsing.
    """
    grid = {}
    for row in ws.iter_rows():
        for cell in row:
            grid[(cell.row, cell.column)] = cell.value
    for merged_range in ws.merged_cells.ranges:
        value = ws.cell(row=merged_range.min_row, column=merged_range.min_col).value
        for r in range(merged_range.min_row, merged_range.max_row + 1):
            for c in range(merged_range.min_col, merged_range.max_col + 1):
                grid[(r, c)] = value
    return grid


def parse_header_block(grid, max_col):
    """Rows 1-4: title / format-no / Vertical / Plant / Area / Document Updation Date."""
    header = {"vertical": None, "plant": None, "area": None, "doc_date": None}
    for c in range(1, max_col + 1):
        v = grid.get((4, c))
        if isinstance(v, str):
            if v.strip().startswith("Vertical"):
                header["vertical"] = grid.get((4, c + 5))
            elif v.strip().startswith("Plant"):
                header["plant"] = grid.get((4, c + 5))
            elif v.strip().startswith("Area"):
                header["area"] = grid.get((4, c + 1))
    # Document Updation Date is the last populated cell on row 4 in the observed layout
    for c in range(max_col, 1, -1):
        v = grid.get((4, c))
        if v is not None and not isinstance(v, str):
            header["doc_date"] = str(v)
            break
    return header


def parse_process_definitions(grid, max_col):
    """
    Rows 6-10 define one process per group of 3 columns (L2/L3/L4 sub-columns):
      row 6/7: process letter tag "(A)" and process name (merged across the 3 sub-cols)
      row 8:   criticality Y/N (merged across the 3 sub-cols)
      row 9:   skill level required, one of L2/L3/L4 per sub-column
      row 10:  headcount with that required level, one number per sub-column,
               plus a final "Total requirement Level Wise" column
    """
    processes = []
    col = 1
    current = None
    while col <= max_col:
        level_label = grid.get((9, col))
        if level_label in ("L2", "L3", "L4"):
            proc_tag = grid.get((6, col)) or ""
            proc_name = (grid.get((7, col)) or "").strip() if isinstance(grid.get((7, col)), str) else grid.get((7, col))
            criticality = grid.get((8, col)) or "N"
            headcount = grid.get((10, col))
            if current is None or current.process_name != proc_name:
                current = ProcessDef(
                    process_code=str(proc_tag).strip("() ") or f"P{len(processes)+1}",
                    process_name=proc_name or f"Unnamed process at col {col}",
                    criticality=str(criticality).strip().upper() or "N",
                    required_levels=[],
                    headcount_required={},
                )
                processes.append(current)
            current.required_levels.append(level_label)
            current.headcount_required[level_label] = headcount
            current.col_by_level[level_label] = col
        col += 1
    return processes


def parse_worker_rows(grid, max_row, max_col, processes, header_row=10):
    """
    Rows after the header block: one row per (worker, process assignment).
    Columns observed: Sr.No(1), Name(2 — may include "(L3+L2)" style annotation),
    Emp Code(3), [blank], Process code(5), Process name(6), then per-process
    level-mark columns matching the process definitions parsed above, with a
    "Total requirement Level Wise" trailer column.
    A worker can appear on multiple consecutive rows (one per process they are
    being tracked against) with Name/Emp Code populated only on the first row
    of the group — carry the last-seen Name/Emp Code forward within a block.
    """
    rows = []
    last_name, last_emp_code = None, None
    for r in range(header_row + 1, max_row + 1):
        name = grid.get((r, 2))
        emp_code = grid.get((r, 3))
        proc_code = grid.get((r, 5))
        proc_name = grid.get((r, 6))
        if name:
            last_name = re.sub(r"\s*\([^)]*\)\s*$", "", str(name)).strip()  # strip trailing "(L3+L2)" style annotations
        if emp_code:
            last_emp_code = emp_code
        if not proc_name:
            continue  # a spacer/blank row, or a row past the data block
        # Resolve the row's process by exact column-indexed lookup (not name match, since process
        # names repeat across process-code groups); then read whichever of that process's L2/L3/L4
        # columns is populated on this row — that populated cell is the worker's attained level mark.
        matched_process = next((p for p in processes if p.process_name == proc_name), None)
        attained_level, mark = None, None
        if matched_process:
            for level_code, level_col in matched_process.col_by_level.items():
                v = grid.get((r, level_col))
                if v not in (None, ""):
                    attained_level, mark = level_code, v
                    break
        rows.append(WorkerSkillRow(
            emp_code=str(last_emp_code) if last_emp_code else None,
            name=last_name or "UNKNOWN",
            process_code=str(proc_code) if proc_code else "",
            process_name=str(proc_name),
            attained_level_mark=f"{attained_level}={mark}" if attained_level else None,
        ))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx_path")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx_path, data_only=True)
    result = {"sheets": []}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        grid = unmerge_forward_fill(ws)
        header = parse_header_block(grid, ws.max_column)
        processes = parse_process_definitions(grid, ws.max_column)
        workers = parse_worker_rows(grid, ws.max_row, ws.max_column, processes)

        sheet_result = {
            "sheet_name": sheet_name,
            "header": header,
            "process_count": len(processes),
            "processes": [asdict(p) for p in processes],
            "worker_process_row_count": len(workers),
            "worker_process_rows_sample": [asdict(w) for w in workers[:10]],
            "distinct_workers": len({w.emp_code or w.name for w in workers}),
        }
        result["sheets"].append(sheet_result)
        print(f"Sheet '{sheet_name}': {len(processes)} processes, "
              f"{len(workers)} worker/process rows, "
              f"{sheet_result['distinct_workers']} distinct workers", file=sys.stderr)

    out_json = json.dumps(result, indent=2, default=str)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out_json)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(out_json)


if __name__ == "__main__":
    main()

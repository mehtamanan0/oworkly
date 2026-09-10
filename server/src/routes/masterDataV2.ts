// New-model master-data routes (companies, flexible hierarchy, process
// levels, worker search/profile, data sources) — additive, alongside the
// original MVP routes in routes/*.ts which keep serving the legacy demo
// pages untouched.
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import {
  listCriteria, createCriterion, updateCriterion, deleteCriterion,
  listSubLevels, createSubLevel, updateSubLevel, deleteSubLevel,
} from "../application/services/processConfigService.js";
import { markProgress, listProgress } from "../application/services/subLevelProgressService.js";

export const masterDataV2Router = Router();

function scopedCompanyId(req: any, requested?: string) {
  if (req.currentUser?.companyId) {
    if (requested && requested !== req.currentUser.companyId) throw new ApiError(403, "Cross-company access is not permitted");
    return req.currentUser.companyId;
  }
  return requested ?? null; // platform admin, no scope requested -> caller must filter explicitly
}

masterDataV2Router.get(
  "/companies",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const rows = await query<any>(
      `SELECT c.*,
              (SELECT count(*) FROM org_level_type olt WHERE olt.company_id = c.company_id)::int AS hierarchy_level_count,
              (SELECT count(*) FROM process p WHERE p.company_id = c.company_id)::int AS process_count,
              (SELECT count(*) FROM worker w WHERE w.company_id = c.company_id AND w.status = 'active')::int AS active_worker_count
       FROM company c
       ${companyId ? "WHERE c.company_id = $1" : ""}
       ORDER BY c.name`,
      companyId ? [companyId] : []
    );
    res.json(rows);
  })
);

masterDataV2Router.get(
  "/companies/:id/hierarchy",
  asyncHandler(async (req, res) => {
    const companyId = scopedCompanyId(req, req.params.id) ?? req.params.id;
    const levelTypes = await query<any>(`SELECT * FROM org_level_type WHERE company_id = $1 ORDER BY sequence`, [companyId]);
    const units = await query<any>(
      `SELECT ou.*, olt.code AS level_type_code, olt.name AS level_type_name, olt.sequence AS level_sequence,
              oha.worker_id AS head_worker_id, w.first_name AS head_first_name, w.last_name AS head_last_name
       FROM org_unit ou
       JOIN org_level_type olt ON olt.org_level_type_id = ou.org_level_type_id
       LEFT JOIN org_unit_head_assignment oha ON oha.org_unit_id = ou.org_unit_id
       LEFT JOIN worker w ON w.worker_id = oha.worker_id
       WHERE ou.company_id = $1 AND ou.is_active ORDER BY olt.sequence, ou.name`,
      [companyId]
    );
    res.json({ levelTypes, units });
  })
);

masterDataV2Router.post(
  "/org-units/:id/head",
  asyncHandler(async (req, res) => {
    const { workerId } = req.body;
    await query(
      `INSERT INTO org_unit_head_assignment (org_unit_id, worker_id, assigned_by_user_id) VALUES ($1,$2,$3)
       ON CONFLICT (org_unit_id) DO UPDATE SET worker_id = EXCLUDED.worker_id, assigned_at = now(), assigned_by_user_id = EXCLUDED.assigned_by_user_id`,
      [req.params.id, workerId, req.currentUser?.userId ?? null]
    );
    res.json({ status: "assigned" });
  })
);

masterDataV2Router.get(
  "/processes",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const rows = await query<any>(
      `SELECT p.*, ou.name AS org_unit_name,
              (SELECT count(*) FROM process_level pl WHERE pl.process_id = p.process_id)::int AS level_count
       FROM process p
       JOIN org_unit ou ON ou.org_unit_id = p.org_unit_id
       ${companyId ? "WHERE p.company_id = $1" : ""}
       ORDER BY p.name`,
      companyId ? [companyId] : []
    );
    res.json(rows);
  })
);

masterDataV2Router.get(
  "/primary-levels",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const rows = await query<any>(
      `SELECT * FROM primary_level_definition ${companyId ? "WHERE company_id = $1" : ""} ORDER BY ordinal`,
      companyId ? [companyId] : []
    );
    res.json(rows);
  })
);

masterDataV2Router.get(
  "/processes/:id/levels",
  asyncHandler(async (req, res) => {
    const process = await queryOne<any>(`SELECT * FROM process WHERE process_id = $1`, [req.params.id]);
    if (!process) throw new ApiError(404, "Process not found");
    scopedCompanyId(req, process.company_id);
    const levels = await query<any>(
      `SELECT pl.*, pld.code AS primary_level_code, pld.label AS primary_level_label,
              (SELECT count(*) FROM assessment_template ap WHERE ap.process_level_id = pl.process_level_id AND ap.is_active)::int AS linked_template_count
       FROM process_level pl LEFT JOIN primary_level_definition pld ON pld.primary_level_id = pl.primary_level_id
       WHERE pl.process_id = $1 ORDER BY pl.ordinal`,
      [req.params.id]
    );
    const subLevels = await query<any>(
      `SELECT psl.* FROM process_sub_level psl JOIN process_level pl ON pl.process_level_id = psl.process_level_id
       WHERE pl.process_id = $1 AND psl.is_active ORDER BY psl.sequence`,
      [req.params.id]
    );
    const criteria = await query<any>(
      `SELECT plc.* FROM process_level_criterion plc JOIN process_level pl ON pl.process_level_id = plc.process_level_id
       WHERE pl.process_id = $1 AND plc.is_active ORDER BY plc.category, plc.sequence, plc.created_at`,
      [req.params.id]
    );
    res.json({ process, levels, subLevels, criteria });
  })
);

// ---- Level criteria (migration 0014) ----
masterDataV2Router.get(
  "/processes/:processId/levels/:levelId/criteria",
  asyncHandler(async (req, res) => {
    res.json(await listCriteria(req.params.levelId, req.currentUser!));
  })
);
masterDataV2Router.post(
  "/processes/:processId/levels/:levelId/criteria",
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCriterion(req.params.levelId, req.body, req.currentUser!));
  })
);
masterDataV2Router.patch(
  "/processes/:processId/levels/:levelId/criteria/:criterionId",
  asyncHandler(async (req, res) => {
    res.json(await updateCriterion(req.params.criterionId, req.body, req.currentUser!));
  })
);
masterDataV2Router.delete(
  "/processes/:processId/levels/:levelId/criteria/:criterionId",
  asyncHandler(async (req, res) => {
    res.json(await deleteCriterion(req.params.criterionId, req.currentUser!));
  })
);

// ---- Level sub-levels (migration 0014) ----
masterDataV2Router.get(
  "/processes/:processId/levels/:levelId/sub-levels",
  asyncHandler(async (req, res) => {
    res.json(await listSubLevels(req.params.levelId, req.currentUser!));
  })
);
masterDataV2Router.post(
  "/processes/:processId/levels/:levelId/sub-levels",
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSubLevel(req.params.levelId, req.body, req.currentUser!));
  })
);
masterDataV2Router.patch(
  "/processes/:processId/levels/:levelId/sub-levels/:subLevelId",
  asyncHandler(async (req, res) => {
    res.json(await updateSubLevel(req.params.subLevelId, req.body, req.currentUser!));
  })
);
masterDataV2Router.delete(
  "/processes/:processId/levels/:levelId/sub-levels/:subLevelId",
  asyncHandler(async (req, res) => {
    res.json(await deleteSubLevel(req.params.subLevelId, req.currentUser!));
  })
);

// ---- Worker sub-level progress (migration 0014) ----
masterDataV2Router.get(
  "/workers/:workerId/sub-level-progress",
  asyncHandler(async (req, res) => {
    res.json(await listProgress(req.params.workerId, req.currentUser!));
  })
);
masterDataV2Router.post(
  "/workers/:workerId/sub-levels/:subLevelId/progress",
  asyncHandler(async (req, res) => {
    res.status(201).json(await markProgress(req.params.workerId, req.params.subLevelId, req.body, req.currentUser!));
  })
);

masterDataV2Router.get(
  "/processes/:processId/levels/:levelId/template",
  asyncHandler(async (req, res) => {
    const pkg = await queryOne<any>(
      `SELECT * FROM assessment_template WHERE process_level_id = $1 AND is_active ORDER BY version DESC LIMIT 1`,
      [req.params.levelId]
    );
    if (!pkg) return res.json(null);
    const components = await query<any>(
      `SELECT apc.*, ad.name, ad.description, ad.assessment_type,
              (SELECT count(*) FROM question ai WHERE ai.assessment_id = apc.assessment_id AND ai.is_active)::int AS item_count
       FROM assessment_template_assessment apc JOIN assessment ad ON ad.assessment_id = apc.assessment_id
       WHERE apc.assessment_template_id = $1 ORDER BY apc.sequence_no`,
      [pkg.assessment_template_id]
    );
    const roleScope = await query<any>(
      `SELECT ars.capacity, r.role_code, r.role_name FROM assessment_template_role_scope ars JOIN role r ON r.role_id = ars.role_id WHERE ars.assessment_template_id = $1`,
      [pkg.assessment_template_id]
    );
    res.json({ ...pkg, components, roleScope });
  })
);

masterDataV2Router.get(
  "/assessments",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const rows = await query<any>(
      `SELECT ad.*,
              (SELECT count(*) FROM question ai WHERE ai.assessment_id = ad.assessment_id AND ai.is_active)::int AS item_count,
              (SELECT ai.question_type FROM question ai WHERE ai.assessment_id = ad.assessment_id AND ai.is_active LIMIT 1) AS sample_question_type
       FROM assessment ad
       ${companyId ? "WHERE ad.company_id = $1" : ""}
       ORDER BY ad.name`,
      companyId ? [companyId] : []
    );
    res.json(rows);
  })
);

masterDataV2Router.get(
  "/assessments/:id/items",
  asyncHandler(async (req, res) => {
    const items = await query<any>(`SELECT * FROM question WHERE assessment_id = $1 ORDER BY sequence_no`, [req.params.id]);
    res.json(items);
  })
);

masterDataV2Router.get(
  "/workers/search",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const { q } = req.query;
    const params: any[] = [];
    const clauses: string[] = [];
    if (companyId) { params.push(companyId); clauses.push(`w.company_id = $${params.length}`); }
    if (q) { params.push(`%${String(q).toLowerCase()}%`); clauses.push(`(lower(w.first_name || ' ' || coalesce(w.last_name,'')) LIKE $${params.length} OR lower(w.hrms_employee_code) LIKE $${params.length})`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await query<any>(
      // A worker can hold multiple active process enrollments — a plain
      // LEFT JOIN would fan out into one row per enrollment (real bug this
      // fixes: React logged duplicate-key warnings because the same
      // worker_id came back multiple times, and workers with 2+ enrollments
      // showed up as separate list entries with different "current
      // process" values). The LATERAL join picks exactly one representative
      // enrollment per worker, so this always returns one row per worker.
      `SELECT w.worker_id, w.hrms_employee_code, w.first_name, w.last_name, w.employment_type, w.date_of_joining,
              jr.name AS designation, ou.name AS department,
              wpe.process_id, p.name AS process_name, pl.code AS level_code
       FROM worker w
       LEFT JOIN job_role jr ON jr.job_role_id = w.primary_job_role_id
       JOIN org_unit ou ON ou.org_unit_id = w.org_unit_id
       LEFT JOIN LATERAL (
         SELECT * FROM worker_process_enrollment e
         WHERE e.worker_id = w.worker_id AND e.status = 'active'
         ORDER BY e.enrolled_at DESC LIMIT 1
       ) wpe ON true
       LEFT JOIN process p ON p.process_id = wpe.process_id
       LEFT JOIN process_level pl ON pl.process_level_id = wpe.current_process_level_id
       ${where} ORDER BY w.first_name LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

masterDataV2Router.get(
  "/workers/:id/profile",
  asyncHandler(async (req, res) => {
    const worker = await queryOne<any>(
      `SELECT w.*, ou.name AS org_unit_name, ds.name AS data_source_name, jr.name AS designation
       FROM worker w
       JOIN org_unit ou ON ou.org_unit_id = w.org_unit_id
       LEFT JOIN data_source ds ON ds.data_source_id = w.data_source_id
       LEFT JOIN job_role jr ON jr.job_role_id = w.primary_job_role_id
       WHERE w.worker_id = $1`,
      [req.params.id]
    );
    if (!worker) throw new ApiError(404, "Worker not found");
    scopedCompanyId(req, worker.company_id);
    const enrollments = await query<any>(
      `SELECT wpe.*, p.name AS process_name, p.code AS process_code, p.process_id,
              cur.code AS current_level_code, cur.name AS current_level_name,
              tgt.code AS target_level_code, tgt.name AS target_level_name
       FROM worker_process_enrollment wpe
       JOIN process p ON p.process_id = wpe.process_id
       LEFT JOIN process_level cur ON cur.process_level_id = wpe.current_process_level_id
       LEFT JOIN process_level tgt ON tgt.process_level_id = wpe.target_process_level_id
       WHERE wpe.worker_id = $1`,
      [req.params.id]
    );
    const hasPin = await queryOne(`SELECT 1 FROM worker_verification_credential WHERE worker_id = $1`, [req.params.id]);
    const certificates = await query<any>(
      `SELECT c.*, p.name AS process_name, pl.code AS level_code
       FROM certificate c JOIN process p ON p.process_id = c.process_id LEFT JOIN process_level pl ON pl.process_level_id = c.certified_process_level_id
       WHERE c.worker_id = $1 ORDER BY c.issued_at DESC`,
      [req.params.id]
    );
    res.json({ ...worker, enrollments, hasSelfAssessPin: !!hasPin, certificates });
  })
);

masterDataV2Router.post(
  "/workers/:id/enroll",
  asyncHandler(async (req, res) => {
    const { processId, targetProcessLevelId } = req.body;
    const row = await queryOne<any>(
      `INSERT INTO worker_process_enrollment (worker_id, process_id, target_process_level_id, source) VALUES ($1,$2,$3,'manual')
       ON CONFLICT (worker_id, process_id) DO UPDATE SET target_process_level_id = EXCLUDED.target_process_level_id RETURNING *`,
      [req.params.id, processId, targetProcessLevelId ?? null]
    );
    res.status(201).json(row);
  })
);

masterDataV2Router.get(
  "/data-sources",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const rows = await query<any>(
      `SELECT ds.*, (SELECT count(*) FROM worker w WHERE w.data_source_id = ds.data_source_id)::int AS worker_count
       FROM data_source ds ${companyId ? "WHERE ds.company_id = $1" : ""} ORDER BY ds.name`,
      companyId ? [companyId] : []
    );
    res.json(rows);
  })
);

masterDataV2Router.post(
  "/data-sources/:id/sync",
  asyncHandler(async (req, res) => {
    const workerCount = await queryOne<{ cnt: string }>(`SELECT count(*) AS cnt FROM worker WHERE data_source_id = $1`, [req.params.id]);
    await query(
      `INSERT INTO sync_run (data_source_id, status, workers_synced, finished_at) VALUES ($1,'success',$2, now())`,
      [req.params.id, Number(workerCount?.cnt ?? 0)]
    );
    await query(`UPDATE data_source SET last_success_sync_at = now(), last_attempt_sync_at = now() WHERE data_source_id = $1`, [req.params.id]);
    res.json({ status: "success", workersSynced: Number(workerCount?.cnt ?? 0) });
  })
);

masterDataV2Router.get(
  "/dashboard/trainer",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const inQueue = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM qualification_case WHERE status = 'READY_FOR_ASSESSMENT' AND ($1::uuid IS NULL OR company_id = $1)`, [companyId]
    );
    const pendingApprovals = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM qualification_case WHERE status = 'PENDING_APPROVAL' AND ($1::uuid IS NULL OR company_id = $1)`, [companyId]
    );
    const expiring = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM certificate c JOIN worker w ON w.worker_id = c.worker_id
       WHERE c.status = 'active' AND c.valid_to <= CURRENT_DATE + INTERVAL '30 days' AND ($1::uuid IS NULL OR w.company_id = $1)`, [companyId]
    );
    const retests = await queryOne<{ cnt: string }>(
      `SELECT count(*) AS cnt FROM qualification_case WHERE status IN ('FAILED','RETEST_COOLING') AND ($1::uuid IS NULL OR company_id = $1)`, [companyId]
    );
    res.json({
      inQueue: Number(inQueue?.cnt ?? 0),
      retestsDue: Number(retests?.cnt ?? 0),
      expiring30d: Number(expiring?.cnt ?? 0),
      approvalsPending: Number(pendingApprovals?.cnt ?? 0),
    });
  })
);

masterDataV2Router.get(
  "/dashboard/management",
  asyncHandler(async (req, res) => {
    const companyId = req.currentUser?.companyId;
    const totals = await queryOne<any>(
      `SELECT
         (SELECT count(*) FROM worker WHERE status = 'active' AND ($1::uuid IS NULL OR company_id = $1)) AS total_workers,
         (SELECT count(*) FROM certificate c JOIN worker w ON w.worker_id = c.worker_id WHERE c.status = 'active' AND ($1::uuid IS NULL OR w.company_id = $1)) AS certifications_active`,
      [companyId]
    );
    const multiSkill = await query<any>(
      `SELECT worker_id FROM worker_process_enrollment WHERE current_process_level_id IS NOT NULL GROUP BY worker_id HAVING count(DISTINCT process_id) >= 2`
    );
    const matrix = await query<any>(
      `SELECT w.worker_id, w.first_name, w.last_name, p.name AS process_name, pl.code AS level_code, pld.code AS primary_code
       FROM worker_process_enrollment wpe
       JOIN worker w ON w.worker_id = wpe.worker_id
       JOIN process p ON p.process_id = wpe.process_id
       LEFT JOIN process_level pl ON pl.process_level_id = wpe.current_process_level_id
       LEFT JOIN primary_level_definition pld ON pld.primary_level_id = pl.primary_level_id
       WHERE ($1::uuid IS NULL OR w.company_id = $1) ORDER BY w.first_name`,
      [companyId]
    );
    res.json({
      totalWorkers: Number(totals?.total_workers ?? 0),
      certificationsActive: Number(totals?.certifications_active ?? 0),
      multiSkilledWorkers: multiSkill.length,
      matrix,
    });
  })
);

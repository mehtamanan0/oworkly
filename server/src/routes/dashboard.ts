import { Router } from "express";
import { query, queryOne } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [workerCounts, processCounts, outcomeCounts, certCounts, openGaps, openEscalations, retestQueue, employmentSplit] =
      await Promise.all([
        queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM worker`),
        queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_critical)::int AS critical FROM process WHERE is_active`),
        queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE result = 'PASS')::int AS passed, count(*) FILTER (WHERE result = 'FAIL')::int AS failed FROM assessment_outcome`),
        queryOne(`SELECT count(*)::int AS total FROM certificate WHERE status = 'active'`),
        queryOne(`SELECT count(*)::int AS total FROM skill_gap WHERE status = 'open'`),
        queryOne(`SELECT count(*)::int AS total FROM escalation_event WHERE resolved_at IS NULL`),
        queryOne(`SELECT count(*)::int AS total FROM retest_cycle WHERE status IN ('cooling_period','eligible')`),
        query(`SELECT employment_type, count(*)::int AS cnt FROM worker GROUP BY employment_type`),
      ]);

    const skillMatrix = await query(`
      SELECT p.process_id,
             count(*) FILTER (WHERE wps.current_skill_level_id IS NOT NULL)::int AS assessed,
             count(*)::int AS tracked
      FROM process p
      LEFT JOIN worker_process_skill wps ON wps.process_id = p.process_id
      WHERE p.is_active
      GROUP BY p.process_id
    `);
    const totalTracked = (skillMatrix as any[]).reduce((a, r) => a + r.tracked, 0);
    const totalAssessed = (skillMatrix as any[]).reduce((a, r) => a + r.assessed, 0);

    res.json({
      workers: workerCounts,
      processes: processCounts,
      outcomes: outcomeCounts,
      activeCertificates: certCounts?.total ?? 0,
      openSkillGaps: openGaps?.total ?? 0,
      openEscalations: openEscalations?.total ?? 0,
      retestQueueSize: retestQueue?.total ?? 0,
      employmentSplit,
      overallAssessedPct: totalTracked > 0 ? Math.round((totalAssessed / totalTracked) * 1000) / 10 : 0,
    });
  })
);

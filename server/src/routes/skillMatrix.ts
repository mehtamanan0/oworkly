import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const skillMatrixRouter = Router();

// Plant-level Process x L1-L4 required-vs-actual headcount view. This is a
// deliberate MVP simplification of what `01_Architecture_Overview.md` §13
// scopes as Phase 2 (Module 7 Skill Matrix / Module 8 Headcount Alerts) — see
// the header note in db/schema.sql. Distinct from true Module 6 Gap Analysis
// (per-worker, assessment-driven), served from /api/v1/skill-gaps.
skillMatrixRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { orgUnitId } = req.query;
    const params: any[] = [];
    let where = "p.is_active";
    if (orgUnitId) {
      params.push(orgUnitId);
      where += ` AND p.org_unit_id = $${params.length}`;
    }
    const processes = await query(
      `SELECT p.process_id, p.name, p.code, p.is_critical, p.org_unit_id, ou.name AS org_unit_name,
              p.required_headcount_l2, p.required_headcount_l3, p.required_headcount_l4
       FROM process p JOIN org_unit ou ON ou.org_unit_id = p.org_unit_id
       WHERE ${where} ORDER BY ou.name, p.code`,
      params
    );

    const levelCounts = await query(
      `SELECT wps.process_id, sld.level_code, count(*)::int AS cnt
       FROM worker_process_skill wps
       LEFT JOIN skill_level_definition sld ON sld.skill_level_id = wps.current_skill_level_id
       GROUP BY wps.process_id, sld.level_code`
    );
    const countsByProcess = new Map<string, Record<string, number>>();
    for (const row of levelCounts as any[]) {
      const key = row.process_id;
      if (!countsByProcess.has(key)) countsByProcess.set(key, {});
      countsByProcess.get(key)![row.level_code ?? "UNASSESSED"] = row.cnt;
    }

    const ORDINAL: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

    const result = (processes as any[]).map((p) => {
      const counts = countsByProcess.get(p.process_id) || {};
      const totalTracked = Object.values(counts).reduce((a, b) => a + b, 0);

      let requiredLevelCode: string | null = null;
      let requiredHeadcount: number | null = null;
      if (p.required_headcount_l2 != null) { requiredLevelCode = "L2"; requiredHeadcount = p.required_headcount_l2; }
      else if (p.required_headcount_l3 != null) { requiredLevelCode = "L3"; requiredHeadcount = p.required_headcount_l3; }
      else if (p.required_headcount_l4 != null) { requiredLevelCode = "L4"; requiredHeadcount = p.required_headcount_l4; }

      let atOrAboveRequired = 0;
      let belowRequired = 0;
      if (requiredLevelCode) {
        const reqOrdinal = ORDINAL[requiredLevelCode];
        for (const [levelCode, cnt] of Object.entries(counts)) {
          const ordinal = ORDINAL[levelCode] ?? 0;
          if (ordinal >= reqOrdinal) atOrAboveRequired += cnt;
          else belowRequired += cnt;
        }
      }
      const pctSkillGap = atOrAboveRequired > 0 ? Math.round((belowRequired / atOrAboveRequired) * 10000) / 100 : null;

      return {
        processId: p.process_id,
        code: p.code,
        name: p.name,
        isCritical: p.is_critical,
        orgUnitId: p.org_unit_id,
        orgUnitName: p.org_unit_name,
        requiredHeadcount: { L2: p.required_headcount_l2, L3: p.required_headcount_l3, L4: p.required_headcount_l4 },
        actualHeadcountByLevel: counts,
        totalTracked,
        requiredLevelCode,
        requiredHeadcount_primary: requiredHeadcount,
        atOrAboveRequired,
        belowRequired,
        pctSkillGap,
      };
    });

    res.json(result);
  })
);

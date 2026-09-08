import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SkillMatrixRow } from "../lib/api";
import { Badge, Card, ErrorState, LoadingState } from "../components/ui";

function GapBar({ row }: { row: SkillMatrixRow }) {
  if (row.pctSkillGap === null) {
    return <span className="text-xs italic text-slate-400">N/A (no one yet meets required level — same as the source workbook's #DIV/0!)</span>;
  }
  const pct = Math.min(100, row.pctSkillGap);
  const tone = row.pctSkillGap > 50 ? "bg-rose-500" : row.pctSkillGap > 20 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600">{row.pctSkillGap}%</span>
    </div>
  );
}

export function SkillMatrix() {
  const [criticalOnly, setCriticalOnly] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["skill-matrix"],
    queryFn: () => api.get<SkillMatrixRow[]>("/skill-matrix"),
  });

  const rows = useMemo(() => (data ?? []).filter((r) => !criticalOnly || r.isCritical), [data, criticalOnly]);

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load skill matrix" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skill Matrix & Gap Analysis</h1>
          <p className="text-sm text-slate-500">
            Process × required level vs. actual worker headcount — computed live from the ingested WTG Skill Matrix workbook.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
          Critical processes only
        </label>
      </div>

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Process</th>
                <th>Area</th>
                <th>Critical</th>
                <th>Required level</th>
                <th>Required HC</th>
                <th>At/above required</th>
                <th>Below required</th>
                <th>% Skill gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.processId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/processes/${r.processId}`} className="font-medium hover:underline">{r.name}</Link>
                    <div className="font-mono text-xs text-slate-400">{r.code}</div>
                  </td>
                  <td className="text-slate-500">{r.orgUnitName}</td>
                  <td>{r.isCritical ? <Badge color="red">Critical</Badge> : <Badge>Standard</Badge>}</td>
                  <td>{r.requiredLevelCode ? <Badge color="blue">{r.requiredLevelCode}</Badge> : "–"}</td>
                  <td className="font-mono">{r.requiredHeadcount_primary ?? "–"}</td>
                  <td className="font-mono text-emerald-700">{r.atOrAboveRequired}</td>
                  <td className="font-mono text-rose-700">{r.belowRequired}</td>
                  <td><GapBar row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-400">
        This plant-level view is an MVP convenience precursor to the Phase 2 Skill Matrix / Headcount Alerts engine (Modules 7–8).
        Per-worker, assessment-driven Gap Analysis (Module 6, Phase 1) lives on the{" "}
        <Link to="/gap-analysis" className="text-indigo-600 hover:underline">Gap Analysis & Retest</Link> page.
      </p>
    </div>
  );
}

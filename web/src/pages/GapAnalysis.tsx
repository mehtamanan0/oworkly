import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Badge, Card, ErrorState, LoadingState } from "../components/ui";

function RecommendedActivities({ skillGapId }: { skillGapId: string }) {
  const { data } = useQuery({
    queryKey: ["recommended", skillGapId],
    queryFn: () => api.get<any[]>(`/skill-gaps/${skillGapId}/recommended-activities`),
  });
  if (!data || data.length === 0) return <span className="text-xs italic text-slate-400">No rule matched yet</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {data.map((r) => (
        <Badge key={r.recommended_activity_id} color={r.source === "ai_suggested" ? "indigo" : "blue"}>
          {r.title ?? "Activity"} {r.source === "ai_suggested" && !r.approved_by_user_id && "(pending approval)"}
        </Badge>
      ))}
    </div>
  );
}

export function GapAnalysis() {
  const gapsQuery = useQuery({ queryKey: ["skill-gaps", "open"], queryFn: () => api.get<any[]>("/skill-gaps?status=open") });
  const retestQuery = useQuery({ queryKey: ["retest-cycles"], queryFn: () => api.get<any[]>("/retest-cycles") });
  const escalationsQuery = useQuery({ queryKey: ["escalations", "open"], queryFn: () => api.get<any[]>("/escalations?status=open") });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Gap Analysis & Retest</h1>
        <p className="text-sm text-slate-500">Module 5–6 — per-worker, assessment-driven gaps and remediation, distinct from the plant-level Skill Matrix view.</p>
      </div>

      <Card title="Open skill gaps (from failed assessments)">
        {gapsQuery.isLoading && <LoadingState />}
        {gapsQuery.error && <ErrorState message="Could not load skill gaps" />}
        {gapsQuery.data && gapsQuery.data.length === 0 && <div className="text-sm text-slate-400">No open gaps — nice.</div>}
        {gapsQuery.data && gapsQuery.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Worker</th>
                <th>Process</th>
                <th>Gap type</th>
                <th>Magnitude</th>
                <th>Recommended learning</th>
              </tr>
            </thead>
            <tbody>
              {gapsQuery.data.map((g) => (
                <tr key={g.skill_gap_id} className="border-t border-slate-100">
                  <td className="py-2"><Link className="text-indigo-600 hover:underline" to={`/workers/${g.worker_id}`}>{g.first_name} {g.last_name}</Link></td>
                  <td>{g.process_name}</td>
                  <td><Badge color="amber">{g.gap_type}</Badge></td>
                  <td className="font-mono">{g.magnitude_pct}%</td>
                  <td><RecommendedActivities skillGapId={g.skill_gap_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Retest queue">
          {retestQuery.isLoading && <LoadingState />}
          {retestQuery.data && retestQuery.data.length === 0 && <div className="text-sm text-slate-400">Empty.</div>}
          {retestQuery.data?.map((r) => (
            <div key={r.retest_cycle_id} className="flex items-center justify-between border-t border-slate-100 py-2 text-sm first:border-0">
              <span><Link className="text-indigo-600 hover:underline" to={`/workers/${r.worker_id}`}>{r.first_name} {r.last_name}</Link> — {r.process_name}</span>
              <Badge color={r.status === "resolved_escalated" ? "red" : "slate"}>
                {r.status === "cooling_period" ? `eligible ${String(r.eligible_from_date).slice(0, 10)}` : r.status}
              </Badge>
            </div>
          ))}
        </Card>
        <Card title="Open escalations">
          {escalationsQuery.isLoading && <LoadingState />}
          {escalationsQuery.data && escalationsQuery.data.length === 0 && <div className="text-sm text-slate-400">None open.</div>}
          {escalationsQuery.data?.map((e) => (
            <div key={e.escalation_event_id} className="flex items-center justify-between border-t border-slate-100 py-2 text-sm first:border-0">
              <span><Link className="text-indigo-600 hover:underline" to={`/workers/${e.worker_id}`}>{e.first_name} {e.last_name}</Link> — {e.process_name}</span>
              <Badge color="red">{e.reason}</Badge>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

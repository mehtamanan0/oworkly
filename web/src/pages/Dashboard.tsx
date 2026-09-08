import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type DashboardSummary } from "../lib/api";
import { Card, ErrorState, LoadingState, StatCard } from "../components/ui";

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load dashboard" />;

  const contract = data.employmentSplit.find((e) => e.employment_type === "contract")?.cnt ?? 0;
  const permanent = data.employmentSplit.find((e) => e.employment_type === "permanent")?.cnt ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          WTG Daman plant — live data ingested from the real Suzlon skill-matrix workbook. Standalone deployment mode.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Workers tracked" value={data.workers.total} sub={`${permanent} permanent · ${contract} contract`} />
        <StatCard label="Processes" value={data.processes.total} sub={`${data.processes.critical} marked critical`} />
        <StatCard label="Active certificates" value={data.activeCertificates} tone="good" />
        <StatCard label="Open skill gaps" value={data.openSkillGaps} tone={data.openSkillGaps > 0 ? "warn" : "default"} />
        <StatCard label="Retest queue" value={data.retestQueueSize} />
        <StatCard label="Open escalations" value={data.openEscalations} tone={data.openEscalations > 0 ? "danger" : "default"} />
        <StatCard
          label="Assessment outcomes"
          value={data.outcomes.total}
          sub={data.outcomes.total ? `${data.outcomes.passed} pass · ${data.outcomes.failed} fail` : "none run yet"}
        />
        <StatCard label="% workers assessed" value={`${data.overallAssessedPct}%`} sub="attained a level vs. tracked" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Where to look first">
          <ul className="space-y-2 text-sm">
            <li><Link className="text-indigo-600 hover:underline" to="/skill-matrix">Skill Matrix & Gap Analysis</Link> — required vs. actual headcount by level, per process</li>
            <li><Link className="text-indigo-600 hover:underline" to="/workers">Worker Roster</Link> — 120 real workers ingested from the WTG workbook</li>
            <li><Link className="text-indigo-600 hover:underline" to="/assessments">Run a live Assessment</Link> — theory + practical + behaviour → pass/fail → certificate</li>
            <li><Link className="text-indigo-600 hover:underline" to="/ingestion">Ingestion Report</Link> — what the pipeline did with the real file, including the messy bits</li>
          </ul>
        </Card>
        <Card title="Deployment mode">
          <div className="space-y-1 text-sm text-slate-600">
            <div>Integration profile: <b>Standalone</b> (no HRMS dependency)</div>
            <div>AI provider mode: <b>n/a for MVP</b> — quiz/checklist generation seeded manually</div>
            <div>Multi-tenancy: single tenant (collapsed form per §7)</div>
          </div>
        </Card>
        <Card title="Module coverage (Phase 1)">
          <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
            <div>1. Setup & Master Data ✅</div>
            <div>2. Learning Paths ✅</div>
            <div>3. Assessment Engine ✅</div>
            <div>4. Outcome & Certification ✅</div>
            <div>5. Retest & Cooling ✅</div>
            <div>6. Gap Analysis ✅</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

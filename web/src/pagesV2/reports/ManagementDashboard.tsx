import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { KpiCard } from "../../components/figma/KpiCard";
import { SectionCard } from "../../components/figma/SectionCard";
import { LevelBadge } from "../../components/figma/Badge";
import { v2, qual } from "../../lib/apiV2";

interface MatrixRow {
  worker_id: string;
  first_name: string;
  last_name: string;
  process_name: string;
  level_code: string | null;
  primary_code: string | null;
}
interface DashboardData {
  totalWorkers: number;
  certificationsActive: number;
  multiSkilledWorkers: number;
  matrix: MatrixRow[];
}
interface QCaseRow {
  qualification_case_id: string;
  first_name: string;
  last_name: string;
  process_name: string;
  from_level_code: string | null;
  target_level_code: string;
  status: string;
}

export function ManagementDashboard() {
  const { data } = useQuery({ queryKey: ["dashboard-management"], queryFn: () => v2.get<DashboardData>("/dashboard/management") });
  const { data: pipeline } = useQuery({
    queryKey: ["qc-pipeline"],
    queryFn: () => qual.get<QCaseRow[]>("/qualification-cases?status=ASSESSMENT_IN_PROGRESS&status=PENDING_APPROVAL&status=READY_FOR_ASSESSMENT"),
  });

  const processNames = Array.from(new Set(data?.matrix.map((m) => m.process_name) ?? []));
  const workerIds = Array.from(new Set(data?.matrix.map((m) => m.worker_id) ?? []));
  const byWorkerProcess = new Map(data?.matrix.map((m) => [`${m.worker_id}::${m.process_name}`, m]));
  const workers = workerIds.map((id) => data!.matrix.find((m) => m.worker_id === id)!);

  const distribution: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const m of data?.matrix.filter((m) => m.process_name === processNames[0]) ?? []) {
    if (m.primary_code) distribution[m.primary_code] = (distribution[m.primary_code] ?? 0) + 1;
  }

  return (
    <AppShell breadcrumbs={[{ label: "Reports", to: "/reports/management-dashboard" }, { label: "Management Dashboard" }]}>
      <PageHeader title="Management Dashboard" description="Chennai Wind Energy Plant · Live certification data" action={<span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-fig-green">Auto-Updated</span>} />

      <div className="mb-5 grid grid-cols-4 gap-4">
        <KpiCard value={data?.totalWorkers ?? "—"} label="Total Workers · Active" tone="blue" icon="👥" />
        <KpiCard value={data?.certificationsActive ?? "—"} label="Certifications Active" tone="green" icon="🏅" />
        <KpiCard value={data?.multiSkilledWorkers ?? "—"} label="Multi-Skilled Workers · 2+ process certifications" tone="purple" icon="🧩" />
        <KpiCard value={pipeline?.length ?? "—"} label="Pipeline (Upgrading) · In assessment/OJT" tone="orange" icon="📈" />
      </div>

      <SectionCard title="Visual Skill Matrix" className="mb-5" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                <th className="px-5 py-2.5">Worker</th>
                {processNames.map((p) => (
                  <th key={p} className="px-3 py-2.5">{p}</th>
                ))}
                <th className="px-3 py-2.5">Skills</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => {
                const skillCount = processNames.filter((p) => byWorkerProcess.get(`${w.worker_id}::${p}`)?.level_code).length;
                return (
                  <tr key={w.worker_id} className="border-b border-fig-border last:border-b-0">
                    <td className="flex items-center gap-2 px-5 py-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fig-navy text-[10px] font-semibold text-white">
                        {w.first_name[0]}
                        {w.last_name?.[0]}
                      </span>
                      <span className="font-medium text-fig-text">
                        {w.first_name} {w.last_name}
                      </span>
                    </td>
                    {processNames.map((p) => (
                      <td key={p} className="px-3 py-2.5">
                        <LevelBadge code={byWorkerProcess.get(`${w.worker_id}::${p}`)?.level_code} />
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-fig-green">{skillCount}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-4">
        <SectionCard title={`L1/L2/L3/L4 Distribution — ${processNames[0] ?? ""}`}>
          <div className="space-y-2">
            {(["L1", "L2", "L3", "L4"] as const).map((lvl) => (
              <div key={lvl} className="flex items-center gap-3">
                <LevelBadge code={lvl} />
                <div className="h-2 flex-1 overflow-hidden rounded bg-fig-bg">
                  <div className="h-full bg-fig-blue" style={{ width: `${((distribution[lvl] ?? 0) / Math.max(1, workers.length)) * 100}%` }} />
                </div>
                <span className="w-4 text-right text-xs font-medium text-fig-text">{distribution[lvl] ?? 0}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Qualification Pipeline" padded={false}>
          {(!pipeline || pipeline.length === 0) && <div className="p-5 text-sm text-fig-muted">No workers currently upgrading.</div>}
          {pipeline?.slice(0, 6).map((q) => (
            <div key={q.qualification_case_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3 last:border-b-0">
              <div>
                <div className="text-sm font-medium text-fig-text">
                  {q.first_name} {q.last_name}
                </div>
                <div className="text-xs text-fig-muted">
                  {q.process_name} · {q.from_level_code ?? "—"} → {q.target_level_code}
                </div>
              </div>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-fig-blue">
                {q.status === "PENDING_APPROVAL" ? "Approval" : q.status === "ASSESSMENT_IN_PROGRESS" ? "Assessment" : "OJT"}
              </span>
            </div>
          ))}
        </SectionCard>
      </div>
    </AppShell>
  );
}

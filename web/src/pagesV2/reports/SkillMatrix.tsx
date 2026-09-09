import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { LevelBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";

interface MatrixRow {
  worker_id: string;
  first_name: string;
  last_name: string;
  process_name: string;
  level_code: string | null;
}
interface DashboardData {
  totalWorkers: number;
  matrix: MatrixRow[];
}

// A focused view of the same real skill-matrix data the Management Dashboard
// shows in full (KPIs + pipeline) — this is the quick top-nav lookup.
export function SkillMatrix() {
  const { data } = useQuery({ queryKey: ["dashboard-management"], queryFn: () => v2.get<DashboardData>("/dashboard/management") });
  const processNames = Array.from(new Set(data?.matrix.map((m) => m.process_name) ?? []));
  const workerIds = Array.from(new Set(data?.matrix.map((m) => m.worker_id) ?? []));
  const byWorkerProcess = new Map(data?.matrix.map((m) => [`${m.worker_id}::${m.process_name}`, m]));
  const workers = workerIds.map((id) => data!.matrix.find((m) => m.worker_id === id)!);

  return (
    <AppShell breadcrumbs={[{ label: "Skill Matrix" }]}>
      <PageHeader title="Skill Matrix" description={`Process-level competency for every worker · ${data?.totalWorkers ?? 0} active workers`} />
      <SectionCard padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                <th className="px-5 py-2.5">Worker</th>
                {processNames.map((p) => (
                  <th key={p} className="px-3 py-2.5">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}

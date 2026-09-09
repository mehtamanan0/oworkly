import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { Button } from "../../components/figma/Button";
import { LevelBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";

interface WorkerRow {
  worker_id: string;
  hrms_employee_code: string;
  first_name: string;
  last_name: string;
  employment_type: "DIRECT" | "CONTRACT" | "VENDOR";
  designation: string | null;
  department: string | null;
  process_name: string | null;
  level_code: string | null;
  date_of_joining: string | null;
}
interface DataSourceRow {
  data_source_id: string;
  name: string;
  worker_count: number;
}

const TYPE_TONE: Record<string, string> = {
  DIRECT: "text-fig-green",
  CONTRACT: "text-fig-orange",
  VENDOR: "text-fig-blue",
};

export function WorkerMaster() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"ALL" | "DIRECT" | "CONTRACT" | "VENDOR">("ALL");
  const [q, setQ] = useState("");
  const { data: workers } = useQuery({ queryKey: ["worker-master"], queryFn: () => v2.get<WorkerRow[]>("/workers/search") });
  const { data: sources } = useQuery({ queryKey: ["data-sources"], queryFn: () => v2.get<DataSourceRow[]>("/data-sources") });

  const filtered = useMemo(() => {
    return (workers ?? []).filter((w) => {
      if (filter !== "ALL" && w.employment_type !== filter) return false;
      if (q && !`${w.first_name} ${w.last_name} ${w.hrms_employee_code} ${w.designation ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [workers, filter, q]);

  return (
    <AppShell breadcrumbs={[{ label: "Workers", to: "/workers" }, { label: "Worker Master" }]}>
      <PageHeader
        title="Worker Master"
        description="All workers across Direct, Contract, and Vendor engagement types. Sourced from multiple systems."
        action={<Button disabled>+ Add Worker</Button>}
      />

      <div className="mb-5 grid grid-cols-5 gap-4">
        <KpiMini value={0} label="OWorkly" tone="text-slate-500" />
        {(sources ?? []).map((s) => (
          <KpiMini key={s.data_source_id} value={s.worker_count} label={s.name} tone="text-fig-green" />
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fig-muted">🔍</span>
          <input
            className="w-full rounded-lg border border-fig-border py-2 pl-9 pr-3 text-sm focus:border-fig-blue focus:outline-none"
            placeholder="Search by ID, name, designation, or department…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-fig-border text-xs font-medium">
          {(["ALL", "DIRECT", "CONTRACT", "VENDOR"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 capitalize ${filter === f ? "bg-fig-navy text-white" : "bg-white text-fig-text hover:bg-fig-bg"}`}
            >
              {f === "ALL" ? "All" : f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-fig-card border border-fig-border bg-white shadow-fig-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
              <th className="px-5 py-2.5">Worker ID</th>
              <th className="px-3 py-2.5">Name &amp; Designation</th>
              <th className="px-3 py-2.5">Department</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Process Level</th>
              <th className="px-3 py-2.5">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.worker_id} onClick={() => navigate(`/workers/${w.worker_id}/profile`)} className="cursor-pointer border-b border-fig-border last:border-b-0 hover:bg-fig-bg">
                <td className="px-5 py-3 font-medium text-fig-text">{w.hrms_employee_code}</td>
                <td className="px-3 py-3">
                  <div className="font-medium text-fig-text">
                    {w.first_name} {w.last_name}
                  </div>
                  <div className="text-xs text-fig-muted">{w.designation}</div>
                </td>
                <td className="px-3 py-3 text-fig-text">{w.department}</td>
                <td className={`px-3 py-3 font-medium ${TYPE_TONE[w.employment_type]}`}>{w.employment_type}</td>
                <td className="px-3 py-3">
                  <span className="text-fig-muted">{w.process_name}</span> <LevelBadge code={w.level_code} />
                </td>
                <td className="px-3 py-3 text-fig-muted">{w.date_of_joining ? w.date_of_joining.slice(0, 7) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-fig-border px-5 py-2.5 text-xs text-fig-muted">
          Showing {filtered.length} of {workers?.length ?? 0} workers
        </div>
      </div>
    </AppShell>
  );
}

function KpiMini({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-fig-muted">{label}</div>
    </div>
  );
}

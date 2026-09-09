import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { StatusBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";

interface DataSourceRow {
  data_source_id: string;
  name: string;
  source_type: string;
  category: string;
  status: string;
  description: string | null;
  mapped_fields: string[] | null;
  worker_count: number;
  last_success_sync_at: string | null;
}

export function DataSources() {
  const { data: sources } = useQuery({ queryKey: ["data-sources"], queryFn: () => v2.get<DataSourceRow[]>("/data-sources") });
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState<string | null>(null);
  const sync = useMutation({
    mutationFn: (id: string) => v2.post(`/data-sources/${id}/sync`),
    onMutate: (id) => setSyncing(id),
    onSettled: () => {
      setSyncing(null);
      qc.invalidateQueries({ queryKey: ["data-sources"] });
    },
  });

  const totalWorkers = sources?.reduce((s, x) => s + x.worker_count, 0) ?? 0;
  const connected = sources?.filter((s) => s.status.toLowerCase() === "connected").length ?? 0;
  const degraded = sources?.filter((s) => s.status.toLowerCase() === "degraded" || s.status.toLowerCase() === "error").length ?? 0;
  const lastSync = sources?.map((s) => s.last_success_sync_at).filter(Boolean).sort().at(-1);

  return (
    <AppShell breadcrumbs={[{ label: "Workers", to: "/workers" }, { label: "Data Sources" }]}>
      <PageHeader title="Data Sources" description="External systems feeding worker records into OWorkly. Workers can belong to any source." />

      <div className="mb-5 grid grid-cols-4 gap-4">
        <Kpi value={sources?.length ?? 0} label={`Total Sources · ${connected} connected`} />
        <Kpi value={totalWorkers} label="Total Workers" />
        <Kpi value={lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} label="Last Sync" />
        <Kpi value={degraded} label="Degraded — sources need attention" tone={degraded > 0 ? "text-fig-orange" : undefined} />
      </div>

      <div className="space-y-4">
        {sources?.map((s) => (
          <SectionCard key={s.data_source_id}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-lg">🗄️</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fig-text">{s.name}</span>
                    <span className="rounded bg-fig-bg px-1.5 py-0.5 text-[10px] font-medium uppercase text-fig-muted">{s.category}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="mt-0.5 max-w-xl text-xs text-fig-muted">{s.description}</p>
                  {Array.isArray(s.mapped_fields) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.mapped_fields.map((f) => (
                        <span key={f} className="rounded bg-fig-bg px-1.5 py-0.5 text-[10px] text-fig-muted">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-fig-muted">
                    👥 {s.worker_count} workers synced · Last sync: {s.last_success_sync_at ? new Date(s.last_success_sync_at).toLocaleString() : "never"}
                  </div>
                </div>
              </div>
              <Button variant="secondary" disabled={syncing === s.data_source_id} onClick={() => sync.mutate(s.data_source_id)}>
                {syncing === s.data_source_id ? "Syncing…" : "🔄 Sync Now"}
              </Button>
            </div>
          </SectionCard>
        ))}
      </div>

      <div className="mt-4 rounded-fig-card border border-blue-200 bg-blue-50 p-4 text-sm text-fig-text">
        <span className="font-semibold text-fig-blue">ℹ️ OWorkly Native Records</span>
        <p className="mt-1 text-fig-text/80">
          Workers added directly in OWorkly (source: OWorkly) are stored natively and do not sync from an external system. These are typically workers not
          present in any connected HRMS — new hires in transition, on-site short-term labour, or walk-in trainees.
        </p>
      </div>
    </AppShell>
  );
}

function Kpi({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
      <div className={`text-xl font-bold ${tone ?? "text-fig-text"}`}>{value}</div>
      <div className="text-xs text-fig-muted">{label}</div>
    </div>
  );
}

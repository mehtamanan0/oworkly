import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { LevelBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";

interface PrimaryLevel {
  primary_level_id: string;
  code: string;
  label: string;
  description: string | null;
  background_hex: string | null;
  accent_hex: string | null;
}
interface ProcessRow {
  process_id: string;
  code: string;
  name: string;
  org_unit_name: string;
  level_count: number;
  self_assessment_enabled?: boolean;
}
interface Level {
  process_level_id: string;
  code: string;
  name: string;
  description: string | null;
  min_qualification_score_pct: string | null;
  budgeted_headcount: number | null;
  primary_level_code: string | null;
  linked_package_count: number;
}

export function ProcessesLevels() {
  const { data: primaryLevels } = useQuery({ queryKey: ["primary-levels"], queryFn: () => v2.get<PrimaryLevel[]>("/primary-levels") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });
  const [selected, setSelected] = useState<string | null>(null);
  const activeProcessId = selected ?? processes?.[0]?.process_id ?? null;
  const activeProcess = processes?.find((p) => p.process_id === activeProcessId);

  const { data: detail } = useQuery({
    queryKey: ["process-levels", activeProcessId],
    queryFn: () => v2.get<{ process: any; levels: Level[] }>(`/processes/${activeProcessId}/levels`),
    enabled: !!activeProcessId,
  });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Processes & Levels" }]}>
      <PageHeader title="Processes & Levels" description="Configure processes, competency levels, sub-levels, and primary level mappings" action={<Button disabled>+ New Process</Button>} />

      <SectionCard
        title={<span className="text-xs uppercase tracking-wide text-fig-muted">Primary Levels <span className="normal-case text-fig-text">— global master, used for cross-process reporting and skill matrix</span></span>}
        action={<Button variant="secondary" disabled>+ Add Level</Button>}
        className="mb-5"
      >
        <div className="grid grid-cols-4 gap-3">
          {primaryLevels?.map((pl) => (
            <div key={pl.primary_level_id} className="rounded-lg border p-3" style={{ backgroundColor: pl.background_hex ?? "#F1F5F9", borderColor: pl.accent_hex ?? "#94A3B8" }}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: pl.accent_hex ?? "#334155" }}>
                  {pl.label}
                </span>
                <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: pl.accent_hex ?? "#334155" }}>
                  {pl.code}
                </span>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: pl.accent_hex ?? "#475569" }}>
                {pl.description}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid grid-cols-3 gap-4">
        <SectionCard title={`Processes (${processes?.length ?? 0})`} padded={false}>
          {processes?.map((p) => (
            <button
              key={p.process_id}
              onClick={() => setSelected(p.process_id)}
              className={`block w-full border-b border-fig-border px-4 py-3 text-left last:border-b-0 ${activeProcessId === p.process_id ? "bg-blue-50" : "hover:bg-fig-bg"}`}
            >
              <div className={`text-xs font-semibold ${activeProcessId === p.process_id ? "text-fig-blue" : "text-fig-muted"}`}>{p.code}</div>
              <div className="text-sm font-medium text-fig-text">{p.name}</div>
              <div className="text-xs text-fig-muted">
                {p.org_unit_name} · {p.level_count} levels
              </div>
            </button>
          ))}
        </SectionCard>

        {activeProcess && (
          <div className="col-span-2">
            <SectionCard
              title={
                <span>
                  <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-fig-blue">{activeProcess.code}</span>
                  {activeProcess.name}
                </span>
              }
              action={<Button variant="secondary" disabled>+ Add Level</Button>}
              padded={false}
            >
              <div className="border-b border-fig-border px-5 py-3 text-xs text-fig-muted">
                {detail?.process?.description ?? "—"} · Attached to {activeProcess.org_unit_name} · {activeProcess.level_count} levels
              </div>
              <div className="px-5 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fig-muted">📶 Competency Levels</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Name & Description</th>
                      <th className="py-2 pr-3">Min Score</th>
                      <th className="py-2 pr-3">Budget HC</th>
                      <th className="py-2 pr-3">Primary Level</th>
                      <th className="py-2 pr-3">Assessments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail?.levels.map((l) => (
                      <tr key={l.process_level_id} className="border-b border-fig-border last:border-b-0">
                        <td className="py-3 pr-3">
                          <LevelBadge code={l.code} />
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-medium text-fig-text">{l.name}</div>
                          <div className="text-xs text-fig-muted">{l.description}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <span
                            className={`font-semibold ${
                              Number(l.min_qualification_score_pct) >= 80
                                ? "text-fig-red"
                                : Number(l.min_qualification_score_pct) >= 75
                                ? "text-fig-orange"
                                : "text-fig-green"
                            }`}
                          >
                            {l.min_qualification_score_pct ? `${Number(l.min_qualification_score_pct).toFixed(0)}%` : "—"}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-fig-text">{l.budgeted_headcount ?? "—"}</td>
                        <td className="py-3 pr-3">
                          <LevelBadge code={l.primary_level_code} />
                        </td>
                        <td className="py-3 pr-3 text-fig-muted">{l.linked_package_count} linked</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </AppShell>
  );
}

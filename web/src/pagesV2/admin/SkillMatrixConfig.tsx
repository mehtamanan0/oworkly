import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
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
  level_count: number;
}

export function SkillMatrixConfig() {
  const { data: primaryLevels } = useQuery({ queryKey: ["primary-levels"], queryFn: () => v2.get<PrimaryLevel[]>("/primary-levels") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Skill Matrix Config" }]}>
      <PageHeader title="Skill Matrix Config" description="Configure skill matrix display, level colour rules, and process visibility" />

      <SectionCard title="Primary Level Display Rules" className="mb-5">
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
              <p className="mb-2 text-[11px] leading-snug" style={{ color: pl.accent_hex ?? "#475569" }}>
                {pl.description}
              </p>
              <div className="space-y-1 text-[10px]" style={{ color: pl.accent_hex ?? "#475569" }}>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border" style={{ backgroundColor: pl.background_hex ?? "#fff" }} /> bg: {pl.background_hex ?? "—"}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: pl.accent_hex ?? "#000" }} /> accent: {pl.accent_hex ?? "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Process Visibility in Skill Matrix" padded={false}>
        {processes?.map((p) => (
          <div key={p.process_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-fig-blue">{p.code}</span>
              <span className="text-sm font-medium text-fig-text">{p.name}</span>
              <span className="text-xs text-fig-muted">{p.level_count} levels</span>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-fig-green">✓ Visible</span>
          </div>
        ))}
      </SectionCard>
    </AppShell>
  );
}

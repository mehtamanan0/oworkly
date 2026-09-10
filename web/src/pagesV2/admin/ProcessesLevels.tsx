import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  linked_template_count: number;
}
interface SubLevel {
  process_sub_level_id: string;
  process_level_id: string;
  code: string;
  name: string;
  description: string | null;
  weight_pct: string;
  min_score_pct: string | null;
  is_mandatory: boolean;
}
interface Criterion {
  process_level_criterion_id: string;
  process_level_id: string;
  category: "KNOWLEDGE" | "PRACTICAL" | "BEHAVIOUR" | "EXPERIENCE";
  text: string;
}
interface LevelsDetail {
  process: { description: string | null } | null;
  levels: Level[];
  subLevels: SubLevel[];
  criteria: Criterion[];
}

const CATEGORIES: Criterion["category"][] = ["KNOWLEDGE", "PRACTICAL", "BEHAVIOUR", "EXPERIENCE"];

export function ProcessesLevels() {
  const { data: primaryLevels } = useQuery({ queryKey: ["primary-levels"], queryFn: () => v2.get<PrimaryLevel[]>("/primary-levels") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const activeProcessId = selected ?? processes?.[0]?.process_id ?? null;
  const activeProcess = processes?.find((p) => p.process_id === activeProcessId);

  const { data: detail } = useQuery({
    queryKey: ["process-levels", activeProcessId],
    queryFn: () => v2.get<LevelsDetail>(`/processes/${activeProcessId}/levels`),
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
              onClick={() => { setSelected(p.process_id); setExpandedLevel(null); }}
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
                      <th className="py-2 pr-3" />
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Name &amp; Description</th>
                      <th className="py-2 pr-3">Min Score</th>
                      <th className="py-2 pr-3">Budget HC</th>
                      <th className="py-2 pr-3">Primary Level</th>
                      <th className="py-2 pr-3">Assessments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail?.levels.map((l) => {
                      const isOpen = expandedLevel === l.process_level_id;
                      const subCount = detail.subLevels.filter((s) => s.process_level_id === l.process_level_id).length;
                      const critCount = detail.criteria.filter((c) => c.process_level_id === l.process_level_id).length;
                      return (
                        <Fragment key={l.process_level_id}>
                          <tr className="border-b border-fig-border last:border-b-0">
                            <td className="py-3 pr-2">
                              <button
                                onClick={() => setExpandedLevel(isOpen ? null : l.process_level_id)}
                                className="text-fig-muted hover:text-fig-blue"
                                aria-label={isOpen ? "Collapse" : "Expand"}
                              >
                                {isOpen ? "▾" : "▸"}
                              </button>
                            </td>
                            <td className="py-3 pr-3">
                              <LevelBadge code={l.code} />
                            </td>
                            <td className="py-3 pr-3">
                              <div className="font-medium text-fig-text">{l.name}</div>
                              <div className="text-xs text-fig-muted">{l.description}</div>
                              <div className="mt-0.5 text-[11px] text-fig-muted">{subCount} sub-levels · {critCount} criteria</div>
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
                            <td className="py-3 pr-3 text-fig-muted">{l.linked_template_count} linked</td>
                          </tr>
                          {isOpen && activeProcessId && (
                            <tr>
                              <td colSpan={7} className="bg-fig-bg/60 px-5 py-4">
                                <LevelConfigPanel
                                  processId={activeProcessId}
                                  levelId={l.process_level_id}
                                  subLevels={detail.subLevels.filter((s) => s.process_level_id === l.process_level_id)}
                                  criteria={detail.criteria.filter((c) => c.process_level_id === l.process_level_id)}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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

function LevelConfigPanel({
  processId,
  levelId,
  subLevels,
  criteria,
}: {
  processId: string;
  levelId: string;
  subLevels: SubLevel[];
  criteria: Criterion[];
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["process-levels", processId] });
  const base = `/processes/${processId}/levels/${levelId}`;

  const weightSum = subLevels.reduce((s, x) => s + Number(x.weight_pct ?? 0), 0);

  const [slForm, setSlForm] = useState({ code: "", name: "", weightPct: "0", minScorePct: "", isMandatory: true });
  const addSubLevel = useMutation({
    mutationFn: () =>
      v2.post(`${base}/sub-levels`, {
        code: slForm.code.trim(),
        name: slForm.name.trim(),
        weightPct: Number(slForm.weightPct) || 0,
        minScorePct: slForm.minScorePct === "" ? null : Number(slForm.minScorePct),
        isMandatory: slForm.isMandatory,
      }),
    onSuccess: () => { setSlForm({ code: "", name: "", weightPct: "0", minScorePct: "", isMandatory: true }); invalidate(); },
  });
  const patchSubLevel = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => v2.patch(`${base}/sub-levels/${v.id}`, v.body),
    onSuccess: invalidate,
  });
  const delSubLevel = useMutation({
    mutationFn: (id: string) => v2.del(`${base}/sub-levels/${id}`),
    onSuccess: invalidate,
  });

  const [critText, setCritText] = useState<Record<string, string>>({});
  const addCriterion = useMutation({
    mutationFn: (v: { category: string; text: string }) => v2.post(`${base}/criteria`, v),
    onSuccess: (_d, v) => { setCritText((t) => ({ ...t, [v.category]: "" })); invalidate(); },
  });
  const delCriterion = useMutation({
    mutationFn: (id: string) => v2.del(`${base}/criteria/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="grid grid-cols-2 gap-5">
      {/* Sub-levels */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-fig-muted">Sub-levels</span>
          <span className={`text-[11px] font-semibold ${weightSum > 100 ? "text-fig-red" : weightSum === 100 ? "text-fig-green" : "text-fig-muted"}`}>
            weight Σ {weightSum.toFixed(0)}%
          </span>
        </div>
        <div className="space-y-1.5">
          {subLevels.length === 0 && <div className="text-xs text-fig-muted">No sub-levels yet.</div>}
          {subLevels.map((s) => (
            <div key={s.process_sub_level_id} className="flex items-center justify-between rounded border border-fig-border bg-white px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fig-text">
                  <span className="font-semibold">{s.code}</span> · {s.name}
                </div>
                <div className="text-[11px] text-fig-muted">
                  weight {Number(s.weight_pct).toFixed(0)}%{s.min_score_pct != null && ` · min ${Number(s.min_score_pct).toFixed(0)}%`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-fig-muted">
                  <input
                    type="checkbox"
                    checked={s.is_mandatory}
                    onChange={(e) => patchSubLevel.mutate({ id: s.process_sub_level_id, body: { isMandatory: e.target.checked } })}
                  />
                  mandatory
                </label>
                <button onClick={() => delSubLevel.mutate(s.process_sub_level_id)} className="text-[11px] font-semibold text-fig-red hover:underline">
                  remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            value={slForm.code}
            onChange={(e) => setSlForm({ ...slForm, code: e.target.value })}
            placeholder="Code"
            className="w-20 rounded border border-fig-border px-2 py-1 text-xs focus:border-fig-blue focus:outline-none"
          />
          <input
            value={slForm.name}
            onChange={(e) => setSlForm({ ...slForm, name: e.target.value })}
            placeholder="Sub-level name"
            className="min-w-0 flex-1 rounded border border-fig-border px-2 py-1 text-xs focus:border-fig-blue focus:outline-none"
          />
          <input
            value={slForm.weightPct}
            onChange={(e) => setSlForm({ ...slForm, weightPct: e.target.value })}
            placeholder="wt%"
            className="w-14 rounded border border-fig-border px-2 py-1 text-xs focus:border-fig-blue focus:outline-none"
          />
          <Button
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={!slForm.code.trim() || !slForm.name.trim() || addSubLevel.isPending}
            onClick={() => addSubLevel.mutate()}
          >
            + Add
          </Button>
        </div>
        {addSubLevel.isError && <div className="mt-1 text-[11px] text-fig-red">{(addSubLevel.error as Error).message}</div>}
      </div>

      {/* Criteria */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fig-muted">Criteria</div>
        <div className="space-y-2.5">
          {CATEGORIES.map((cat) => (
            <div key={cat}>
              <div className="text-[11px] font-semibold text-fig-text">{cat}</div>
              <ul className="mt-0.5 space-y-1">
                {criteria.filter((c) => c.category === cat).map((c) => (
                  <li key={c.process_level_criterion_id} className="flex items-start justify-between gap-2 text-xs text-fig-text">
                    <span>• {c.text}</span>
                    <button onClick={() => delCriterion.mutate(c.process_level_criterion_id)} className="shrink-0 text-[11px] font-semibold text-fig-red hover:underline">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  value={critText[cat] ?? ""}
                  onChange={(e) => setCritText((t) => ({ ...t, [cat]: e.target.value }))}
                  placeholder={`Add ${cat.toLowerCase()} criterion`}
                  className="min-w-0 flex-1 rounded border border-fig-border px-2 py-1 text-xs focus:border-fig-blue focus:outline-none"
                />
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  disabled={!(critText[cat] ?? "").trim() || addCriterion.isPending}
                  onClick={() => addCriterion.mutate({ category: cat, text: (critText[cat] ?? "").trim() })}
                >
                  +
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

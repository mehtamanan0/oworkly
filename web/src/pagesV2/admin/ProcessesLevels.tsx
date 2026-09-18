import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { LevelBadge } from "../../components/figma/Badge";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

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
  is_active: boolean;
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
interface Company {
  company_id: string;
  code: string;
  name: string;
}
interface OrgUnit {
  org_unit_id: string;
  name: string;
  level_type_name: string;
  is_active: boolean;
}

const CATEGORIES: Criterion["category"][] = ["KNOWLEDGE", "PRACTICAL", "BEHAVIOUR", "EXPERIENCE"];

export function ProcessesLevels() {
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const canEdit = user?.roles?.includes("ADMIN") || user?.roles?.includes("LND_TEAM");
  const { data: primaryLevels } = useQuery({ queryKey: ["primary-levels"], queryFn: () => v2.get<PrimaryLevel[]>("/primary-levels") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const [addingProcess, setAddingProcess] = useState(false);
  const [addingLevel, setAddingLevel] = useState(false);
  const activeProcessId = selected ?? processes?.[0]?.process_id ?? null;
  const activeProcess = processes?.find((p) => p.process_id === activeProcessId);
  const invalidateProcesses = () => qc.invalidateQueries({ queryKey: ["processes"] });

  const { data: detail } = useQuery({
    queryKey: ["process-levels", activeProcessId],
    queryFn: () => v2.get<LevelsDetail>(`/processes/${activeProcessId}/levels`),
    enabled: !!activeProcessId,
  });
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["process-levels", activeProcessId] });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Processes & Levels" }]}>
      <PageHeader
        title="Processes & Levels"
        description="Configure processes, competency levels, sub-levels, and primary level mappings"
        action={canEdit ? <Button onClick={() => setAddingProcess(true)}>+ New Process</Button> : <span className="text-xs text-fig-muted">Only Admin / L&amp;D can add processes</span>}
      />

      <SectionCard
        title={<span className="text-xs uppercase tracking-wide text-fig-muted">Primary Levels <span className="normal-case text-fig-text">— global master, used for cross-process reporting and skill matrix</span></span>}
        action={<span className="text-xs text-fig-muted">Primary level configuration is on the roadmap</span>}
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
              action={canEdit ? <Button variant="secondary" onClick={() => setAddingLevel(true)}>+ Add Level</Button> : undefined}
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
                      <th className="py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {detail?.levels.map((l) => {
                      const isOpen = expandedLevel === l.process_level_id;
                      const subCount = detail.subLevels.filter((s) => s.process_level_id === l.process_level_id).length;
                      const critCount = detail.criteria.filter((c) => c.process_level_id === l.process_level_id).length;
                      return (
                        <Fragment key={l.process_level_id}>
                          <tr className={`border-b border-fig-border last:border-b-0 ${!l.is_active ? "opacity-50" : ""}`}>
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
                              <div className="font-medium text-fig-text">
                                {l.name}
                                {!l.is_active && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-fig-red">Archived</span>}
                              </div>
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
                            <td className="py-3 pr-3 text-right">
                              {canEdit && <ArchiveLevelButton levelId={l.process_level_id} isActive={l.is_active} onDone={invalidateDetail} />}
                            </td>
                          </tr>
                          {isOpen && activeProcessId && (
                            <tr>
                              <td colSpan={8} className="bg-fig-bg/60 px-5 py-4">
                                <LevelConfigPanel
                                  processId={activeProcessId}
                                  levelId={l.process_level_id}
                                  subLevels={detail.subLevels.filter((s) => s.process_level_id === l.process_level_id)}
                                  criteria={detail.criteria.filter((c) => c.process_level_id === l.process_level_id)}
                                  otherLevels={detail.levels.filter((ol) => ol.process_level_id !== l.process_level_id)}
                                  canEdit={!!canEdit}
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

      {addingProcess && company && (
        <AddProcessModal
          companyId={company.company_id}
          onClose={() => setAddingProcess(false)}
          onSaved={(id) => { setAddingProcess(false); invalidateProcesses(); setSelected(id); }}
        />
      )}
      {addingLevel && activeProcessId && (
        <AddLevelModal processId={activeProcessId} onClose={() => setAddingLevel(false)} onSaved={() => { setAddingLevel(false); invalidateDetail(); invalidateProcesses(); }} />
      )}
    </AppShell>
  );
}

function AddProcessModal({ companyId, onClose, onSaved }: { companyId: string; onClose: () => void; onSaved: (processId: string) => void }) {
  const { data: hierarchy } = useQuery({ queryKey: ["hierarchy", companyId], queryFn: () => v2.get<{ units: OrgUnit[] }>(`/companies/${companyId}/hierarchy`) });
  const [orgUnitId, setOrgUnitId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () => v2.post<{ process_id: string }>(`/companies/${companyId}/processes`, { orgUnitId, code: code.trim(), name: name.trim() }),
    onSuccess: (row) => onSaved(row.process_id),
  });
  return (
    <Modal open title="New process" onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!orgUnitId || !code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Organisation scope">
        <select className={inputClass} value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
          <option value="">Select a node…</option>
          {hierarchy?.units.map((u) => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name} ({u.level_type_name})</option>)}
        </select>
      </Field>
      <Field label="Code"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="text-xs text-fig-muted">The process is created with two default levels (E1 Entry, E2 Skilled) — rename, recolour, or add more levels right after.</p>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function AddLevelModal({ processId, onClose, onSaved }: { processId: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [minScorePct, setMinScorePct] = useState("70");
  const save = useMutation({
    mutationFn: () => v2.post(`/processes/${processId}/levels`, { code: code.trim(), name: name.trim(), minQualificationScorePct: minScorePct === "" ? undefined : Number(minScorePct) }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title="Add a level" onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Code"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. E3" /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Proficient" /></Field>
      <Field label="Min qualification score %"><input className={inputClass} type="number" value={minScorePct} onChange={(e) => setMinScorePct(e.target.value)} /></Field>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function ArchiveLevelButton({ levelId, isActive, onDone }: { levelId: string; isActive: boolean; onDone: () => void }) {
  const archive = useMutation({
    mutationFn: () => v2.post(`/process-levels/${levelId}/${isActive ? "archive" : "restore"}`),
    onSuccess: onDone,
    onError: (e) => window.alert((e as Error).message),
  });
  return (
    <button
      onClick={(e) => { e.stopPropagation(); archive.mutate(); }}
      disabled={archive.isPending}
      className={`text-[11px] font-semibold hover:underline ${isActive ? "text-fig-red" : "text-fig-blue"}`}
    >
      {isActive ? "Archive" : "Restore"}
    </button>
  );
}

function LevelConfigPanel({
  processId,
  levelId,
  subLevels,
  criteria,
  otherLevels,
  canEdit,
}: {
  processId: string;
  levelId: string;
  subLevels: SubLevel[];
  criteria: Criterion[];
  otherLevels: Level[];
  canEdit: boolean;
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
    <div className="grid grid-cols-3 gap-5">
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
                    disabled={!canEdit}
                    checked={s.is_mandatory}
                    onChange={(e) => patchSubLevel.mutate({ id: s.process_sub_level_id, body: { isMandatory: e.target.checked } })}
                  />
                  mandatory
                </label>
                {canEdit && (
                  <button onClick={() => delSubLevel.mutate(s.process_sub_level_id)} className="text-[11px] font-semibold text-fig-red hover:underline">
                    remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {canEdit && (
          <>
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
          </>
        )}
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
                    {canEdit && (
                      <button onClick={() => delCriterion.mutate(c.process_level_criterion_id)} className="shrink-0 text-[11px] font-semibold text-fig-red hover:underline">
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
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
              )}
            </div>
          ))}
        </div>
      </div>

      <ProgressionRulesPanel levelId={levelId} otherLevels={otherLevels} canEdit={canEdit} />
    </div>
  );
}

const RULE_TYPE_LABEL: Record<string, string> = {
  MIN_TENURE_MONTHS: "Minimum tenure (months)",
  REQUIRED_PRIOR_LEVEL: "Requires a prior level",
  CUSTOM: "Custom (informational only)",
};

interface ProgressionRule {
  process_level_progression_rule_id: string;
  rule_type: string;
  label: string;
  params_json: Record<string, unknown>;
  severity: "BLOCKING" | "ADVISORY";
}

function ProgressionRulesPanel({ levelId, otherLevels, canEdit }: { levelId: string; otherLevels: Level[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["progression-rules", levelId];
  const { data: rules } = useQuery({ queryKey: key, queryFn: () => v2.get<ProgressionRule[]>(`/process-levels/${levelId}/progression-rules`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [ruleType, setRuleType] = useState("MIN_TENURE_MONTHS");
  const [label, setLabel] = useState("");
  const [severity, setSeverity] = useState<"BLOCKING" | "ADVISORY">("BLOCKING");
  const [months, setMonths] = useState("6");
  const [requiredLevelId, setRequiredLevelId] = useState(otherLevels[0]?.process_level_id ?? "");

  const add = useMutation({
    mutationFn: () =>
      v2.post(`/process-levels/${levelId}/progression-rules`, {
        ruleType,
        label: label.trim(),
        severity: ruleType === "CUSTOM" ? "ADVISORY" : severity,
        params:
          ruleType === "MIN_TENURE_MONTHS" ? { months: Number(months) }
          : ruleType === "REQUIRED_PRIOR_LEVEL" ? { requiredProcessLevelId: requiredLevelId }
          : {},
      }),
    onSuccess: () => { setLabel(""); invalidate(); },
  });
  const del = useMutation({ mutationFn: (id: string) => v2.del(`/progression-rules/${id}`), onSuccess: invalidate });
  const toggleSeverity = useMutation({
    mutationFn: (v: { id: string; severity: string }) => v2.patch(`/progression-rules/${v.id}`, { severity: v.severity }),
    onSuccess: invalidate,
  });

  return (
    <div className="col-span-3 border-t border-fig-border pt-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fig-muted">Progression rules — what a worker must meet to reach this level</div>
      <div className="space-y-1.5">
        {(rules ?? []).length === 0 && <div className="text-xs text-fig-muted">No progression rules configured — only the score threshold and mandatory sub-levels gate this level.</div>}
        {rules?.map((r) => (
          <div key={r.process_level_progression_rule_id} className="flex items-center justify-between rounded border border-fig-border bg-white px-2.5 py-1.5 text-xs">
            <div>
              <span className="font-medium text-fig-text">{r.label}</span>
              <span className="ml-2 text-fig-muted">{RULE_TYPE_LABEL[r.rule_type] ?? r.rule_type}{r.rule_type === "MIN_TENURE_MONTHS" && ` · ${r.params_json?.months}mo`}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${r.severity === "BLOCKING" ? "bg-red-50 text-fig-red" : "bg-fig-bg text-fig-muted"}`}>{r.severity}</span>
              {canEdit && r.rule_type !== "CUSTOM" && (
                <button
                  onClick={() => toggleSeverity.mutate({ id: r.process_level_progression_rule_id, severity: r.severity === "BLOCKING" ? "ADVISORY" : "BLOCKING" })}
                  className="text-fig-blue hover:underline"
                >
                  make {r.severity === "BLOCKING" ? "advisory" : "blocking"}
                </button>
              )}
              {canEdit && <button onClick={() => del.mutate(r.process_level_progression_rule_id)} className="font-semibold text-fig-red hover:underline">remove</button>}
            </div>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value)} className="rounded border border-fig-border px-2 py-1 text-xs">
            {Object.entries(RULE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {ruleType === "MIN_TENURE_MONTHS" && (
            <input type="number" value={months} onChange={(e) => setMonths(e.target.value)} className="w-16 rounded border border-fig-border px-2 py-1 text-xs" placeholder="months" />
          )}
          {ruleType === "REQUIRED_PRIOR_LEVEL" && (
            <select value={requiredLevelId} onChange={(e) => setRequiredLevelId(e.target.value)} className="rounded border border-fig-border px-2 py-1 text-xs">
              {otherLevels.length === 0 && <option value="">No other levels on this process</option>}
              {otherLevels.map((l) => <option key={l.process_level_id} value={l.process_level_id}>{l.code} — {l.name}</option>)}
            </select>
          )}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rule label" className="min-w-0 flex-1 rounded border border-fig-border px-2 py-1 text-xs" />
          {ruleType !== "CUSTOM" && (
            <select value={severity} onChange={(e) => setSeverity(e.target.value as "BLOCKING" | "ADVISORY")} className="rounded border border-fig-border px-2 py-1 text-xs">
              <option value="BLOCKING">Blocking</option>
              <option value="ADVISORY">Advisory</option>
            </select>
          )}
          <Button
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={!label.trim() || add.isPending || (ruleType === "REQUIRED_PRIOR_LEVEL" && !requiredLevelId)}
            onClick={() => add.mutate()}
          >
            + Add rule
          </Button>
        </div>
      )}
      {add.isError && <div className="mt-1 text-[11px] text-fig-red">{(add.error as Error).message}</div>}
    </div>
  );
}

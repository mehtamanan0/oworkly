import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
import { v2 } from "../../lib/apiV2";

interface Definition {
  assessment_id: string;
  name: string;
  description: string;
  assessment_type: string;
  add_on_subtype: string | null;
  item_count: number;
  sample_question_type: string | null;
}
interface ProcessRow { process_id: string; code: string; name: string }
interface Level { process_level_id: string; code: string; name: string }
interface PackageComponent {
  assessment_template_assessment_id: string;
  assessment_id: string;
  name: string;
  assessment_type: string;
  weight_pct: string;
  min_gate_pct: string | null;
  is_mandatory: boolean;
  is_critical: boolean;
  auto_fail_on_gate_miss: boolean;
  self_assessment_enabled: boolean;
  item_count: number;
}
interface TemplatePkg {
  assessment_template_id: string;
  is_active: boolean;
  version: number;
  components: PackageComponent[];
}
interface Item {
  question_id: string;
  question_type: string;
  prompt: string;
  options_json: { key: string; text: string }[] | null;
  correct_answer_json: string[] | null;
  max_score: string;
  rating_scale_max: number | null;
  is_mandatory: boolean;
  is_critical: boolean;
  requires_assessor_remark: boolean;
  evaluator_capacity: string;
  is_active: boolean;
  sequence_no: number;
}

const TYPE_TONE: Record<string, string> = { PRACTICAL: "text-fig-blue bg-blue-50", THEORY: "text-fig-blue bg-blue-50", BEHAVIOURAL: "text-fig-purple bg-purple-50" };
const ASSESSMENT_TYPES = ["THEORY", "PRACTICAL", "BEHAVIOURAL", "SELF_ASSESSMENT", "ADD_ON"];
const QUESTION_TYPES = ["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE", "RATING_1_5", "CHECKLIST_PASS_FAIL", "EVIDENCE_OBSERVATION", "FREE_TEXT_REMARK", "VIDEO", "AUDIO", "IMAGE"];
const EVALUATOR_CAPACITIES = ["SELF", "SUPERVISOR_ASSESSOR", "TRAINER", "SYSTEM"];
const MCQ = ["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"];

const QUESTION_TYPE_LABEL: Record<string, string> = {
  RATING_1_5: "Rating", MCQ_SINGLE: "MCQ (single)", MCQ_MULTI: "MCQ (multi)", TRUE_FALSE: "True / False",
  CHECKLIST_PASS_FAIL: "Checklist", EVIDENCE_OBSERVATION: "Observation", FREE_TEXT_REMARK: "Remark",
  VIDEO: "🎬 Video", AUDIO: "🎙 Audio", IMAGE: "📷 Image",
};
const qLabel = (t: string) => QUESTION_TYPE_LABEL[t] ?? t;
const qDescription = (t: string, maxScore: string | number) =>
  t === "RATING_1_5" ? "Rating 1–5 · assessor adds remark per question"
  : ["VIDEO", "AUDIO", "IMAGE"].includes(t) ? `${qLabel(t).replace(/^\S+\s/, "")} capture · assessor-graded, max ${maxScore} marks`
  : `Max ${maxScore} marks`;

export function AssessmentConfig({ tab }: { tab: "library" | "level-links" | "question-bank" }) {
  const navigate = useNavigate();
  const params = useParams();
  const { data: definitions } = useQuery({ queryKey: ["assessments"], queryFn: () => v2.get<Definition[]>("/assessments") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Assessment Configuration" }]}>
      <PageHeader title="Assessment Configuration" description="Manage assessment templates, MCQ question banks, and level links" />
      <div className="mb-5 flex gap-1 border-b border-fig-border text-sm font-medium">
        {([["library", "📖 Assessment Library"], ["level-links", "🔗 Level Assessment Links"], ["question-bank", "☰ Question Bank"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => navigate(`/admin/assessments/${key}`)}
            className={`-mb-px border-b-2 px-3 py-2 ${tab === key ? "border-fig-blue text-fig-blue" : "border-transparent text-fig-muted hover:text-fig-text"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "library" && <LibraryTab definitions={definitions} />}
      {tab === "level-links" && <LevelLinksTab processes={processes} definitions={definitions} />}
      {tab === "question-bank" && <QuestionBankTab definitions={definitions} initialId={params.definitionId} />}
    </AppShell>
  );
}

// ===========================================================================
// Library
// ===========================================================================
function LibraryTab({ definitions }: { definitions?: Definition[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Definition | "new" | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["assessments"] });

  const del = useMutation({ mutationFn: (id: string) => v2.del(`/assessments/${id}`), onSuccess: invalidate });

  return (
    <SectionCard title="Assessment Library" action={<Button onClick={() => setEditing("new")}>+ New Assessment</Button>} padded={false}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
            <th className="px-5 py-2.5">Assessment</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Questions</th><th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {definitions?.map((d) => (
            <tr key={d.assessment_id} className="border-b border-fig-border last:border-b-0">
              <td className="px-5 py-3"><div className="font-medium text-fig-text">{d.name}</div><div className="text-xs text-fig-muted">{d.description}</div></td>
              <td className="px-3 py-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_TONE[d.assessment_type] ?? "bg-fig-bg text-fig-muted"}`}>{d.assessment_type}</span></td>
              <td className="px-3 py-3">
                {d.item_count > 0
                  ? <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-fig-blue">{d.item_count} {d.sample_question_type === "MCQ_SINGLE" ? "MCQ" : "Q"}</span>
                  : <span className="text-xs text-fig-muted">No questions</span>}
              </td>
              <td className="px-3 py-3 text-right">
                <button onClick={() => navigate(`/admin/assessments/question-bank/${d.assessment_id}`)} className="mr-1.5 rounded bg-blue-50 px-2.5 py-1 text-xs font-medium text-fig-blue">Questions</button>
                <button onClick={() => setEditing(d)} className="mr-1.5 rounded bg-fig-bg px-2.5 py-1 text-xs font-medium text-fig-text">Edit</button>
                <button onClick={() => { if (confirm(`Delete "${d.name}"?`)) del.mutate(d.assessment_id); }} className="rounded px-2.5 py-1 text-xs font-medium text-fig-red hover:bg-red-50">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <AssessmentModal value={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
    </SectionCard>
  );
}

function AssessmentModal({ value, onClose, onSaved }: { value: Definition | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(value?.name ?? "");
  const [assessmentType, setAssessmentType] = useState(value?.assessment_type ?? "THEORY");
  const [description, setDescription] = useState(value?.description ?? "");
  const [addOnSubtype, setAddOnSubtype] = useState(value?.add_on_subtype ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { name, assessmentType, description, addOnSubtype: assessmentType === "ADD_ON" ? addOnSubtype : undefined };
      return value ? v2.patch(`/assessments/${value.assessment_id}`, body) : v2.post("/assessments", body);
    },
    onSuccess: onSaved,
  });
  return (
    <Modal open title={value ? "Edit assessment" : "New assessment"} onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!name.trim()} />}>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Type">
        <select className={inputClass} value={assessmentType} onChange={(e) => setAssessmentType(e.target.value)}>
          {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      {assessmentType === "ADD_ON" && <Field label="Add-on subtype"><input className={inputClass} value={addOnSubtype} onChange={(e) => setAddOnSubtype(e.target.value)} /></Field>}
      <Field label="Description"><textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      {save.isError && <div className="text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

// ===========================================================================
// Level ↔ assessment links (template editor)
// ===========================================================================
function LevelLinksTab({ processes, definitions }: { processes?: ProcessRow[]; definitions?: Definition[] }) {
  const qc = useQueryClient();
  const [processId, setProcessId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const activeProcessId = processId ?? processes?.[0]?.process_id ?? null;

  const { data: levelsData } = useQuery({
    queryKey: ["process-levels", activeProcessId],
    queryFn: () => v2.get<{ levels: Level[] }>(`/processes/${activeProcessId}/levels`),
    enabled: !!activeProcessId,
  });
  const activeLevelId = levelId ?? levelsData?.levels[0]?.process_level_id ?? null;
  const pkgKey = ["template", activeProcessId, activeLevelId];
  const { data: pkg } = useQuery({
    queryKey: pkgKey,
    queryFn: () => v2.get<TemplatePkg | null>(`/processes/${activeProcessId}/levels/${activeLevelId}/template`),
    enabled: !!activeProcessId && !!activeLevelId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: pkgKey });

  const nonSelfWeight = pkg?.components.filter((c) => !c.self_assessment_enabled).reduce((s, c) => s + Number(c.weight_pct), 0) ?? 0;

  const createTpl = useMutation({ mutationFn: () => v2.post("/assessment-templates", { processLevelId: activeLevelId }), onSuccess: invalidate });
  const activate = useMutation({ mutationFn: () => v2.post(`/assessment-templates/${pkg!.assessment_template_id}/activate`), onSuccess: invalidate });
  const patchLink = useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => v2.patch(`/assessment-template-assessments/${v.id}`, v.body), onSuccess: invalidate });
  const removeLink = useMutation({ mutationFn: (id: string) => v2.del(`/assessment-template-assessments/${id}`), onSuccess: invalidate });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div>
          <label className="mb-1 block text-xs font-medium text-fig-muted">Process</label>
          <select className={inputClass} value={activeProcessId ?? ""} onChange={(e) => { setProcessId(e.target.value); setLevelId(null); }}>
            {processes?.map((p) => <option key={p.process_id} value={p.process_id}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fig-muted">Level</label>
          <select className={inputClass} value={activeLevelId ?? ""} onChange={(e) => setLevelId(e.target.value)}>
            {levelsData?.levels.map((l) => <option key={l.process_level_id} value={l.process_level_id}>{l.code} — {l.name}</option>)}
          </select>
        </div>
        {pkg && <Button variant="secondary" className="ml-auto" onClick={() => setLinking(true)}>+ Link Assessment</Button>}
      </div>

      {!pkg && (
        <SectionCard>
          <div className="py-6 text-center text-sm text-fig-muted">
            No assessment template for this level yet.
            <div className="mt-3"><Button onClick={() => createTpl.mutate()} disabled={createTpl.isPending}>Create draft template</Button></div>
          </div>
        </SectionCard>
      )}

      {pkg && (
        <>
          <div className={`mb-4 flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-medium ${nonSelfWeight === 100 ? "bg-green-50 text-fig-green" : "bg-orange-50 text-fig-orange"}`}>
            <span>{nonSelfWeight === 100 ? "✓" : "⚠"} Weightage {nonSelfWeight === 100 ? "correctly sums to 100%" : `sums to ${nonSelfWeight}% (non-self must total 100%)`}</span>
            <span className="flex items-center gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 font-semibold ${pkg.is_active ? "bg-green-100 text-fig-green" : "bg-fig-bg text-fig-muted"}`}>{pkg.is_active ? `active · v${pkg.version}` : `draft · v${pkg.version}`}</span>
              {!pkg.is_active && <Button className="px-2.5 py-1 text-xs" disabled={nonSelfWeight !== 100 || activate.isPending} onClick={() => activate.mutate()}>Activate</Button>}
            </span>
          </div>
          {activate.isError && <div className="mb-3 text-xs text-fig-red">{(activate.error as Error).message}</div>}

          <SectionCard padded={false}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                  <th className="px-5 py-2.5">Assessment</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Weight %</th><th className="px-3 py-2.5">Min gate %</th>
                  <th className="px-3 py-2.5">Mand.</th><th className="px-3 py-2.5">Critical</th><th className="px-3 py-2.5">Self</th><th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pkg.components.map((c) => (
                  <tr key={c.assessment_template_assessment_id} className="border-b border-fig-border last:border-b-0">
                    <td className="px-5 py-3"><div className="font-medium text-fig-text">{c.name}</div><div className="text-xs text-fig-muted">{c.item_count} questions</div></td>
                    <td className="px-3 py-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_TONE[c.assessment_type] ?? "bg-fig-bg text-fig-muted"}`}>{c.assessment_type}</span></td>
                    <td className="px-3 py-3">
                      <input type="number" min={0} max={100} defaultValue={Number(c.weight_pct)} disabled={pkg.is_active}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(c.weight_pct)) patchLink.mutate({ id: c.assessment_template_assessment_id, body: { weightPct: v } }); }}
                        className="w-16 rounded border border-fig-border px-2 py-1 text-sm disabled:bg-fig-bg" />
                    </td>
                    <td className="px-3 py-3">
                      <input type="number" min={0} max={100} defaultValue={c.min_gate_pct ? Number(c.min_gate_pct) : ""} disabled={pkg.is_active}
                        onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); patchLink.mutate({ id: c.assessment_template_assessment_id, body: { minGatePct: v } }); }}
                        className="w-16 rounded border border-fig-border px-2 py-1 text-sm disabled:bg-fig-bg" />
                    </td>
                    <LinkToggle checked={c.is_mandatory} disabled={pkg.is_active} onChange={(v) => patchLink.mutate({ id: c.assessment_template_assessment_id, body: { isMandatory: v } })} />
                    <LinkToggle checked={c.is_critical} disabled={pkg.is_active} onChange={(v) => patchLink.mutate({ id: c.assessment_template_assessment_id, body: { isCritical: v } })} />
                    <LinkToggle checked={c.self_assessment_enabled} disabled={pkg.is_active} onChange={(v) => patchLink.mutate({ id: c.assessment_template_assessment_id, body: { selfAssessmentEnabled: v } })} />
                    <td className="px-3 py-3 text-right">
                      {!pkg.is_active && <button onClick={() => removeLink.mutate(c.assessment_template_assessment_id)} className="text-xs font-medium text-fig-red hover:underline">remove</button>}
                    </td>
                  </tr>
                ))}
                {pkg.components.length === 0 && <tr><td colSpan={8} className="px-5 py-4 text-sm text-fig-muted">No assessments linked yet.</td></tr>}
              </tbody>
            </table>
          </SectionCard>
          {removeLink.isError && <div className="mt-2 text-xs text-fig-red">{(removeLink.error as Error).message}</div>}
        </>
      )}

      {linking && pkg && (
        <LinkAssessmentModal
          templateId={pkg.assessment_template_id}
          options={(definitions ?? []).filter((d) => !pkg.components.some((c) => c.assessment_id === d.assessment_id))}
          onClose={() => setLinking(false)}
          onSaved={() => { setLinking(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function LinkToggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <td className="px-3 py-3">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </td>
  );
}

function LinkAssessmentModal({ templateId, options, onClose, onSaved }: { templateId: string; options: Definition[]; onClose: () => void; onSaved: () => void }) {
  const [assessmentId, setAssessmentId] = useState(options[0]?.assessment_id ?? "");
  const [weightPct, setWeightPct] = useState("0");
  const [minGatePct, setMinGatePct] = useState("");
  const [isMandatory, setIsMandatory] = useState(true);
  const [isCritical, setIsCritical] = useState(false);
  const [autoFailOnGateMiss, setAutoFail] = useState(true);
  const [selfAssessmentEnabled, setSelf] = useState(false);
  const save = useMutation({
    mutationFn: () => v2.post(`/assessment-templates/${templateId}/assessments`, {
      assessmentId, weightPct: Number(weightPct) || 0, minGatePct: minGatePct === "" ? null : Number(minGatePct),
      isMandatory, isCritical, autoFailOnGateMiss, selfAssessmentEnabled,
    }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title="Link an assessment" onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!assessmentId} />}>
      {options.length === 0 && <div className="text-sm text-fig-muted">Every assessment in the library is already linked.</div>}
      {options.length > 0 && <>
        <Field label="Assessment"><select className={inputClass} value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>{options.map((d) => <option key={d.assessment_id} value={d.assessment_id}>{d.name} ({d.assessment_type})</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weight %"><input className={inputClass} type="number" value={weightPct} onChange={(e) => setWeightPct(e.target.value)} /></Field>
          <Field label="Min gate % (optional)"><input className={inputClass} type="number" value={minGatePct} onChange={(e) => setMinGatePct(e.target.value)} /></Field>
        </div>
        <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} /> Mandatory</label>
        <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="checkbox" checked={isCritical} onChange={(e) => setIsCritical(e.target.checked)} /> Critical (a gate miss fails the qualification)</label>
        <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoFailOnGateMiss} onChange={(e) => setAutoFail(e.target.checked)} /> Auto-fail on gate miss</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selfAssessmentEnabled} onChange={(e) => setSelf(e.target.checked)} /> Self-assessment component</label>
      </>}
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

// ===========================================================================
// Question bank
// ===========================================================================
function QuestionBankTab({ definitions, initialId }: { definitions?: Definition[]; initialId?: string }) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const activeId = selectedId ?? definitions?.[0]?.assessment_id;
  const activeDef = definitions?.find((d) => d.assessment_id === activeId);
  const key = ["definition-items", activeId];

  const { data: allItems } = useQuery({ queryKey: key, queryFn: () => v2.get<Item[]>(`/assessments/${activeId}/items`), enabled: !!activeId });
  const items = (allItems ?? []).filter((i) => i.is_active);
  const invalidate = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["assessments"] }); };

  const del = useMutation({ mutationFn: (id: string) => v2.del(`/questions/${id}`), onSuccess: invalidate });
  const reorder = useMutation({ mutationFn: (orderedIds: string[]) => v2.patch(`/assessments/${activeId}/questions/reorder`, { orderedIds }), onSuccess: invalidate });

  function move(idx: number, dir: -1 | 1) {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    reorder.mutate(next.map((i) => i.question_id));
  }

  return (
    <div>
      <div className="mb-4 flex items-end gap-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-fig-muted">Assessment</label>
          <select className={inputClass} value={activeId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {definitions?.map((d) => <option key={d.assessment_id} value={d.assessment_id}>{d.name} ({d.assessment_type})</option>)}
          </select>
        </div>
        <Button onClick={() => setEditing("new")} disabled={!activeId}>+ Add Question</Button>
      </div>

      {activeDef && (
        <SectionCard
          title={<span>📖 {activeDef.name} <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-fig-blue">{activeDef.assessment_type}</span></span>}
          action={<span className="text-xs text-fig-muted">{items.length} questions · max {items.reduce((s, it) => s + Number(it.max_score), 0)} marks</span>}
          padded={false}
        >
          {items.map((it, i) => (
            <div key={it.question_id} className="flex items-start gap-3 border-b border-fig-border px-5 py-3.5 last:border-b-0">
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-xs text-fig-muted disabled:opacity-30">▲</button>
                <span className="text-[10px] font-semibold text-fig-muted">{i + 1}</span>
                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-xs text-fig-muted disabled:opacity-30">▼</button>
              </div>
              <div className="flex-1">
                <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-blue">{qLabel(it.question_type)}</span>
                {it.is_critical && <span className="mr-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-red">critical</span>}
                <span className="text-sm font-medium text-fig-text">{it.prompt}</span>
                <div className="mt-0.5 text-xs text-fig-muted">{qDescription(it.question_type, it.max_score)}</div>
              </div>
              <div className="shrink-0 space-x-1.5">
                <button onClick={() => setEditing(it)} className="rounded bg-fig-bg px-2.5 py-1 text-xs font-medium text-fig-text">Edit</button>
                <button onClick={() => { if (confirm("Delete this question?")) del.mutate(it.question_id); }} className="rounded px-2.5 py-1 text-xs font-medium text-fig-red hover:bg-red-50">Delete</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="px-5 py-4 text-sm text-fig-muted">No questions yet.</div>}
        </SectionCard>
      )}

      {editing && activeId && (
        <QuestionModal assessmentId={activeId} value={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />
      )}
    </div>
  );
}

function QuestionModal({ assessmentId, value, onClose, onSaved }: { assessmentId: string; value: Item | null; onClose: () => void; onSaved: () => void }) {
  const [questionType, setQuestionType] = useState(value?.question_type ?? "RATING_1_5");
  const [prompt, setPrompt] = useState(value?.prompt ?? "");
  const [maxScore, setMaxScore] = useState(String(value?.max_score ?? (value?.question_type === "RATING_1_5" ? 5 : 1)));
  const [optionsText, setOptionsText] = useState((value?.options_json ?? []).map((o) => `${o.key}|${o.text}`).join("\n"));
  const [correctText, setCorrectText] = useState((value?.correct_answer_json ?? []).join(","));
  const [isMandatory, setIsMandatory] = useState(value?.is_mandatory ?? true);
  const [isCritical, setIsCritical] = useState(value?.is_critical ?? false);
  const [requiresRemark, setRequiresRemark] = useState(value?.requires_assessor_remark ?? false);
  const [evaluatorCapacity, setEvaluatorCapacity] = useState(value?.evaluator_capacity ?? "SUPERVISOR_ASSESSOR");
  const isMcq = MCQ.includes(questionType);

  const save = useMutation({
    mutationFn: () => {
      const optionsJson = optionsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [key, ...rest] = l.split("|"); return { key: key.trim(), text: rest.join("|").trim() }; });
      const correctAnswerJson = correctText.split(",").map((s) => s.trim()).filter(Boolean);
      const body: Record<string, unknown> = {
        questionType, prompt, maxScore: Number(maxScore), isMandatory, isCritical, requiresAssessorRemark: requiresRemark, evaluatorCapacity,
        ...(isMcq ? { correctAnswerJson, optionsJson: questionType === "TRUE_FALSE" ? undefined : optionsJson } : {}),
      };
      return value ? v2.patch(`/questions/${value.question_id}`, body) : v2.post(`/assessments/${assessmentId}/questions`, body);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal open wide title={value ? "Edit question" : "Add question"} onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!prompt.trim()} />}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select className={inputClass} value={questionType} onChange={(e) => setQuestionType(e.target.value)}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{qLabel(t)}</option>)}</select></Field>
        <Field label="Max score"><input className={inputClass} type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></Field>
      </div>
      <Field label="Prompt"><textarea className={inputClass} rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
      {isMcq && questionType !== "TRUE_FALSE" && (
        <Field label="Options — one per line as  KEY|text"><textarea className={inputClass} rows={4} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={"A|First option\nB|Second option"} /></Field>
      )}
      {isMcq && <Field label={questionType === "MCQ_MULTI" ? "Correct keys (comma-separated)" : "Correct key"}><input className={inputClass} value={correctText} onChange={(e) => setCorrectText(e.target.value)} placeholder={questionType === "TRUE_FALSE" ? "true" : "A"} /></Field>}
      <Field label="Evaluator capacity"><select className={inputClass} value={evaluatorCapacity} onChange={(e) => setEvaluatorCapacity(e.target.value)}>{EVALUATOR_CAPACITIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      <div className="mt-1 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} /> Mandatory</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={isCritical} onChange={(e) => setIsCritical(e.target.checked)} /> Critical</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={requiresRemark} onChange={(e) => setRequiresRemark(e.target.checked)} /> Requires remark</label>
      </div>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

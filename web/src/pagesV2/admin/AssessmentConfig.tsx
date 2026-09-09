import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { v2 } from "../../lib/apiV2";

interface Definition {
  assessment_definition_id: string;
  name: string;
  description: string;
  component_type: string;
  item_count: number;
  sample_item_type: string | null;
}
interface ProcessRow {
  process_id: string;
  code: string;
  name: string;
}
interface Level {
  process_level_id: string;
  code: string;
  name: string;
}
interface PackageComponent {
  assessment_package_component_id: string;
  name: string;
  component_type: string;
  weight_pct: string;
  min_gate_pct: string | null;
  self_assessment_enabled: boolean;
  item_count: number;
}
interface Item {
  assessment_item_id: string;
  item_type: string;
  prompt: string;
  max_score: string;
  rating_scale_max: number | null;
  sequence_no: number;
}

const TYPE_TONE: Record<string, string> = { PRACTICAL: "text-fig-blue bg-blue-50", THEORY: "text-fig-blue bg-blue-50", BEHAVIOURAL: "text-fig-purple bg-purple-50" };

export function AssessmentConfig({ tab }: { tab: "library" | "level-links" | "question-bank" }) {
  const navigate = useNavigate();
  const params = useParams();

  const { data: definitions } = useQuery({ queryKey: ["assessment-definitions"], queryFn: () => v2.get<Definition[]>("/assessment-definitions") });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessRow[]>("/processes") });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Assessment Configuration" }]}>
      <PageHeader title="Assessment Configuration" description="Manage assessment templates, MCQ question banks, and level links" />

      <div className="mb-5 flex gap-1 border-b border-fig-border text-sm font-medium">
        {(
          [
            ["library", "📖 Assessment Library"],
            ["level-links", "🔗 Level Assessment Links"],
            ["question-bank", "☰ Question Bank"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => navigate(`/admin/assessments/${key}`)}
            className={`-mb-px border-b-2 px-3 py-2 ${tab === key ? "border-fig-blue text-fig-blue" : "border-transparent text-fig-muted hover:text-fig-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "library" && <LibraryTab definitions={definitions} />}
      {tab === "level-links" && <LevelLinksTab processes={processes} />}
      {tab === "question-bank" && <QuestionBankTab definitions={definitions} initialId={params.definitionId} />}
    </AppShell>
  );
}

function LibraryTab({ definitions }: { definitions?: Definition[] }) {
  const navigate = useNavigate();
  return (
    <SectionCard action={<Button disabled>+ New Assessment</Button>} padded={false}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
            <th className="px-5 py-2.5">Assessment</th>
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">Questions</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {definitions?.map((d) => (
            <tr key={d.assessment_definition_id} className="border-b border-fig-border last:border-b-0">
              <td className="px-5 py-3">
                <div className="font-medium text-fig-text">{d.name}</div>
                <div className="text-xs text-fig-muted">{d.description}</div>
              </td>
              <td className="px-3 py-3">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_TONE[d.component_type] ?? "bg-fig-bg text-fig-muted"}`}>{d.component_type}</span>
              </td>
              <td className="px-3 py-3">
                {d.item_count > 0 ? (
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-fig-blue">
                    {d.item_count} {d.sample_item_type === "MCQ_SINGLE" ? "MCQ" : "Rating"}
                  </span>
                ) : (
                  <span className="text-xs text-fig-muted">No questions</span>
                )}
              </td>
              <td className="px-3 py-3 text-right">
                <button onClick={() => navigate(`/admin/assessments/question-bank/${d.assessment_definition_id}`)} className="rounded bg-blue-50 px-2.5 py-1 text-xs font-medium text-fig-blue">
                  Questions
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

function LevelLinksTab({ processes }: { processes?: ProcessRow[] }) {
  const [processId, setProcessId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
  const activeProcessId = processId ?? processes?.[0]?.process_id ?? null;

  const { data: levelsData } = useQuery({
    queryKey: ["process-levels", activeProcessId],
    queryFn: () => v2.get<{ levels: Level[] }>(`/processes/${activeProcessId}/levels`),
    enabled: !!activeProcessId,
  });
  const activeLevelId = levelId ?? levelsData?.levels[0]?.process_level_id ?? null;

  const { data: pkg } = useQuery({
    queryKey: ["package", activeProcessId, activeLevelId],
    queryFn: () => v2.get<{ components: PackageComponent[] } | null>(`/processes/${activeProcessId}/levels/${activeLevelId}/package`),
    enabled: !!activeProcessId && !!activeLevelId,
  });

  const totalWeight = pkg?.components.reduce((s, c) => s + Number(c.weight_pct), 0) ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-end gap-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div>
          <label className="mb-1 block text-xs font-medium text-fig-muted">Process</label>
          <select
            className="rounded-lg border border-fig-border px-3 py-2 text-sm"
            value={activeProcessId ?? ""}
            onChange={(e) => {
              setProcessId(e.target.value);
              setLevelId(null);
            }}
          >
            {processes?.map((p) => (
              <option key={p.process_id} value={p.process_id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fig-muted">Level</label>
          <select className="rounded-lg border border-fig-border px-3 py-2 text-sm" value={activeLevelId ?? ""} onChange={(e) => setLevelId(e.target.value)}>
            {levelsData?.levels.map((l) => (
              <option key={l.process_level_id} value={l.process_level_id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" className="ml-auto" disabled>
          + Link Assessment
        </Button>
      </div>

      {pkg && (
        <>
          <div className={`mb-4 flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-medium ${totalWeight === 100 ? "bg-green-50 text-fig-green" : "bg-orange-50 text-fig-orange"}`}>
            <span>
              {totalWeight === 100 ? "✓" : "⚠"} Weightage {totalWeight === 100 ? "correctly sums to 100%" : `sums to ${totalWeight}% (must total 100%)`}
            </span>
            <span className="text-xs">{pkg.components.length} linked</span>
          </div>

          <SectionCard padded={false}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                  <th className="px-5 py-2.5">Assessment</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Weightage</th>
                  <th className="px-3 py-2.5">Min %</th>
                  <th className="px-3 py-2.5">Self-Assess</th>
                </tr>
              </thead>
              <tbody>
                {pkg.components.map((c) => (
                  <tr key={c.assessment_package_component_id} className="border-b border-fig-border last:border-b-0">
                    <td className="px-5 py-3">
                      <div className="font-medium text-fig-text">{c.name}</div>
                      <div className="text-xs text-fig-muted">{c.item_count} questions</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_TONE[c.component_type] ?? "bg-fig-bg text-fig-muted"}`}>{c.component_type}</span>
                    </td>
                    <td className="px-3 py-3 font-bold text-fig-text">{Number(c.weight_pct).toFixed(0)}%</td>
                    <td className="px-3 py-3 text-fig-text">{c.min_gate_pct ? `${Number(c.min_gate_pct).toFixed(0)}%` : "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block h-5 w-9 rounded-full ${c.self_assessment_enabled ? "bg-fig-blue" : "bg-fig-border"}`}>
                        <span className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${c.self_assessment_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function QuestionBankTab({ definitions, initialId }: { definitions?: Definition[]; initialId?: string }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const activeId = selectedId ?? definitions?.[0]?.assessment_definition_id;
  const activeDef = definitions?.find((d) => d.assessment_definition_id === activeId);

  const { data: items } = useQuery({
    queryKey: ["definition-items", activeId],
    queryFn: () => v2.get<Item[]>(`/assessment-definitions/${activeId}/items`),
    enabled: !!activeId,
  });

  return (
    <div>
      <div className="mb-4 flex items-end gap-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-fig-muted">Assessment</label>
          <select className="w-full rounded-lg border border-fig-border px-3 py-2 text-sm" value={activeId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {definitions?.map((d) => (
              <option key={d.assessment_definition_id} value={d.assessment_definition_id}>
                {d.name} ({d.component_type})
              </option>
            ))}
          </select>
        </div>
        <Button disabled>+ Add Question</Button>
      </div>

      {activeDef && (
        <SectionCard
          title={
            <span>
              📖 {activeDef.name} <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-fig-blue">{activeDef.component_type}</span>
            </span>
          }
          action={<span className="text-xs text-fig-muted">{items?.length ?? 0} {activeDef.sample_item_type === "MCQ_SINGLE" ? "MCQ" : "Rating"} (max {items?.reduce((s, it) => s + Number(it.max_score), 0)} marks)</span>}
          padded={false}
        >
          {items?.map((it, i) => (
            <div key={it.assessment_item_id} className="flex items-start gap-3 border-b border-fig-border px-5 py-3.5 last:border-b-0">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fig-bg text-xs font-semibold text-fig-muted">{i + 1}</span>
              <div className="flex-1">
                <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-blue">{it.item_type === "RATING_1_5" ? "Rating" : it.item_type}</span>
                <span className="text-sm font-medium text-fig-text">{it.prompt}</span>
                <div className="mt-0.5 text-xs text-fig-muted">
                  {it.item_type === "RATING_1_5" ? "Rating 1–5 · assessor adds remark per question" : `Max ${it.max_score} marks`}
                </div>
              </div>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}

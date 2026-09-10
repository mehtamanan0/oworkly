import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { ProgressRail } from "../../components/figma/ProgressRail";
import { RatingRow, RatingGridHeader } from "../../components/figma/RatingGrid";
import { Button } from "../../components/figma/Button";
import { MediaCapture } from "../../components/figma/MediaCapture";
import { qual, v2, idempotencyKey, type MediaKind } from "../../lib/apiV2";

const MEDIA_KIND: Record<string, MediaKind> = { IMAGE: "image", VIDEO: "video", AUDIO: "audio" };

interface ComponentAttempt {
  assessment_attempt_section_id: string;
  assessment_id: string;
  name: string;
  assessment_type: string;
  weight_pct: string;
  min_gate_pct: string | null;
  self_assessment_enabled: boolean;
  status: string;
}
interface AttemptDetail {
  qualification_case_id: string;
  worker_id: string;
  process_id: string;
  target_process_level_id: string;
  componentAttempts: ComponentAttempt[];
}
interface SubLevel {
  process_sub_level_id: string;
  code: string;
  name: string;
  is_mandatory: boolean;
}
interface SubLevelProgress {
  process_sub_level_id: string;
  status: string;
}
interface Item {
  question_id: string;
  question_type: string;
  prompt: string;
  options_json: { key: string; text: string }[] | null;
  max_score: string;
  is_critical: boolean;
}

export function Evaluate() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [componentIndex, setComponentIndex] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [evidenceIds, setEvidenceIds] = useState<Record<string, string | null>>({});
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: attempt } = useQuery({ queryKey: ["attempt-detail", attemptId], queryFn: () => qual.get<AttemptDetail>(`/assessment-attempts/${attemptId}`) });
  const mandatorySteps = attempt?.componentAttempts.filter((c) => !c.self_assessment_enabled) ?? [];
  const current = mandatorySteps[componentIndex];

  const { data: items } = useQuery({
    queryKey: ["items", current?.assessment_attempt_section_id],
    queryFn: () => qual.get<Item[]>(`/assessment-attempt-sections/${current!.assessment_attempt_section_id}/items`),
    enabled: !!current,
  });

  const { data: subLevels } = useQuery({
    queryKey: ["sub-levels", attempt?.process_id, attempt?.target_process_level_id],
    queryFn: () => v2.get<SubLevel[]>(`/processes/${attempt!.process_id}/levels/${attempt!.target_process_level_id}/sub-levels`),
    enabled: !!attempt?.process_id && !!attempt?.target_process_level_id,
  });
  const { data: subLevelProgress } = useQuery({
    queryKey: ["sub-level-progress", attempt?.worker_id],
    queryFn: () => v2.get<SubLevelProgress[]>(`/workers/${attempt!.worker_id}/sub-level-progress`),
    enabled: !!attempt?.worker_id,
  });

  const mandatorySubLevels = (subLevels ?? []).filter((s) => s.is_mandatory);
  const progressById = new Map((subLevelProgress ?? []).map((p) => [p.process_sub_level_id, p.status]));
  const subLevelsReady = mandatorySubLevels.every((s) => progressById.get(s.process_sub_level_id) === "completed");

  const markSubLevel = useMutation({
    mutationFn: (subLevelId: string) =>
      v2.post(`/workers/${attempt!.worker_id}/sub-levels/${subLevelId}/progress`, { status: "completed" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sub-level-progress", attempt?.worker_id] }),
  });

  const submitComponent = useMutation({
    mutationFn: () => {
      const responses = (items ?? []).map((it) => ({
        questionId: it.question_id,
        score: scores[it.question_id] ?? 0,
        assessorRemark: remarks || undefined,
        evidenceFileId: evidenceIds[it.question_id] ?? undefined,
      }));
      return qual.post(`/assessment-attempt-sections/${current!.assessment_attempt_section_id}/score`, { responses }, idempotencyKey("ui-score"));
    },
    onMutate: () => setSubmitting(true),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["attempt-detail", attemptId] });
      if (componentIndex + 1 < mandatorySteps.length) {
        setComponentIndex(componentIndex + 1);
        setScores({});
        setEvidenceIds({});
        setRemarks("");
      } else {
        const result = await qual.post<{ result: string; qualificationResultId?: string }>(`/assessment-attempts/${attemptId}/finalize`, {}, idempotencyKey("ui-finalize"));
        navigate(`/qualifications/${attempt!.qualification_case_id}/result`, { state: { result } });
      }
    },
    onSettled: () => setSubmitting(false),
  });

  if (!attempt || !current || !items) {
    return (
      <AppShell breadcrumbs={[{ label: "Assessments" }, { label: "Evaluate" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading assessment…</div>
      </AppShell>
    );
  }

  const mediaKind = MEDIA_KIND[items[0]?.question_type];
  const isRating = items[0]?.question_type === "RATING_1_5";
  const isMedia = !!mediaKind;
  const allAnswered =
    items.length > 0 &&
    items.every((it) => scores[it.question_id] !== undefined && (!MEDIA_KIND[it.question_type] || evidenceIds[it.question_id]));

  return (
    <AppShell breadcrumbs={[{ label: "Assessments" }, { label: "Evaluate" }]}>
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wide text-fig-blue">
            {current.assessment_type} Assessment · Weight: {current.weight_pct}%
          </span>
          <span className="text-fig-muted">Date {new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</span>
        </div>
        <h1 className="mt-1 text-xl font-bold text-fig-text">{current.name}</h1>
      </div>

      <ProgressRail steps={mandatorySteps.map((s) => s.name)} currentIndex={componentIndex} />

      {mandatorySubLevels.length > 0 && (
        <div className={`my-4 rounded-fig-card border p-3 text-xs ${subLevelsReady ? "border-fig-green/40 bg-green-50" : "border-fig-orange/40 bg-orange-50"}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-fig-text">Sub-level readiness</span>
            <span className={subLevelsReady ? "font-semibold text-fig-green" : "font-semibold text-fig-orange"}>
              {mandatorySubLevels.filter((s) => progressById.get(s.process_sub_level_id) === "completed").length}/{mandatorySubLevels.length} complete
            </span>
          </div>
          <div className="space-y-1.5">
            {mandatorySubLevels.map((s) => {
              const done = progressById.get(s.process_sub_level_id) === "completed";
              return (
                <div key={s.process_sub_level_id} className="flex items-center justify-between">
                  <span className={done ? "text-fig-text" : "text-fig-muted"}>
                    {done ? "✓ " : "○ "}
                    <span className="font-medium">{s.code}</span> · {s.name}
                  </span>
                  {!done && (
                    <button
                      onClick={() => markSubLevel.mutate(s.process_sub_level_id)}
                      disabled={markSubLevel.isPending}
                      className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-fig-blue ring-1 ring-fig-border hover:bg-fig-bg"
                    >
                      Mark complete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!subLevelsReady && <div className="mt-2 text-fig-orange">All mandatory sub-levels must be signed off before the result can be finalized.</div>}
        </div>
      )}

      <div className="my-4 rounded-fig-card border border-blue-200 bg-blue-50 p-3 text-xs text-fig-text">
        <div className="flex flex-wrap gap-x-8 gap-y-1">
          <span>
            <span className="font-semibold text-fig-blue">Assessment</span> {current.name}
          </span>
          {current.min_gate_pct && (
            <span>
              <span className="font-semibold text-fig-blue">Gating Threshold</span> Must score ≥ {current.min_gate_pct}%
            </span>
          )}
          <span>
            <span className="font-semibold text-fig-blue">Questions</span> {items.length} · Max {items.reduce((s, it) => s + Number(it.max_score), 0)} marks
          </span>
        </div>
      </div>

      <div className="rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
        {isRating ? (
          <>
            <RatingGridHeader />
            {items.map((it) => (
              <RatingRow
                key={it.question_id}
                title={it.prompt.split(" — ")[0]}
                description={it.prompt.includes(" — ") ? it.prompt.split(" — ").slice(1).join(" — ") : undefined}
                value={scores[it.question_id] ?? null}
                onChange={(v) => setScores((s) => ({ ...s, [it.question_id]: v }))}
              />
            ))}
          </>
        ) : isMedia ? (
          <div className="space-y-5">
            {items.map((it) => (
              <div key={it.question_id} className="border-b border-fig-border pb-4 last:border-b-0 last:pb-0">
                <div className="mb-2 text-sm font-medium text-fig-text">
                  {it.prompt}
                  {it.is_critical && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-fig-red">CRITICAL</span>}
                </div>
                <MediaCapture
                  kind={MEDIA_KIND[it.question_type]}
                  value={evidenceIds[it.question_id] ?? null}
                  onChange={(id) => setEvidenceIds((e) => ({ ...e, [it.question_id]: id }))}
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-fig-muted">
                  Score
                  <input
                    type="number"
                    min={0}
                    max={Number(it.max_score)}
                    step={0.5}
                    value={scores[it.question_id] ?? ""}
                    onChange={(e) => setScores((s) => ({ ...s, [it.question_id]: Number(e.target.value) }))}
                    className="w-20 rounded border border-fig-border px-2 py-1 text-sm text-fig-text focus:border-fig-blue focus:outline-none"
                  />
                  <span>/ {Number(it.max_score)}</span>
                </label>
              </div>
            ))}
          </div>
        ) : (
          // The formal Supervisor/Trainer-run components in this vertical
          // slice are all RATING_1_5 (matching every seeded assessment
          // definition) — an MCQ or other objectively-graded item type here
          // would need per-item server grading via check-item, the same as
          // the worker self-assessment quiz uses, not a fake local score.
          // Left as an honest placeholder rather than a working-looking but
          // wrong scoring path.
          <div className="rounded-lg border border-dashed border-fig-border p-6 text-center text-sm text-fig-muted">
            This item type ({items[0]?.question_type}) isn't evaluatable from this screen yet.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <label className="mb-1 block text-sm font-semibold text-fig-text">Assessor Remarks</label>
        <textarea
          className="w-full resize-none rounded-lg border border-fig-border p-2.5 text-sm focus:border-fig-blue focus:outline-none"
          rows={3}
          placeholder="Observations, strengths, areas for improvement…"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-sm text-fig-muted hover:text-fig-blue">
          ← Back
        </button>
        <Button
          disabled={!allAnswered || submitting || (componentIndex + 1 >= mandatorySteps.length && !subLevelsReady)}
          onClick={() => submitComponent.mutate()}
        >
          {submitting ? "Submitting…" : componentIndex + 1 < mandatorySteps.length ? "Next: " + mandatorySteps[componentIndex + 1].name + " →" : "Submit & See Result →"}
        </Button>
      </div>
    </AppShell>
  );
}

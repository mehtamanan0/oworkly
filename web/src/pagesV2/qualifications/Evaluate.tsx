import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { ProgressRail } from "../../components/figma/ProgressRail";
import { RatingRow, RatingGridHeader } from "../../components/figma/RatingGrid";
import { Button } from "../../components/figma/Button";
import { qual, idempotencyKey } from "../../lib/apiV2";

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
  componentAttempts: ComponentAttempt[];
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

  const submitComponent = useMutation({
    mutationFn: () => {
      const responses = (items ?? []).map((it) => ({
        questionId: it.question_id,
        score: scores[it.question_id] ?? 0,
        assessorRemark: remarks || undefined,
      }));
      return qual.post(`/assessment-attempt-sections/${current!.assessment_attempt_section_id}/score`, { responses }, idempotencyKey("ui-score"));
    },
    onMutate: () => setSubmitting(true),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["attempt-detail", attemptId] });
      if (componentIndex + 1 < mandatorySteps.length) {
        setComponentIndex(componentIndex + 1);
        setScores({});
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

  const allAnswered = items.length > 0 && items.every((it) => scores[it.question_id] !== undefined);
  const isRating = items[0]?.question_type === "RATING_1_5";

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
        <Button disabled={!allAnswered || submitting} onClick={() => submitComponent.mutate()}>
          {submitting ? "Submitting…" : componentIndex + 1 < mandatorySteps.length ? "Next: " + mandatorySteps[componentIndex + 1].name + " →" : "Submit & See Result →"}
        </Button>
      </div>
    </AppShell>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { Badge, Button, Card, CategoryBadge, ErrorState, EvaluatorBadge, LevelBadge, LoadingState } from "../components/ui";

type ChecklistState = "full" | "half" | "fail";
const STATE_LABEL: Record<ChecklistState, string> = { full: "Full marks", half: "Partial", fail: "Fail" };

export function AssessmentAttempt() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const attemptQuery = useQuery({ queryKey: ["attempt", id], queryFn: () => api.get<any>(`/assessment-attempts/${id}`) });
  const templateId = attemptQuery.data?.assessment_template_id;
  const templateQuery = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => api.get<any>(`/assessment-templates/${templateId}`),
    enabled: !!templateId,
  });

  const [theoryAnswers, setTheoryAnswers] = useState<Record<string, string>>({});
  const [practicalState, setPracticalState] = useState<Record<string, ChecklistState>>({});
  const [behaviourScores, setBehaviourScores] = useState<Record<string, number>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["attempt", id] });
  };

  const submitTheory = useMutation({
    mutationFn: () =>
      api.post(`/assessment-attempts/${id}/theory-submit`, {
        answers: Object.entries(theoryAnswers).map(([questionId, key]) => ({ questionId, selectedKeys: [key] })),
      }),
    onSuccess: invalidate,
  });

  const submitPractical = useMutation({
    mutationFn: () => {
      const items = (templateQuery.data?.checklist ?? []).map((c: any) => {
        const state = practicalState[c.checklist_item_id] ?? "full";
        const score = state === "full" ? Number(c.max_score) : state === "half" ? Number(c.max_score) / 2 : 0;
        return { checklistItemId: c.checklist_item_id, score };
      });
      return api.post(`/assessment-attempts/${id}/practical-score`, { items });
    },
    onSuccess: invalidate,
  });

  const submitBehaviour = useMutation({
    mutationFn: () => {
      const criteria = (templateQuery.data?.behaviours ?? []).map((b: any) => ({
        behaviourCriterionId: b.behaviour_criterion_id,
        score: behaviourScores[b.behaviour_criterion_id] ?? Number(b.max_score),
      }));
      return api.post(`/assessment-attempts/${id}/behaviour-score`, { criteria });
    },
    onSuccess: invalidate,
  });

  const finalize = useMutation({
    mutationFn: () => api.post<any>(`/assessment-attempts/${id}/submit`),
    onSuccess: invalidate,
  });

  if (attemptQuery.isLoading) return <LoadingState />;
  if (attemptQuery.error || !attemptQuery.data) return <ErrorState message="Could not load attempt" />;
  const attempt = attemptQuery.data;
  const componentsByType: Record<string, any> = Object.fromEntries((attempt.components ?? []).map((c: any) => [c.component_type, c]));
  const allScored = ["theory", "practical", "behaviour"].every((t) => componentsByType[t]);

  if (attempt.outcome) {
    const o = attempt.outcome;
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{attempt.process_name} — <LevelBadge code={attempt.level_code} /> Assessment</h1>
        <Card>
          <div className={`rounded-lg p-4 text-center ${o.result === "PASS" ? "bg-emerald-50" : "bg-rose-50"}`}>
            <div className={`text-3xl font-bold ${o.result === "PASS" ? "text-emerald-700" : "text-rose-700"}`}>{o.result}</div>
            <div className="mt-1 text-sm text-slate-600">
              Composite score {o.composite_score_pct}% (passing ≥ {o.passing_score_pct_snapshot}%)
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-4 text-sm">
            <Link className="text-indigo-600 hover:underline" to={`/workers/${attempt.worker_id}`}>View worker profile →</Link>
            {o.result === "FAIL" && <Link className="text-indigo-600 hover:underline" to="/gap-analysis">View Gap Analysis & Retest →</Link>}
          </div>
        </Card>
      </div>
    );
  }

  if (finalize.data?.readinessCheck) {
    const r = finalize.data;
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{attempt.process_name} — <LevelBadge code={attempt.level_code} /> Readiness Check</h1>
        <Card>
          <div className={`rounded-lg p-4 text-center ${r.passed ? "bg-emerald-50" : "bg-amber-50"}`}>
            <div className={`text-3xl font-bold ${r.passed ? "text-emerald-700" : "text-amber-700"}`}>
              {r.passed ? "READY" : "NOT YET READY"}
            </div>
            <div className="mt-1 text-sm text-slate-600">Self-check score {r.composite.compositeScorePct}%</div>
            <div className="mt-2 text-xs text-slate-500">
              This is a self-assessment — it does not certify you and does not touch your official skill level. Use it to gauge readiness before booking the real Supervisor assessment.
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-4 text-sm">
            <Link className="text-indigo-600 hover:underline" to="/assessments">Back to Assessments →</Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {attempt.process_name} — <LevelBadge code={attempt.level_code} /> <CategoryBadge category={attempt.assessment_category} />
        </h1>
        <p className="text-sm text-slate-500">Attempt #{attempt.attempt_no} · {attempt.status}</p>
        {attempt.is_readiness_check_only && (
          <p className="mt-1 text-xs text-amber-600">
            Self-assessment readiness check — scored the same way, but the result never reaches Module 4 (no certificate, no skill-level change).
          </p>
        )}
      </div>

      <Card title={<span>1. Theory {componentsByType.theory && <Badge color="green">Scored ({componentsByType.theory.raw_score}/{componentsByType.theory.max_possible_score})</Badge>}</span>}>
        {templateQuery.data?.questions.map((q: any) => (
          <div key={q.question_id} className="mb-3 border-b border-slate-100 pb-3 last:border-0">
            <div className="text-sm font-medium">{q.question_text}</div>
            <div className="mt-1 space-y-1">
              {q.options_json.map((opt: any) => (
                <label key={opt.key} className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="radio"
                    name={q.question_id}
                    checked={theoryAnswers[q.question_id] === opt.key}
                    onChange={() => setTheoryAnswers((prev) => ({ ...prev, [q.question_id]: opt.key }))}
                  />
                  {opt.key}. {opt.text}
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button onClick={() => submitTheory.mutate()} disabled={submitTheory.isPending}>Submit theory answers</Button>
      </Card>

      <Card title={<span>2. Practical checklist {componentsByType.practical && <Badge color="green">Scored ({componentsByType.practical.raw_score}/{componentsByType.practical.max_possible_score})</Badge>}</span>}>
        {templateQuery.data?.checklist.map((c: any) => (
          <div key={c.checklist_item_id} className="mb-2 flex items-center justify-between text-sm">
            <span>
              {c.criterion_text} <EvaluatorBadge capacity={c.evaluator_capacity} /> {c.is_critical && <Badge color="red">Critical safety item</Badge>}
            </span>
            <div className="flex gap-1">
              {(["full", "half", "fail"] as ChecklistState[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setPracticalState((prev) => ({ ...prev, [c.checklist_item_id]: s }))}
                  className={`rounded-md px-2 py-1 text-xs ${
                    (practicalState[c.checklist_item_id] ?? "full") === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {STATE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button onClick={() => submitPractical.mutate()} disabled={submitPractical.isPending}>Submit practical scores</Button>
      </Card>

      <Card title={<span>3. Behaviour {componentsByType.behaviour && <Badge color="green">Scored ({componentsByType.behaviour.raw_score}/{componentsByType.behaviour.max_possible_score})</Badge>}</span>}>
        {templateQuery.data?.behaviours.map((b: any) => (
          <div key={b.behaviour_criterion_id} className="mb-2 flex items-center justify-between text-sm">
            <span>{b.criterion_label} <EvaluatorBadge capacity={b.evaluator_capacity} /></span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={Number(b.max_score)}
                step={0.5}
                value={behaviourScores[b.behaviour_criterion_id] ?? Number(b.max_score)}
                onChange={(e) => setBehaviourScores((prev) => ({ ...prev, [b.behaviour_criterion_id]: Number(e.target.value) }))}
              />
              <span className="w-12 font-mono text-xs">{behaviourScores[b.behaviour_criterion_id] ?? Number(b.max_score)}/{b.max_score}</span>
            </div>
          </div>
        ))}
        <Button onClick={() => submitBehaviour.mutate()} disabled={submitBehaviour.isPending}>Submit behaviour scores</Button>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-500">
            {allScored ? "All components scored — ready to finalize." : "Score all three components above before finalizing."}
          </div>
          <Button variant={allScored ? "primary" : "secondary"} disabled={!allScored || finalize.isPending} onClick={() => finalize.mutate()}>
            Finalize & submit
          </Button>
        </div>
        {finalize.isError && <ErrorState message={(finalize.error as Error).message} />}
      </Card>
    </div>
  );
}

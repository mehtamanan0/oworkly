import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WorkerShell } from "../../shell/WorkerShell";
import { qual, v2, idempotencyKey } from "../../lib/apiV2";
import { Button } from "../../components/figma/Button";

interface ComponentAttempt {
  assessment_attempt_section_id: string;
  self_assessment_enabled: boolean;
  min_gate_pct: string | number | null;
  name: string;
}
interface AttemptDetail {
  componentAttempts: ComponentAttempt[];
  qualification_case_id: string;
}
interface QuizItem {
  question_id: string;
  question_type: string;
  prompt: string;
  options_json: { key: string; text: string }[] | null;
  max_score: string | number;
  sequence_no: number;
}

type Phase = "intro" | "question" | "result";

export function WorkerQuiz() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation: string | null; correctAnswerKeys: string[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, { chosen: string; isCorrect: boolean; correctKey: string }>>({});
  const [finalResult, setFinalResult] = useState<{ passed: boolean; compositePct: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: attempt } = useQuery({
    queryKey: ["attempt-detail", attemptId],
    queryFn: () => qual.get<AttemptDetail>(`/assessment-attempts/${attemptId}`),
  });
  const selfComponent = attempt?.componentAttempts.find((c) => c.self_assessment_enabled);

  const { data: items } = useQuery({
    queryKey: ["quiz-items", selfComponent?.assessment_attempt_section_id],
    queryFn: () => qual.get<QuizItem[]>(`/assessment-attempt-sections/${selfComponent!.assessment_attempt_section_id}/items`),
    enabled: !!selfComponent,
  });

  if (!attempt || !selfComponent || !items) {
    return (
      <WorkerShell>
        <div className="py-16 text-center text-sm text-fig-muted">Loading quiz…</div>
      </WorkerShell>
    );
  }

  const componentAttemptId = selfComponent.assessment_attempt_section_id;
  const currentItem = items[index];

  async function selectOption(key: string) {
    if (feedback) return; // locked after first answer
    setSelected(key);
    const res = await qual.post<{ isCorrect: boolean; explanation: string | null; correctAnswerKeys: string[] }>(
      `/assessment-attempt-sections/${componentAttemptId}/check-item`,
      { questionId: currentItem.question_id, responseJson: { chosen: key } }
    );
    setFeedback(res);
    setAnswers((prev) => ({ ...prev, [currentItem.question_id]: { chosen: key, isCorrect: res.isCorrect, correctKey: res.correctAnswerKeys?.[0] } }));
  }

  async function nextQuestion() {
    // Safe: this closure is only ever invoked from JSX rendered after the
    // loading guard below, where `items` is already confirmed defined.
    if (index + 1 < items!.length) {
      setIndex(index + 1);
      setSelected(null);
      setFeedback(null);
      return;
    }
    // Last question answered — submit the full batch (already provisionally
    // saved by check-item) and finalize.
    setSubmitting(true);
    try {
      const responses = items!.map((it) => ({
        questionId: it.question_id,
        score: answers[it.question_id]?.isCorrect ? it.max_score : 0,
        responseJson: { chosen: answers[it.question_id]?.chosen },
      }));
      await qual.post(`/assessment-attempt-sections/${componentAttemptId}/score`, { responses }, idempotencyKey("wp-quiz-score"));
      const result = await qual.post<{ passed: boolean; compositePct: number }>(`/assessment-attempts/${attemptId}/finalize`, {}, idempotencyKey("wp-quiz-finalize"));
      setFinalResult(result);
      setPhase("result");
    } finally {
      setSubmitting(false);
    }
  }

  const correctCount = Object.values(answers).filter((a) => a.isCorrect).length;
  const passMarkPct = Number(selfComponent.min_gate_pct ?? 60);

  return (
    <WorkerShell>
      {phase === "intro" && (
        <div className="mx-auto max-w-md overflow-hidden rounded-fig-card border border-fig-border bg-white shadow-fig-card">
          <div className="flex items-center gap-3 bg-fig-navy px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-white">⚡</span>
            <div>
              <div className="text-sm font-semibold text-white">{selfComponent.name.replace("Self-Assessment Quiz", "").trim() || "Self-Assessment"}</div>
              <div className="text-xs text-white/70">Self-Assessment Quiz</div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-blue-50 py-3 text-center">
                <div className="text-lg font-bold text-fig-blue">{items.length}</div>
                <div className="text-[11px] text-fig-muted">Questions</div>
              </div>
              <div className="rounded-lg bg-green-50 py-3 text-center">
                <div className="text-lg font-bold text-fig-green">{passMarkPct}%</div>
                <div className="text-[11px] text-fig-muted">Pass Mark</div>
              </div>
              <div className="rounded-lg bg-purple-50 py-3 text-center">
                <div className="text-lg font-bold text-fig-purple">MCQ</div>
                <div className="text-[11px] text-fig-muted">Type</div>
              </div>
            </div>
            <ul className="mb-5 space-y-1.5 text-sm text-fig-text">
              <li className="flex gap-2">
                <span className="text-fig-blue">•</span>Read each question carefully before answering.
              </li>
              <li className="flex gap-2">
                <span className="text-fig-blue">•</span>Once you select an option, it is locked — choose wisely.
              </li>
              <li className="flex gap-2">
                <span className="text-fig-blue">•</span>The correct answer and explanation are shown after each question.
              </li>
              <li className="flex gap-2">
                <span className="text-fig-blue">•</span>Your score is displayed at the end and submitted for review.
              </li>
            </ul>
            <Button variant="primary" className="w-full justify-center" onClick={() => setPhase("question")}>
              ⚡ Start Quiz — {items.length} Questions
            </Button>
            <button type="button" onClick={() => navigate("/worker/dashboard")} className="mt-3 w-full text-center text-xs text-fig-muted hover:text-fig-blue">
              ← Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {phase === "question" && currentItem && (
        <div>
          <div className="mb-4 flex items-center justify-between border-b border-fig-border pb-3">
            <div>
              <div className="text-xs text-fig-muted">{selfComponent.name}</div>
              <div className="text-sm font-semibold text-fig-text">
                Question {index + 1} of {items.length}
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="text-fig-muted">Score so far</div>
              <div className="font-semibold text-fig-blue">
                {correctCount}/{index + (feedback ? 1 : 0)} correct
              </div>
            </div>
          </div>
          <div className="mb-1.5 h-1 w-full rounded bg-fig-border">
            <div className="h-1 rounded bg-fig-blue transition-all" style={{ width: `${((index + (feedback ? 1 : 0)) / items.length) * 100}%` }} />
          </div>

          <div className="mt-5 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fig-navy text-xs font-semibold text-white">{index + 1}</span>
              <p className="text-base font-medium text-fig-text">{currentItem.prompt}</p>
            </div>
            <div className="mt-4 space-y-2">
              {(currentItem.options_json ?? []).map((opt) => {
                const isChosen = selected === opt.key;
                const isCorrectOpt = feedback?.correctAnswerKeys?.includes(opt.key);
                let cls = "border-fig-border bg-white text-fig-text";
                if (feedback) {
                  if (isCorrectOpt) cls = "border-fig-green bg-green-50 text-fig-green";
                  else if (isChosen && !feedback.isCorrect) cls = "border-fig-red bg-red-50 text-fig-red";
                  else cls = "border-fig-border bg-white text-fig-muted";
                } else if (isChosen) {
                  cls = "border-fig-blue bg-blue-50 text-fig-blue";
                }
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={!!feedback}
                    onClick={() => selectOption(opt.key)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${cls} ${!feedback ? "hover:border-fig-blue/60" : ""}`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/60 text-xs font-semibold">{opt.key}</span>
                    <span className="flex-1">{opt.text}</span>
                    {feedback && isCorrectOpt && <span>✓</span>}
                    {feedback && isChosen && !feedback.isCorrect && <span>✕</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {feedback && (
            <div className="mt-4 rounded-fig-card border border-blue-200 bg-blue-50 p-4 text-sm text-fig-text">
              💡 <span className="font-semibold">Explanation:</span> {feedback.explanation}
            </div>
          )}

          {feedback && (
            <Button variant="primary" className="mt-4 w-full justify-center" disabled={submitting} onClick={nextQuestion}>
              {submitting ? "Submitting…" : index + 1 < items.length ? "Next Question →" : "See Results →"}
            </Button>
          )}
          <p className="mt-2 text-center text-xs text-fig-muted">
            {selfComponent.name} · {index + 1}/{items.length}
          </p>
        </div>
      )}

      {phase === "result" && finalResult && (
        <div>
          <div className={`rounded-fig-card border p-5 ${finalResult.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className="flex items-center gap-4">
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold ${finalResult.passed ? "bg-green-100 text-fig-green" : "bg-red-100 text-fig-red"}`}>
                {Math.round(finalResult.compositePct)}%
              </span>
              <div>
                <div className={`text-lg font-bold ${finalResult.passed ? "text-fig-green" : "text-fig-red"}`}>
                  {finalResult.passed ? "Passed — Readiness Confirmed" : "Not Passed — Review Required"}
                </div>
                <div className="text-sm text-fig-muted">
                  {correctCount} of {items.length} correct · Pass mark: {passMarkPct}%
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Button variant="navy" className="flex-1 justify-center" onClick={() => navigate("/worker/dashboard")}>
              🏅 Back to Dashboard
            </Button>
            <Button
              variant="secondary"
              className="flex-1 justify-center"
              onClick={() => {
                setPhase("intro");
                setIndex(0);
                setSelected(null);
                setFeedback(null);
                setAnswers({});
                setFinalResult(null);
              }}
            >
              Retry Quiz
            </Button>
          </div>

          <div className="mt-6 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
            <div className="mb-3 text-sm font-semibold text-fig-text">Question-by-Question Review</div>
            <div className="space-y-5">
              {items.map((it, i) => {
                const ans = answers[it.question_id];
                return (
                  <div key={it.question_id}>
                    <div className="flex items-start gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${ans?.isCorrect ? "bg-fig-green" : "bg-fig-red"}`}>
                        {i + 1}
                      </span>
                      <p className="text-sm font-medium text-fig-text">{it.prompt}</p>
                    </div>
                    <div className="ml-7 mt-2 space-y-1">
                      {(it.options_json ?? []).map((opt) => {
                        const chosen = ans?.chosen === opt.key;
                        const isTheCorrectOption = ans?.correctKey === opt.key;
                        const wrong = chosen && !ans?.isCorrect;
                        return (
                          <div
                            key={opt.key}
                            className={`rounded border px-3 py-1.5 text-xs ${
                              isTheCorrectOption ? "border-fig-green bg-green-50 text-fig-green" : wrong ? "border-fig-red bg-red-50 text-fig-red" : "border-fig-border text-fig-text"
                            }`}
                          >
                            <span className="font-semibold">{opt.key}</span> {opt.text}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </WorkerShell>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Worker } from "../lib/api";
import { Badge, Button, Card, CategoryBadge, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function Assessments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workerId, setWorkerId] = useState("");
  const [templateId, setTemplateId] = useState("");

  const templatesQuery = useQuery({ queryKey: ["assessment-templates"], queryFn: () => api.get<any[]>("/assessment-templates") });
  const workersQuery = useQuery({ queryKey: ["workers-all"], queryFn: () => api.get<Worker[]>("/workers") });
  const attemptsQuery = useQuery({ queryKey: ["assessment-attempts"], queryFn: () => api.get<any[]>("/assessment-attempts") });

  const startAttempt = useMutation({
    mutationFn: () => api.post<any>("/assessment-attempts", { workerId, assessmentTemplateId: templateId }),
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({ queryKey: ["assessment-attempts"] });
      navigate(`/assessments/attempts/${attempt.assessment_attempt_id}`);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Assessments</h1>
        <p className="text-sm text-slate-500">Module 3–4: run a live theory + practical + behaviour assessment through to a pass/fail decision.</p>
      </div>

      <Card title="Start a new attempt">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400">Worker</label>
            <select className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Select worker…</option>
              {workersQuery.data?.map((w) => (
                <option key={w.worker_id} value={w.worker_id}>
                  {w.first_name} {w.last_name} ({w.hrms_employee_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400">Assessment template</label>
            <select className="w-80 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Select template…</option>
              {templatesQuery.data?.map((t) => (
                <option key={t.assessment_template_id} value={t.assessment_template_id}>
                  {t.process_name} — {t.level_code} ({t.assessment_category === "SELF" ? "Self-Check" : "Supervisor"})
                </option>
              ))}
            </select>
          </div>
          <Button disabled={!workerId || !templateId || startAttempt.isPending} onClick={() => startAttempt.mutate()}>
            Start attempt
          </Button>
        </div>
        {startAttempt.isError && <ErrorState message={(startAttempt.error as Error).message} />}
      </Card>

      <Card title="Assessment templates configured">
        {templatesQuery.isLoading && <LoadingState />}
        {templatesQuery.data && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Process</th>
                <th>Level</th>
                <th>Category</th>
                <th>Theory Qs</th>
                <th>Checklist items</th>
              </tr>
            </thead>
            <tbody>
              {templatesQuery.data.map((t) => (
                <tr key={t.assessment_template_id} className="border-t border-slate-100">
                  <td className="py-2">{t.process_name}</td>
                  <td><LevelBadge code={t.level_code} /></td>
                  <td><CategoryBadge category={t.assessment_category} /> {t.is_readiness_check_only && <span className="text-xs text-slate-400">(non-certifying)</span>}</td>
                  <td>{t.question_count}</td>
                  <td>{t.checklist_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Recent attempts">
        {attemptsQuery.isLoading && <LoadingState />}
        {attemptsQuery.data && attemptsQuery.data.length === 0 && <div className="text-sm text-slate-400">No attempts yet.</div>}
        {attemptsQuery.data && attemptsQuery.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Worker</th>
                <th>Process</th>
                <th>Level</th>
                <th>Category</th>
                <th>Attempt #</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attemptsQuery.data.map((a) => (
                <tr key={a.assessment_attempt_id} className="border-t border-slate-100">
                  <td className="py-2">{a.first_name} {a.last_name}</td>
                  <td>{a.process_name}</td>
                  <td><LevelBadge code={a.level_code} /></td>
                  <td><CategoryBadge category={a.assessment_category} /></td>
                  <td>{a.attempt_no}</td>
                  <td><Badge color={a.status === "scored" ? "green" : "amber"}>{a.status}</Badge></td>
                  <td>
                    <button className="text-indigo-600 hover:underline" onClick={() => navigate(`/assessments/attempts/${a.assessment_attempt_id}`)}>
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

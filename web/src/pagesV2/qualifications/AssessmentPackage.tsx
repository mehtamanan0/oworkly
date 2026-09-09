import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { StatusBadge } from "../../components/figma/Badge";
import { Button } from "../../components/figma/Button";
import { qual, v2, idempotencyKey } from "../../lib/apiV2";

interface PackageComponent {
  assessment_package_component_id: string;
  assessment_definition_id: string;
  name: string;
  description: string;
  component_type: string;
  weight_pct: string;
  min_gate_pct: string | null;
  sequence_no: number;
  item_count: number;
  max_total_score: string | null;
}
interface QCase {
  qualification_case_id: string;
  status: string;
  worker_id: string;
  process_id: string;
  target_process_level_id: string;
  target_level_code: string;
  target_level_name: string;
  target_min_qualification_score_pct: string | null;
  process_name: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  components: PackageComponent[];
  attempts: { assessment_attempt_id: string; status: string }[];
}

// This route is reached two ways: with a real qualificationCaseId (drilling
// back into an existing case), or freshly from a worker's Skill Profile —
// in which case route state carries {workerId, processId} and this page
// creates/reuses the case for the worker's next target level first.
export function AssessmentPackage() {
  const params = useParams<{ qualificationCaseId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = location.state as { workerId?: string; processId?: string } | null;
  // "new" is a literal path segment (not a real id) meaning "no case exists
  // yet — create/reuse one from the workerId/processId carried in route
  // state", used when navigating here fresh from a worker's Skill Profile.
  const isNew = !params.qualificationCaseId || params.qualificationCaseId === "new";
  const [resolvedCaseId, setResolvedCaseId] = useState<string | null>(isNew ? null : params.qualificationCaseId!);
  const [starting, setStarting] = useState(false);

  const { data: bootstrap } = useQuery({
    queryKey: ["bootstrap-case", state?.workerId, state?.processId],
    queryFn: async () => {
      const levels = await v2.get<{ levels: { process_level_id: string; code: string }[] }>(`/processes/${state!.processId}/levels`);
      const profile = await v2.get<{ enrollments: { process_id: string; target_level_code: string | null }[] }>(`/workers/${state!.workerId}/profile`);
      const enrollment = profile.enrollments.find((e) => e.process_id === state!.processId);
      const targetLevel = levels.levels.find((l) => l.code === enrollment?.target_level_code) ?? levels.levels[0];
      const created = await qual.post<{ qualification_case_id: string }>(
        "/qualification-cases",
        { workerId: state!.workerId, processId: state!.processId, targetProcessLevelId: targetLevel.process_level_id },
        idempotencyKey("ui-qc")
      );
      return created.qualification_case_id;
    },
    enabled: !resolvedCaseId && !!state?.workerId && !!state?.processId,
  });

  const activeCaseId = resolvedCaseId ?? bootstrap ?? null;
  if (bootstrap && !resolvedCaseId) setResolvedCaseId(bootstrap);

  const { data: qcase } = useQuery({
    queryKey: ["qualification-case", activeCaseId],
    queryFn: () => qual.get<QCase>(`/qualification-cases/${activeCaseId}`),
    enabled: !!activeCaseId,
  });

  const startAttempt = useMutation({
    mutationFn: () => qual.post<{ assessment_attempt_id: string }>(`/qualification-cases/${activeCaseId}/attempts`, {}, idempotencyKey("ui-attempt")),
    onMutate: () => setStarting(true),
    onSuccess: (attempt) => navigate(`/assessments/${attempt.assessment_attempt_id}/evaluate`),
    onSettled: () => setStarting(false),
    onError: async () => {
      qc.invalidateQueries({ queryKey: ["qualification-case", activeCaseId] });
    },
  });

  const openAttempt = qcase?.attempts.find((a) => a.status === "in_progress");

  if (!qcase) {
    return (
      <AppShell breadcrumbs={[{ label: "Assessments" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading assessment package…</div>
      </AppShell>
    );
  }

  const fullName = `${qcase.first_name} ${qcase.last_name}`;
  const totalWeight = qcase.components.reduce((s, c) => s + Number(c.weight_pct), 0);

  return (
    <AppShell breadcrumbs={[{ label: "Assessments" }, { label: fullName }, { label: "Package" }]}>
      <PageHeader title="Assessment Package" description={`${fullName} · ${qcase.hrms_employee_code} · ${qcase.process_name} ${qcase.target_level_code}`} />

      <div className="mb-5 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-fig-text">Assessment Status</span>
          <StatusBadge status={qcase.status} />
        </div>
        <p className="mb-2 text-xs text-fig-muted">
          ⚡ {qcase.components.length} assessments · Weightages sum to {totalWeight}%
          {qcase.target_min_qualification_score_pct && ` · Min pass: ${Number(qcase.target_min_qualification_score_pct).toFixed(0)}%`}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded bg-fig-border">
          <div className="h-full bg-fig-blue" style={{ width: qcase.status === "READY_FOR_ASSESSMENT" ? "0%" : "50%" }} />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-4">
        {qcase.components.map((c) => (
          <div key={c.assessment_package_component_id} className="rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded bg-fig-navy px-2 py-0.5 text-xs font-semibold text-white">{c.weight_pct}% weight</span>
              <span className="text-xs text-fig-muted">⏱ Pending</span>
            </div>
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-fig-blue">{c.component_type}</div>
            <div className="mb-1 text-sm font-bold text-fig-text">{c.name}</div>
            <p className="mb-2 text-xs text-fig-muted">{c.description}</p>
            <div className="text-xs text-fig-text">
              {c.item_count} questions · max {c.max_total_score ?? "—"} marks
              {c.min_gate_pct && <span className="ml-1 font-medium text-fig-orange">· Gate: must score ≥{c.min_gate_pct}%</span>}
            </div>
            <div className="mt-2 text-[11px] text-fig-muted">Sequence {c.sequence_no} of {qcase.components.length}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => navigate(`/workers/${qcase.worker_id}/profile`)} className="text-sm text-fig-muted hover:text-fig-blue">
          ← Back to Profile
        </button>
        {openAttempt ? (
          <Button onClick={() => navigate(`/assessments/${openAttempt.assessment_attempt_id}/evaluate`)}>Continue Assessment →</Button>
        ) : (
          <Button disabled={starting || qcase.status === "CERTIFIED"} onClick={() => startAttempt.mutate()}>
            {starting ? "Starting…" : "Start Assessment →"}
          </Button>
        )}
      </div>
    </AppShell>
  );
}

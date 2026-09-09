import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { ApprovalTimeline } from "../../components/figma/ApprovalTimeline";
import { Button } from "../../components/figma/Button";
import { useAuthV2 } from "../../lib/AuthV2Context";
import { qual, idempotencyKey, ApiV2Error } from "../../lib/apiV2";

interface ApprovalStage {
  approval_policy_stage_id: string;
  sequence_no: number;
  role_name: string;
  role_code: string;
  is_required: boolean;
  action: "approved" | "returned" | null;
  remarks: string | null;
  acted_at: string | null;
  approver_display_name: string | null;
}
interface ApprovalStatus {
  instance: { status: string };
  stages: ApprovalStage[];
}
interface QCaseDetail {
  qualification_case_id: string;
  status: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  process_name: string;
  target_level_code: string;
  from_level_code: string | null;
  qualification_number: string;
  result: { weighted_score_pct: string; decided_at: string } | null;
}

export function Approval() {
  const { qualificationCaseId } = useParams<{ qualificationCaseId: string }>();
  const { user } = useAuthV2();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: qcase } = useQuery({ queryKey: ["qualification-case", qualificationCaseId], queryFn: () => qual.get<QCaseDetail>(`/qualification-cases/${qualificationCaseId}`) });
  const { data: approval } = useQuery({ queryKey: ["approval-status", qualificationCaseId], queryFn: () => qual.get<ApprovalStatus | null>(`/qualification-cases/${qualificationCaseId}/approval`) });

  const act = useMutation({
    mutationFn: (input: { stageSequence: number; action: "approved" | "returned" }) =>
      qual.post(`/qualification-cases/${qualificationCaseId}/approval/${input.stageSequence}/act`, { action: input.action, remarks: remarks || undefined }, idempotencyKey("ui-approve")),
    onSuccess: () => {
      setError(null);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["approval-status", qualificationCaseId] });
      qc.invalidateQueries({ queryKey: ["qualification-case", qualificationCaseId] });
    },
    onError: (err) => setError(err instanceof ApiV2Error ? err.message : "Could not record your decision"),
  });

  if (!qcase || !approval) {
    return (
      <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: "Approval" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading approval workflow…</div>
      </AppShell>
    );
  }

  const fullName = `${qcase.first_name} ${qcase.last_name}`;
  const approvedCount = approval.stages.filter((s) => s.action === "approved").length;
  const currentStage = approval.stages.find((s) => !s.action);
  // Role-eligibility is only a UI convenience for showing/hiding the action
  // panel — self-approval prevention and the real role check both happen
  // server-side regardless of what this renders.
  const canActOnCurrent = !!currentStage && !!user?.roles.includes(currentStage.role_code);

  return (
    <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: fullName }, { label: "Approval" }]}>
      <div className="mb-2">
        <h1 className="text-xl font-bold text-fig-text">Approval Workflow</h1>
        <p className="text-sm text-fig-muted">
          {fullName} · {qcase.hrms_employee_code} · {qcase.process_name} {qcase.target_level_code} · Qualification ID: {qcase.qualification_number}
        </p>
      </div>

      {currentStage ? (
        <div className="mb-5 flex items-center justify-between rounded-fig-card border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-center gap-3">
            <span className="text-fig-orange">🕐</span>
            <div>
              <div className="text-sm font-semibold text-fig-orange">Awaiting {currentStage.role_name} Approval</div>
              <div className="text-xs text-fig-muted">
                {approvedCount} of {approval.stages.length} approvals received · Pending: {currentStage.role_name}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            {approval.stages.map((s) => (
              <span key={s.sequence_no} className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${s.action === "approved" ? "bg-green-100 text-fig-green" : "bg-orange-100 text-fig-orange"}`}>
                {s.action === "approved" ? "✓" : "⏱"}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-5 rounded-fig-card border border-green-200 bg-green-50 p-4 text-sm font-semibold text-fig-green">✓ All approvals complete — ready to certify</div>
      )}

      <ApprovalTimeline stages={approval.stages} />

      {currentStage && canActOnCurrent && (
        <div className="mt-4 rounded-fig-card border border-orange-200 bg-orange-50/60 p-4">
          <div className="mb-2 text-sm font-semibold text-fig-text">You are approving as {currentStage.role_name}</div>
          <textarea
            className="mb-3 w-full resize-none rounded-lg border border-fig-border p-2.5 text-sm focus:border-fig-blue focus:outline-none"
            rows={2}
            placeholder="Add approval remarks (optional)…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-fig-red">{error}</p>}
          <div className="flex gap-2">
            <Button variant="success" disabled={act.isPending} onClick={() => act.mutate({ stageSequence: currentStage.sequence_no, action: "approved" })}>
              ✓ Approve{currentStage.sequence_no === approval.stages.length ? " & Certify" : ""}
            </Button>
            <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ stageSequence: currentStage.sequence_no, action: "returned" })}>
              Return for Review
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
        <div className="mb-3 text-sm font-semibold text-fig-text">Qualification Record</div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Field label="Worker" value={`${fullName} (${qcase.hrms_employee_code})`} />
          <Field label="Process" value={qcase.process_name} />
          <Field label="From Level" value={qcase.from_level_code ?? "—"} />
          <Field label="To Level" value={qcase.target_level_code} />
          <Field label="Weighted Score" value={qcase.result ? `${Number(qcase.result.weighted_score_pct).toFixed(0)}%` : "—"} />
          <Field label="Assessment Date" value={qcase.result ? new Date(qcase.result.decided_at).toLocaleDateString() : "—"} />
          <Field label="Qualification ID" value={qcase.qualification_number} />
        </div>
      </div>

      {qcase.status === "APPROVED" && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => navigate(`/qualifications/${qualificationCaseId}/certification`)}>Go to Certification →</Button>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fig-muted">{label}</div>
      <div className="font-medium text-fig-text">{value}</div>
    </div>
  );
}

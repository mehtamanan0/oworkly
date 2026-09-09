import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { Button } from "../../components/figma/Button";
import { StatusBadge } from "../../components/figma/Badge";
import { qual } from "../../lib/apiV2";

interface ComponentResult {
  qualification_component_result_id: string;
  name: string;
  raw_pct: string;
  weight_pct: string;
  weighted_pct: string;
  gate_pct: string | null;
  status: "PASS" | "FAIL";
}
interface RuleCheck {
  rule_code: string;
  label: string;
  passed: boolean;
  detail_json: any;
}
interface QCaseDetail {
  qualification_case_id: string;
  status: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  process_name: string;
  target_level_code: string;
  target_level_name: string;
  result: { result: "PASS" | "FAIL"; weighted_score_pct: string; pass_threshold_pct: string; decided_at: string } | null;
  componentResults: ComponentResult[];
  ruleChecks: RuleCheck[];
}

export function Result() {
  const { qualificationCaseId } = useParams<{ qualificationCaseId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["qualification-case", qualificationCaseId], queryFn: () => qual.get<QCaseDetail>(`/qualification-cases/${qualificationCaseId}`) });

  const submitForApproval = useMutation({
    // Submission for approval already happened automatically inside
    // finalizeAttempt on PASS — this button just navigates to the approval
    // screen, matching the case's real status rather than re-triggering
    // anything.
    mutationFn: async () => qc.invalidateQueries({ queryKey: ["qualification-case", qualificationCaseId] }),
    onSuccess: () => navigate(`/qualifications/${qualificationCaseId}/approval`),
  });

  if (!data) {
    return (
      <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: "Result" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading result…</div>
      </AppShell>
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`;
  const pass = data.result?.result === "PASS";

  return (
    <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: fullName }, { label: "Result" }]}>
      <div className="mb-2">
        <h1 className="text-xl font-bold text-fig-text">Consolidated Qualification Result</h1>
        <p className="text-sm text-fig-muted">
          {fullName} · {data.hrms_employee_code} · {data.process_name} {data.target_level_code}
        </p>
      </div>

      {!data.result ? (
        <div className="rounded-fig-card border border-dashed border-fig-border bg-white p-10 text-center text-sm text-fig-muted">
          No result recorded yet for this case — finish the assessment to see the outcome here.
        </div>
      ) : (
        <>
          <div className={`mb-5 flex items-center justify-between rounded-fig-card border p-5 ${pass ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${pass ? "bg-green-100 text-fig-green" : "bg-red-100 text-fig-red"}`}>
                {pass ? "✓" : "✕"}
              </span>
              <div>
                <div className={`text-lg font-bold ${pass ? "text-fig-green" : "text-fig-red"}`}>RESULT: {data.result.result}</div>
                <div className="text-sm text-fig-muted">
                  {data.process_name} · {data.target_level_name} Qualification · {new Date(data.result.decided_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-bold ${pass ? "text-fig-green" : "text-fig-red"}`}>{Number(data.result.weighted_score_pct).toFixed(0)}%</div>
              <div className="text-xs text-fig-muted">Weighted Score</div>
              <div className="text-xs text-fig-muted">Pass threshold: {Number(data.result.pass_threshold_pct).toFixed(0)}%</div>
            </div>
          </div>

          <div className="mb-5 overflow-hidden rounded-fig-card border border-fig-border bg-white shadow-fig-card">
            <div className="border-b border-fig-border px-5 py-3 text-sm font-semibold text-fig-text">Score Breakdown</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
                  <th className="px-5 py-2">Assessment</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2">Weighted</th>
                  <th className="px-3 py-2">Gate</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.componentResults.map((c) => (
                  <tr key={c.qualification_component_result_id} className="border-b border-fig-border last:border-b-0">
                    <td className="px-5 py-3 font-medium text-fig-text">{c.name}</td>
                    <td className="px-3 py-3">{Number(c.raw_pct).toFixed(0)}%</td>
                    <td className="px-3 py-3 text-fig-muted">{Number(c.weight_pct).toFixed(0)}%</td>
                    <td className="px-3 py-3 font-medium text-fig-blue">{Number(c.weighted_pct).toFixed(0)}%</td>
                    <td className="px-3 py-3 text-fig-muted">{c.gate_pct ? `≥${Number(c.gate_pct).toFixed(0)}%` : "—"}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
                <tr className="bg-fig-bg font-semibold">
                  <td className="px-5 py-3 text-fig-text">Overall Weighted Score</td>
                  <td />
                  <td />
                  <td className={`px-3 py-3 ${pass ? "text-fig-green" : "text-fig-red"}`}>{Number(data.result.weighted_score_pct).toFixed(0)}%</td>
                  <td className="px-3 py-3 text-fig-muted">min {Number(data.result.pass_threshold_pct).toFixed(0)}%</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={data.result.result} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-5 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
            <div className="mb-3 text-sm font-semibold text-fig-text">Mandatory / Gating Checks</div>
            <div className="grid grid-cols-3 gap-3">
              {data.ruleChecks.map((r) => (
                <div key={r.rule_code} className={`rounded-lg px-3 py-2.5 text-sm ${r.passed ? "bg-green-50 text-fig-green" : "bg-red-50 text-fig-red"}`}>
                  <div className="flex items-center gap-1.5 font-medium">
                    {r.passed ? "✓" : "✕"} {r.label}
                  </div>
                  <div className="text-xs opacity-80">
                    {r.detail_json?.weightedTotal !== undefined ? `${r.detail_json.weightedTotal}%` : `${r.detail_json?.completed ?? ""}${r.detail_json?.total !== undefined ? ` / ${r.detail_json.total} complete` : ""}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => navigate(`/workers/${qualificationCaseId}`)} className="text-sm text-fig-muted hover:text-fig-blue">
              ← Back to Package
            </button>
            {pass && (
              <Button onClick={() => submitForApproval.mutate()}>
                {data.status === "PENDING_APPROVAL" || data.status === "APPROVED" || data.status === "CERTIFIED" ? "View Approval →" : "Submit for Approval →"}
              </Button>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { Button } from "../../components/figma/Button";
import { qual, idempotencyKey } from "../../lib/apiV2";

interface Certificate {
  certificate_id: string;
  certificate_number: string;
  valid_from: string;
  valid_to: string | null;
  weighted_score_pct: string | null;
  issuingAuthorityName: string | null;
  approvedByName: string | null;
  trainerName: string | null;
}
interface QCaseDetail {
  qualification_case_id: string;
  worker_id: string;
  status: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  process_name: string;
  from_level_code: string | null;
  target_level_code: string;
  target_level_name: string;
  certificate: Certificate | null;
}

export function Certification() {
  const { qualificationCaseId } = useParams<{ qualificationCaseId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["qualification-case", qualificationCaseId], queryFn: () => qual.get<QCaseDetail>(`/qualification-cases/${qualificationCaseId}`) });

  const issue = useMutation({
    mutationFn: () => qual.post<Certificate>(`/qualification-cases/${qualificationCaseId}/certify`, {}, idempotencyKey("ui-certify")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qualification-case", qualificationCaseId] }),
  });

  if (!data) {
    return (
      <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: "Certification" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading…</div>
      </AppShell>
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`;
  const cert = data.certificate;
  const certNumber = cert?.certificate_number ?? `CWE-${data.process_name?.slice(0, 3).toUpperCase()}-${data.target_level_code}-${data.hrms_employee_code.replace("EMP-", "")}`;

  return (
    <AppShell breadcrumbs={[{ label: "Qualifications" }, { label: fullName }, { label: "Certification" }]}>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-fig-text">Certification Issuance</h1>
        <p className="text-sm text-fig-muted">
          {data.target_level_code} Process-Level Certification · {data.process_name}
        </p>
      </div>

      <div className="mx-auto max-w-2xl overflow-hidden rounded-fig-card border border-fig-navy/20 bg-white shadow-fig-card">
        <div className="flex items-center justify-between bg-fig-navy px-6 py-4 text-white">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 2z" fill="currentColor" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-bold">OWorkly</div>
              <div className="text-[10px] text-white/70">WORKFORCE QUALIFICATION</div>
            </div>
          </div>
          <div className="text-right text-[11px] text-white/70">
            CERTIFICATE NO.
            <div className="font-semibold text-white">{certNumber}</div>
          </div>
        </div>

        <div className="px-8 py-6 text-center">
          <div className="text-[11px] uppercase tracking-wide text-fig-muted">This certifies that</div>
          <div className="mt-1 text-2xl font-bold text-fig-text">{fullName}</div>
          <div className="text-sm text-fig-muted">Employee Code: {data.hrms_employee_code}</div>

          <div className="mx-auto mt-5 max-w-md rounded-lg border border-blue-100 bg-blue-50 py-4">
            <div className="text-[11px] uppercase tracking-wide text-fig-muted">has successfully achieved</div>
            <div className="text-lg font-bold text-fig-navy">
              {data.target_level_code} ({data.target_level_name}) Qualification
            </div>
            <div className="text-sm font-semibold text-fig-text">{data.process_name}</div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-4 border-t border-fig-border pt-4 text-center text-xs">
            <Field label="Previous Level" value={data.from_level_code ?? "—"} />
            <Field label="Certified Level" value={data.target_level_code} tone="text-fig-green font-bold" />
            <Field label="Valid From" value={cert ? fmt(cert.valid_from) : fmt(new Date().toISOString())} />
            <Field label="Valid Until" value={cert?.valid_to ? fmt(cert.valid_to) : "—"} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-fig-border pt-4 text-left text-xs">
            <div>
              <div className="text-fig-muted">Issuing Authority</div>
              <div className="font-medium text-fig-text">{cert?.issuingAuthorityName ?? "Pending issuance"}</div>
            </div>
            <div>
              <div className="text-fig-muted">Approved By</div>
              <div className="font-medium text-fig-text">{cert?.approvedByName ?? "—"}</div>
            </div>
            <div>
              <div className="text-fig-muted">Trainer</div>
              <div className="font-medium text-fig-text">{cert?.trainerName ?? "—"}</div>
            </div>
            <div>
              <div className="text-fig-muted">Assessment Score</div>
              <div className="font-medium text-fig-text">{cert?.weighted_score_pct ? `${Number(cert.weighted_score_pct).toFixed(0)}% (Weighted)` : "—"}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-fig-border bg-fig-bg px-6 py-2.5 text-[10px] text-fig-muted">
          <span>QID: {data.qualification_case_id.slice(0, 8).toUpperCase()}</span>
          {cert && <span className="text-fig-green">✓ Digitally Signed by OWorkly Platform</span>}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        {cert ? (
          <Button onClick={() => navigate(`/workers/${data.worker_id}/profile`, { state: { openTab: "card" } })}>View Skill Card →</Button>
        ) : (
          <Button variant="success" disabled={issue.isPending || data.status !== "APPROVED"} onClick={() => issue.mutate()}>
            {issue.isPending ? "Issuing…" : "🏅 Issue Certification"}
          </Button>
        )}
      </div>
    </AppShell>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-fig-muted">{label}</div>
      <div className={tone ?? "font-medium text-fig-text"}>{value}</div>
    </div>
  );
}

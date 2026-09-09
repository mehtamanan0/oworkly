import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { KpiCard } from "../../components/figma/KpiCard";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { v2, qual } from "../../lib/apiV2";

interface TrainerDashboardStats {
  inQueue: number;
  retestsDue: number;
  expiring30d: number;
  approvalsPending: number;
}
interface QCaseRow {
  qualification_case_id: string;
  status: string;
  worker_id: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  process_name: string;
  from_level_code: string | null;
  target_level_code: string;
  updated_at: string;
}
interface ExpiringCert {
  certificate_id: string;
  worker_id: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  process_name: string;
  level_code: string | null;
  valid_to: string;
}

const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export function TrainerDashboard() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({ queryKey: ["dashboard-trainer"], queryFn: () => v2.get<TrainerDashboardStats>("/dashboard/trainer") });
  const { data: queue } = useQuery({ queryKey: ["qc", "READY_FOR_ASSESSMENT"], queryFn: () => qual.get<QCaseRow[]>("/qualification-cases?status=READY_FOR_ASSESSMENT") });
  const { data: retests } = useQuery({ queryKey: ["qc", "FAILED", "RETEST_COOLING"], queryFn: () => qual.get<QCaseRow[]>("/qualification-cases?status=FAILED&status=RETEST_COOLING") });
  const { data: approvals } = useQuery({ queryKey: ["qc", "PENDING_APPROVAL"], queryFn: () => qual.get<QCaseRow[]>("/qualification-cases?status=PENDING_APPROVAL") });
  const { data: expiring } = useQuery({ queryKey: ["certificates-expiring"], queryFn: () => qual.get<ExpiringCert[]>("/certificates/expiring?days=30") });

  return (
    <AppShell breadcrumbs={[{ label: "Trainer Dashboard" }]}>
      <PageHeader
        title="Trainer Dashboard"
        description={today}
        action={
          <Button onClick={() => navigate("/workers/search")}>
            <span>👤</span> Start Assessment
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-4 gap-4">
        <KpiCard value={stats?.inQueue ?? "—"} label="In Queue" tone="blue" icon="📋" />
        <KpiCard value={stats?.retestsDue ?? "—"} label="Retests Due" tone="orange" icon="⚠️" />
        <KpiCard value={stats?.expiring30d ?? "—"} label="Expiring (30d)" tone="red" icon="⏰" />
        <KpiCard value={stats?.approvalsPending ?? "—"} label="Approvals Pending" tone="green" icon="✅" />
      </div>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <SectionCard title="Assessment Queue" action={<span className="text-xs text-fig-muted">Workers eligible for assessment</span>} className="col-span-2" padded={false}>
          {(!queue || queue.length === 0) && <div className="p-5 text-sm text-fig-muted">No workers currently in the assessment queue.</div>}
          {queue?.map((q) => (
            <div key={q.qualification_case_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fig-navy text-xs font-semibold text-white">
                  {q.first_name[0]}
                  {q.last_name?.[0]}
                </span>
                <div>
                  <div className="text-sm font-medium text-fig-text">
                    {q.first_name} {q.last_name}
                  </div>
                  <div className="text-xs text-fig-muted">
                    {q.hrms_employee_code} · {q.process_name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-fig-blue">
                  {q.from_level_code ?? "—"} → {q.target_level_code}
                </span>
                <Link to={`/workers/${q.worker_id}/profile`} className="text-xs font-medium text-fig-blue hover:underline">
                  View →
                </Link>
              </div>
            </div>
          ))}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Retests Due" padded={false}>
            {(!retests || retests.length === 0) && <div className="p-4 text-sm text-fig-muted">None due.</div>}
            {retests?.map((q) => (
              <div key={q.qualification_case_id} className="flex items-center justify-between border-b border-fig-border px-4 py-2.5 last:border-b-0">
                <div>
                  <div className="text-sm font-medium text-fig-text">
                    {q.first_name} {q.last_name}
                  </div>
                  <div className="text-xs text-fig-muted">{q.process_name}</div>
                </div>
                <Link to={`/workers/${q.worker_id}/profile`} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-fig-orange">
                  Retest
                </Link>
              </div>
            ))}
          </SectionCard>

          <SectionCard title="Approvals Pending" padded={false}>
            {(!approvals || approvals.length === 0) && <div className="p-4 text-sm text-fig-muted">None pending.</div>}
            {approvals?.map((q) => (
              <div key={q.qualification_case_id} className="flex items-center justify-between border-b border-fig-border px-4 py-2.5 last:border-b-0">
                <div>
                  <div className="text-sm font-medium text-fig-text">
                    {q.first_name} {q.last_name}
                  </div>
                  <div className="text-xs text-fig-muted">
                    {q.process_name} · {q.target_level_code}
                  </div>
                </div>
                <Link to={`/qualifications/${q.qualification_case_id}/approval`} className="text-xs font-medium text-fig-blue hover:underline">
                  Review
                </Link>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="📅 Certifications Expiring (Next 30 Days)" padded={false}>
        {(!expiring || expiring.length === 0) && <div className="p-5 text-sm text-fig-muted">Nothing expiring in the next 30 days.</div>}
        {expiring?.map((c) => (
          <div key={c.certificate_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3 last:border-b-0">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-300 text-xs font-semibold text-white">
                {c.first_name[0]}
                {c.last_name?.[0]}
              </span>
              <div>
                <div className="text-sm font-medium text-fig-text">
                  {c.first_name} {c.last_name}
                </div>
                <div className="text-xs text-fig-muted">{c.hrms_employee_code}</div>
              </div>
            </div>
            <div className="text-sm text-fig-text">{c.process_name}</div>
            <span className="rounded bg-fig-navy px-2 py-0.5 text-xs font-semibold text-white">{c.level_code}</span>
            <div className="text-sm font-medium text-fig-red">{new Date(c.valid_to).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
            <Link to={`/workers/${c.worker_id}/profile`} className="text-xs font-medium text-fig-blue hover:underline">
              Renew
            </Link>
          </div>
        ))}
      </SectionCard>
    </AppShell>
  );
}

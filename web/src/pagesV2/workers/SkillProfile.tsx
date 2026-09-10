import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { StatusBadge, LevelBadge } from "../../components/figma/Badge";
import { Avatar } from "../../components/figma/Avatar";
import { v2 } from "../../lib/apiV2";

interface Enrollment {
  process_id: string;
  process_name: string;
  process_code: string;
  current_level_code: string | null;
  target_level_code: string | null;
  status: string;
}
interface Certificate {
  certificate_id: string;
  certificate_number: string;
  process_name: string;
  level_code: string | null;
  status: string;
  valid_from: string;
  valid_to: string | null;
  issued_at: string;
}
interface SubLevelProgressRow {
  worker_process_sub_level_progress_id: string;
  sub_level_code: string;
  sub_level_name: string;
  status: string;
  percent_complete: number;
  is_mandatory: boolean;
  completed_at: string | null;
  signed_off_by_name: string | null;
}
interface WorkerProfile {
  worker_id: string;
  hrms_employee_code: string;
  first_name: string;
  last_name: string;
  status: string;
  employment_type: string;
  date_of_joining: string | null;
  designation: string | null;
  org_unit_name: string;
  data_source_name: string | null;
  hasSelfAssessPin: boolean;
  enrollments: Enrollment[];
  certificates: Certificate[];
}

type Tab = "profile" | "card" | "passport";

export function SkillProfile() {
  const { workerId } = useParams<{ workerId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = (location.state as { openTab?: Tab } | null)?.openTab ?? "profile";
  const [tab, setTab] = useState<Tab>(initialTab);
  const { data: profile } = useQuery({ queryKey: ["worker-profile", workerId], queryFn: () => v2.get<WorkerProfile>(`/workers/${workerId}/profile`) });
  const { data: subLevelProgress } = useQuery({
    queryKey: ["worker-sub-level-progress", workerId],
    queryFn: () => v2.get<SubLevelProgressRow[]>(`/workers/${workerId}/sub-level-progress`),
    enabled: !!workerId,
  });

  const primaryCert = useMemo(() => profile?.certificates.find((c) => c.status === "active") ?? profile?.certificates[0], [profile]);

  if (!profile) {
    return (
      <AppShell breadcrumbs={[{ label: "Workers", to: "/workers/search" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading…</div>
      </AppShell>
    );
  }

  const fullName = `${profile.first_name} ${profile.last_name}`;

  return (
    <AppShell breadcrumbs={[{ label: "Workers", to: "/workers/search" }, { label: fullName, to: `/workers/${workerId}/profile` }, { label: tab === "profile" ? "Skill Profile" : tab === "card" ? "Skill Card" : "Skill Passport" }]}>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={fullName} />
          <div>
            <div className="text-xl font-bold text-fig-text">{fullName}</div>
            <div className="text-sm text-fig-muted">
              {profile.hrms_employee_code} · {profile.designation ?? profile.enrollments[0]?.process_name ?? profile.org_unit_name}
            </div>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-fig-border text-sm font-medium">
          {(["profile", "card", "passport"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 ${tab === t ? "bg-fig-navy text-white" : "bg-white text-fig-text hover:bg-fig-bg"}`}
            >
              {t === "profile" ? "Skill Profile" : t === "card" ? "Skill Card" : "Skill Passport"}
            </button>
          ))}
        </div>
      </div>

      {tab === "profile" && (
        <div className="grid grid-cols-3 gap-4">
          <SectionCard className="col-span-1">
            <div className="flex flex-col items-center text-center">
              <Avatar name={fullName} size="lg" />
              <div className="mt-2 text-base font-bold text-fig-text">{fullName}</div>
              <div className="text-xs text-fig-muted">{profile.hrms_employee_code}</div>
              <div className="mt-1.5">
                <StatusBadge status={profile.status} />
              </div>
            </div>
            <dl className="mt-5 space-y-2.5 border-t border-fig-border pt-4 text-sm">
              <Row label="Designation" value={profile.designation ?? "—"} />
              <Row label="Employee Type" value={profile.employment_type} />
              <Row label="Date of Joining" value={profile.date_of_joining ? new Date(profile.date_of_joining).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
              <Row label="Department" value={profile.org_unit_name} />
              <Row label="Source System" value={profile.data_source_name ?? "OWorkly"} />
              <div className="flex items-center justify-between">
                <dt className="text-fig-muted">Self-Assess PIN</dt>
                <dd>
                  <span className="rounded-md bg-fig-bg px-2 py-1 text-xs font-medium text-fig-text">
                    {profile.hasSelfAssessPin ? "🔐 Change PIN" : "Not set"}
                  </span>
                </dd>
              </div>
            </dl>
          </SectionCard>

          <div className="col-span-2 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <MiniKpi value={profile.enrollments.length} label="Enrolled Processes" tone="text-fig-blue" bg="bg-blue-50" />
              <MiniKpi value={profile.enrollments.filter((e) => e.current_level_code).length} label="Levels Achieved" tone="text-fig-green" bg="bg-green-50" />
              <MiniKpi value={profile.org_unit_name} label="Dept" tone="text-fig-navy" bg="bg-fig-bg" small />
            </div>

            <SectionCard title="Process Enrollments" action={<Button variant="secondary" className="text-xs" disabled>+ Enroll in Process</Button>} padded={false}>
              {profile.enrollments.length === 0 && <div className="p-5 text-sm text-fig-muted">Not enrolled in any process yet.</div>}
              {profile.enrollments.map((e) => (
                <button
                  key={e.process_id}
                  onClick={() => navigate(`/assessments/package/new`, { state: { workerId, processId: e.process_id } })}
                  className="flex w-full items-center justify-between border-b border-fig-border px-5 py-3.5 text-left last:border-b-0 hover:bg-fig-bg"
                >
                  <div className="flex items-center gap-3">
                    <LevelBadge code={e.current_level_code} size="md" />
                    <div>
                      <div className="text-sm font-semibold text-fig-text">{e.process_name}</div>
                      <div className="text-xs text-fig-muted">
                        {e.process_code} · Targeting {e.target_level_code ?? "—"}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status="ACTIVE" />
                </button>
              ))}
            </SectionCard>

            {subLevelProgress && subLevelProgress.length > 0 && (
              <SectionCard title="Sub-level Progress" padded={false}>
                {subLevelProgress.map((s) => (
                  <div key={s.worker_process_sub_level_progress_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3 last:border-b-0">
                    <div>
                      <div className="text-sm font-medium text-fig-text">
                        <span className="font-semibold">{s.sub_level_code}</span> · {s.sub_level_name}
                        {!s.is_mandatory && <span className="ml-2 rounded bg-fig-bg px-1.5 py-0.5 text-[10px] font-medium text-fig-muted">optional</span>}
                      </div>
                      {s.signed_off_by_name && <div className="text-xs text-fig-muted">Signed off by {s.signed_off_by_name}</div>}
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        s.status === "completed" ? "bg-green-50 text-fig-green" : s.status === "in_progress" ? "bg-orange-50 text-fig-orange" : "bg-fig-bg text-fig-muted"
                      }`}
                    >
                      {s.status === "completed" ? "✓ Complete" : s.status === "in_progress" ? `${s.percent_complete}%` : "Not started"}
                    </span>
                  </div>
                ))}
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {tab === "card" && (
        <SkillCardView
          fullName={fullName}
          empCode={profile.hrms_employee_code}
          cert={primaryCert}
          otherCerts={profile.certificates.filter((c) => c.certificate_id !== primaryCert?.certificate_id)}
          onViewPassport={() => setTab("passport")}
        />
      )}

      {tab === "passport" && <SkillPassportView profile={profile} fullName={fullName} />}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fig-muted">{label}</dt>
      <dd className="font-medium text-fig-text">{value}</dd>
    </div>
  );
}

function MiniKpi({ value, label, tone, bg, small }: { value: string | number; label: string; tone: string; bg: string; small?: boolean }) {
  return (
    <div className={`rounded-fig-card border border-fig-border p-4 text-center ${bg}`}>
      <div className={`font-bold ${tone} ${small ? "text-base" : "text-2xl"}`}>{value}</div>
      <div className="text-xs text-fig-muted">{label}</div>
    </div>
  );
}

function SkillCardView({
  fullName,
  empCode,
  cert,
  otherCerts,
  onViewPassport,
}: {
  fullName: string;
  empCode: string;
  cert?: Certificate;
  otherCerts: Certificate[];
  onViewPassport: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-fig-text">Worker Competency Card</h2>
          <p className="text-sm text-fig-muted">Auto-generated from certification record · Ready to print</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">👁 Print Preview</Button>
          <Button variant="secondary">🖨 Print</Button>
          <Button onClick={onViewPassport}>View Passport →</Button>
        </div>
      </div>

      {!cert ? (
        <div className="rounded-fig-card border border-dashed border-fig-border bg-white p-10 text-center text-sm text-fig-muted">
          No certificate issued yet — complete a qualification to generate a Skill Card.
        </div>
      ) : (
        <>
          <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-fig-border bg-white shadow-fig-card">
            <div className="flex items-center justify-between bg-fig-navy px-4 py-2.5 text-white">
              <span className="text-xs font-bold tracking-wide">🛡 OWORKLY</span>
              <span className="text-[10px] text-white/70">{cert.certificate_number}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-fig-blue text-sm font-bold text-white">
                {fullName.split(" ").map((s) => s[0]).slice(0, 2).join("")}
              </span>
              <div>
                <div className="text-sm font-bold text-fig-text">{fullName}</div>
                <div className="text-xs text-fig-muted">{empCode}</div>
              </div>
            </div>
            <div className="flex items-center justify-between bg-fig-green px-4 py-2 text-white">
              <span className="text-sm font-semibold">{cert.process_name}</span>
              <span className="text-base font-bold">{cert.level_code}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs">
              <div>
                <div className="text-fig-muted">VALID FROM</div>
                <div className="font-medium text-fig-text">{new Date(cert.valid_from).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
              <div>
                <div className="text-fig-muted">VALID UNTIL</div>
                <div className="font-medium text-fig-text">{cert.valid_to ? new Date(cert.valid_to).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"}</div>
              </div>
            </div>
            {otherCerts.length > 0 && (
              <div className="px-4 pb-2">
                <div className="text-[10px] text-fig-muted">ADDITIONAL CERTIFICATIONS</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {otherCerts.map((c) => (
                    <span key={c.certificate_id} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-blue">
                      {c.level_code} · {c.process_name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-fig-border px-4 py-2 text-[10px] text-fig-muted">
              <span>QID: {cert.certificate_number}</span>
              <span className="text-fig-green">✓ Verified</span>
            </div>
          </div>

          <SectionCard title="Auto-Generated Details" className="mt-5">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <Row label="Generated On" value={new Date(cert.issued_at).toLocaleString()} />
              <Row label="Data Source" value="OWorkly Platform" />
              <Row label="Template" value="Standard Competency Card v2.1" />
              <Row label="Format" value="Print-ready PDF, 85×54mm (CR80)" />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function SkillPassportView({ profile, fullName }: { profile: WorkerProfile; fullName: string }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-bold text-fig-text">Digital Worker Skill Passport</h2>
        <StatusBadge status="ACTIVE" label="Auto-Updated" />
      </div>

      <SectionCard className="mb-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <Avatar name={fullName} />
            <div>
              <div className="text-xs text-fig-muted">Name</div>
              <div className="text-sm font-semibold text-fig-text">{fullName}</div>
            </div>
          </div>
          <Field label="Employee ID" value={profile.hrms_employee_code} />
          <Field label="Department" value={profile.org_unit_name} />
          <Field label="Multi-Skill" value={`${profile.enrollments.length} Process${profile.enrollments.length === 1 ? "" : "es"}`} />
        </div>
      </SectionCard>

      <SectionCard title="Process Certifications" padded={false} className="mb-4">
        {profile.enrollments.length === 0 && <div className="p-5 text-sm text-fig-muted">No process certifications yet.</div>}
        {profile.enrollments.map((e) => (
          <div key={e.process_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <LevelBadge code={e.current_level_code} size="md" />
              <div>
                <div className="text-sm font-semibold text-fig-text">{e.process_name}</div>
                <div className="text-xs text-fig-muted">
                  CWE-{e.process_code}-{e.current_level_code}-{profile.hrms_employee_code.replace("EMP-", "")}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs">
                <div className="text-fig-muted">Level</div>
                <div className="font-medium text-fig-blue">
                  {e.current_level_code} · {e.status}
                </div>
              </div>
              <StatusBadge status="ACTIVE" />
            </div>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Multi-Skill Profile">
        {profile.enrollments.map((e) => (
          <div key={e.process_id} className="mb-3 flex items-center gap-3 last:mb-0">
            <span className="w-40 shrink-0 text-sm font-medium text-fig-text">{e.process_name}</span>
            <div className="flex gap-1">
              {["E1", "E2", "E3", "E4", "E5"].map((lvl) => (
                <span
                  key={lvl}
                  className={`flex h-6 w-8 items-center justify-center rounded text-[11px] font-semibold ${
                    lvl === e.current_level_code ? "bg-fig-blue text-white" : "bg-fig-bg text-fig-muted"
                  }`}
                >
                  {lvl}
                </span>
              ))}
            </div>
            <span className="text-xs text-fig-muted">Current: {e.current_level_code}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fig-muted">{label}</div>
      <div className="text-sm font-semibold text-fig-text">{value}</div>
    </div>
  );
}

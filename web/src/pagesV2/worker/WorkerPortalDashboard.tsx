import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { WorkerShell } from "../../shell/WorkerShell";
import { useAuthV2 } from "../../lib/AuthV2Context";
import { v2, qual, idempotencyKey, ApiV2Error } from "../../lib/apiV2";
import { Avatar } from "../../components/figma/Avatar";
import { StatusBadge } from "../../components/figma/Badge";
import { useState } from "react";

interface Enrollment {
  process_id: string;
  process_name: string;
  process_code: string;
  current_level_code: string | null;
  target_level_code: string | null;
  status: string;
}

interface WorkerProfile {
  worker_id: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  job_role_name?: string;
  designation?: string;
  status: string;
  org_unit_name: string;
  enrollments: Enrollment[];
}

export function WorkerPortalDashboard() {
  const { user } = useAuthV2();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["worker-portal-profile", user?.workerId],
    queryFn: () => v2.get<WorkerProfile>(`/workers/${user!.workerId}/profile`),
    enabled: !!user?.workerId,
  });

  async function startSelfAssessment(enrollment: Enrollment) {
    if (!profile) return;
    setStarting(enrollment.process_id);
    setStartError(null);
    try {
      // Resolve the target process level id from the levels list (the
      // enrollment only carries the level *code*). A worker fresh off a
      // certification has no explicit target set yet (it's cleared on
      // certify) — falling back to the first level in the list (E1) would
      // pick a level with no assessment package configured for someone
      // already well past it. Fall back to "one ordinal above current"
      // instead, the same natural default the seed data itself uses.
      const levels = await v2.get<{ levels: { process_level_id: string; code: string; ordinal: number }[] }>(`/processes/${enrollment.process_id}/levels`);
      const currentLevel = levels.levels.find((l) => l.code === enrollment.current_level_code);
      const nextLevel = currentLevel ? levels.levels.find((l) => l.ordinal === currentLevel.ordinal + 1) : undefined;
      const targetLevel = levels.levels.find((l) => l.code === enrollment.target_level_code) ?? nextLevel ?? levels.levels[0];

      const qcase = await qual.post<{ qualification_case_id: string }>(
        "/qualification-cases",
        { workerId: profile.worker_id, processId: enrollment.process_id, targetProcessLevelId: targetLevel.process_level_id },
        idempotencyKey("wp-qc")
      );
      const attempt = await qual.post<{ assessment_attempt_id: string }>(
        `/qualification-cases/${qcase.qualification_case_id}/attempts`,
        {},
        idempotencyKey("wp-attempt")
      );
      navigate(`/worker/quiz/${attempt.assessment_attempt_id}`);
    } catch (err) {
      setStartError(
        err instanceof ApiV2Error && err.status === 422
          ? "No self-assessment is configured for your next level yet — check back later or ask your Supervisor."
          : "Couldn't start self-assessment. Please try again."
      );
    } finally {
      setStarting(null);
    }
  }

  return (
    <WorkerShell>
      {isLoading || !profile ? (
        <div className="py-16 text-center text-sm text-fig-muted">Loading…</div>
      ) : (
        <>
          <div className="mb-6 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fig-muted">Welcome</div>
            <div className="flex items-center gap-4">
              <Avatar name={`${profile.first_name} ${profile.last_name}`} size="lg" />
              <div>
                <div className="text-lg font-bold text-fig-text">
                  {profile.first_name} {profile.last_name}
                </div>
                <div className="text-sm text-fig-muted">
                  {profile.designation ?? profile.job_role_name} · {profile.org_unit_name}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-fig-muted">
                  <StatusBadge status={profile.status} /> · {profile.hrms_employee_code}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fig-text">⚡ Available Self-Assessments</div>
          <div className="space-y-3">
            {profile.enrollments.length === 0 && (
              <div className="rounded-fig-card border border-dashed border-fig-border bg-white p-6 text-center text-sm text-fig-muted">
                No process enrollments yet — ask your Supervisor to enroll you.
              </div>
            )}
            {profile.enrollments.map((e) => (
              <div key={e.process_id} className="rounded-fig-card border border-fig-blue/40 bg-white p-4 shadow-fig-card ring-1 ring-fig-blue/10">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fig-navy text-xs font-bold text-white">{e.process_code}</span>
                    <div>
                      <div className="text-sm font-semibold text-fig-text">{e.process_name}</div>
                      <div className="text-xs text-fig-muted">
                        Current: <span className="font-medium text-fig-text">{e.current_level_code ?? "—"}</span> · Targeting{" "}
                        <span className="font-medium text-fig-blue">{e.target_level_code ?? "—"}</span>
                      </div>
                    </div>
                  </div>
                  <StatusBadge status="ACTIVE" />
                </div>
                <button
                  type="button"
                  disabled={starting === e.process_id}
                  onClick={() => startSelfAssessment(e)}
                  className="mt-3 w-full rounded-lg bg-fig-blue py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  {starting === e.process_id ? "Starting…" : e.target_level_code ? `⚡ Start Self-Assessment → ${e.target_level_code}` : "⚡ Start Self-Assessment"}
                </button>
                {startError && starting === null && (
                  <p className="mt-2 text-xs text-fig-red">{startError}</p>
                )}
              </div>
            ))}
          </div>

          <p className="mt-4 text-center text-xs text-fig-muted">
            Self-assessment results are submitted for supervisor review before being counted towards certification.
          </p>
        </>
      )}
    </WorkerShell>
  );
}

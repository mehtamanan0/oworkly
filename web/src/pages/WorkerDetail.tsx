import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { LearningPathCard } from "../components/LearningPathCard";
import { Badge, Card, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function WorkerDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["worker", id],
    queryFn: () => api.get<any>(`/workers/${id}`),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load worker" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {data.first_name} {data.last_name}
        </h1>
        <p className="text-sm text-slate-500">
          {data.hrms_employee_code} · {data.org_unit_name} · {data.job_role_name ?? "No role set"} ·{" "}
          <Badge color={data.employment_type === "contract" ? "amber" : "green"}>{data.employment_type}</Badge>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Process skill levels">
          {data.skills.length === 0 ? (
            <div className="text-sm text-slate-400">Not tracked against any process.</div>
          ) : (
            <div className="space-y-2">
              {data.skills.map((s: any) => (
                <div key={s.process_id} className="flex items-center justify-between text-sm">
                  <span>
                    {s.process_name} {s.is_critical && <Badge color="red">Critical</Badge>}
                  </span>
                  <LevelBadge code={s.level_code} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Certificates">
          {data.certificates.length === 0 ? (
            <div className="text-sm text-slate-400">No certificates issued yet.</div>
          ) : (
            <div className="space-y-2">
              {data.certificates.map((c: any) => (
                <div key={c.certificate_id} className="flex items-center justify-between text-sm">
                  <span>{c.process_name} <LevelBadge code={c.level_code} /></span>
                  <div className="flex items-center gap-2">
                    <Badge color={c.status === "active" ? "green" : "slate"}>{c.status}</Badge>
                    <Link className="text-indigo-600 hover:underline" to={`/verify/${c.qr_verification_token}`} target="_blank">
                      Verify ↗
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Learning paths">
        {data.learningPaths.length === 0 ? (
          <div className="text-sm text-slate-400">No learning path started yet.</div>
        ) : (
          <div className="space-y-2">
            {data.learningPaths.map((p: any) => (
              <LearningPathCard key={p.learning_path_id} path={{ ...p, worker_id: data.worker_id }} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Open skill gaps">
          {data.skillGaps.length === 0 ? (
            <div className="text-sm text-slate-400">None open.</div>
          ) : (
            data.skillGaps.map((g: any) => (
              <div key={g.skill_gap_id} className="flex items-center justify-between text-sm">
                <span>{g.process_name} — {g.gap_type}</span>
                <Badge color="amber">{g.magnitude_pct}% short</Badge>
              </div>
            ))
          )}
        </Card>
        <Card title="Retest cycles">
          {data.retestCycles.length === 0 ? (
            <div className="text-sm text-slate-400">None.</div>
          ) : (
            data.retestCycles.map((r: any) => (
              <div key={r.retest_cycle_id} className="flex items-center justify-between text-sm">
                <span>{r.process_name} — attempt #{r.attempt_no}</span>
                <Badge color={r.status === "resolved_escalated" ? "red" : "slate"}>
                  {r.status === "cooling_period" ? `eligible ${r.eligible_from_date?.slice(0, 10)}` : r.status}
                </Badge>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

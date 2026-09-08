import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, CategoryBadge, ErrorState, LoadingState } from "../components/ui";

export function ProcessDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["process", id],
    queryFn: () => fetch(`/api/v1/processes/${id}`).then((r) => r.json()),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load process" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {data.name} {data.is_critical && <Badge color="red">Critical</Badge>}
        </h1>
        <p className="text-sm text-slate-500">
          {data.code} · {data.org_unit_name}
        </p>
      </div>

      <Card title="Competency framework (per skill level)">
        {data.competencyFramework.length === 0 ? (
          <div className="text-sm text-slate-400">No levels defined.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Level</th>
                <th>Knowledge criteria</th>
                <th>Practical criteria</th>
              </tr>
            </thead>
            <tbody>
              {data.competencyFramework.map((cf: any) => (
                <tr key={cf.competency_framework_id} className="border-t border-slate-100">
                  <td className="py-2"><Badge color="blue">{cf.level_code}</Badge></td>
                  <td className="text-slate-400 italic">{cf.knowledge_criteria || "(for L&D to fill in)"}</td>
                  <td className="text-slate-400 italic">{cf.practical_criteria || "(for L&D to fill in)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Assessment templates">
        {data.assessmentTemplates.length === 0 ? (
          <div className="text-sm text-slate-400">No assessment template configured for this process yet.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.assessmentTemplates.map((t: any) => (
              <li key={t.assessment_template_id} className="flex items-center justify-between">
                <span><Badge color="blue">{t.level_code}</Badge> <CategoryBadge category={t.assessment_category} /> {t.name}</span>
                <Link className="text-indigo-600 hover:underline" to="/assessments">Go to Assessments →</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Weightage config">
          {data.weightage.map((w: any) => (
            <div key={w.assessment_weightage_config_id} className="text-sm">
              <Badge color="blue">{w.level_code}</Badge> Theory {w.theory_weight_pct}% · Practical {w.practical_weight_pct}% · Behaviour {w.behaviour_weight_pct}% · Pass ≥{w.passing_score_pct}%
            </div>
          ))}
        </Card>
        <Card title="Retest policy">
          {data.retestPolicies.map((r: any) => (
            <div key={r.retest_policy_id} className="text-sm">
              <Badge color="blue">{r.level_code}</Badge> {r.cooling_period_days}-day cooling · max {r.max_attempts} attempts
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

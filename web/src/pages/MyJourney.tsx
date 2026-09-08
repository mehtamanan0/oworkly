import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { LearningPathCard } from "../components/LearningPathCard";
import { Card, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function MyJourney() {
  const { currentUser } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["worker", currentUser?.worker_id],
    queryFn: () => api.get<any>(`/workers/${currentUser!.worker_id}`),
    enabled: !!currentUser?.worker_id,
  });

  if (!currentUser?.worker_id) return <Card>This demo user isn't linked to a worker record. Switch to the Employee demo user.</Card>;
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load your journey" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Journey</h1>
        <p className="text-sm text-slate-500">{data.first_name} {data.last_name} · {data.org_unit_name}</p>
      </div>

      <Card title="My current skill levels">
        <div className="space-y-2">
          {data.skills.map((s: any) => (
            <div key={s.process_id} className="flex items-center justify-between text-sm">
              <span>{s.process_name}</span>
              <LevelBadge code={s.level_code} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="My learning paths">
        {data.learningPaths.length === 0 ? (
          <div className="text-sm text-slate-400">No learning path assigned yet.</div>
        ) : (
          <div className="space-y-2">
            {data.learningPaths.map((p: any) => (
              <LearningPathCard key={p.learning_path_id} path={{ ...p, worker_id: data.worker_id }} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

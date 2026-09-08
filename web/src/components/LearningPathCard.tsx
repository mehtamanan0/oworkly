import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, LevelBadge, LoadingState } from "./ui";

function ActivityRow({ activity, workerId, pathId }: { activity: any; workerId: string; pathId: string }) {
  const queryClient = useQueryClient();
  const minPct = Number(activity.min_completion_pct_override ?? activity.min_completion_pct ?? 100);
  const [pct, setPct] = useState(minPct);

  const complete = useMutation({
    mutationFn: () =>
      api.post(`/learning-paths/activities/${activity.learning_path_activity_id}/completions`, {
        completedByWorkerId: workerId,
        completionPct: pct,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learning-path", pathId] }),
  });

  const blockedByAssessment = activity.requires_assessment && !activity.linked_assessment_attempt_id;

  return (
    <div className="flex items-center justify-between text-sm">
      <div>
        <span className={activity.completed_at ? "text-slate-400 line-through" : ""}>{activity.title}</span>
        <span className="ml-2 text-xs text-slate-400">{activity.activity_type}</span>
        {minPct < 100 && <span className="ml-2 text-xs text-slate-400">(min {minPct}%)</span>}
        {activity.requires_assessment && <Badge color="indigo">Requires assessment</Badge>}
      </div>
      {activity.completed_at ? (
        <Badge color={Number(activity.completion_pct) >= minPct ? "green" : "amber"}>
          {Number(activity.completion_pct)}% {Number(activity.completion_pct) >= minPct ? "· Done" : "· Below min"}
        </Badge>
      ) : (
        <div className="flex items-center gap-2">
          {blockedByAssessment && <span className="text-xs italic text-slate-400">modeled, not enforced in MVP</span>}
          <input
            type="number"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-16 rounded-md border border-slate-300 px-1.5 py-1 text-xs"
          />
          <Button variant="secondary" onClick={() => complete.mutate()} disabled={complete.isPending}>
            Mark complete
          </Button>
        </div>
      )}
    </div>
  );
}

export function LearningPathCard({ path }: { path: any }) {
  const [open, setOpen] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["learning-path", path.learning_path_id],
    queryFn: () => api.get<any>(`/learning-paths/${path.learning_path_id}`),
    enabled: open,
  });

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div className="text-sm">
          <span className="font-medium">{path.process_name}</span> → <LevelBadge code={path.target_level_code} />{" "}
          <span className="text-xs text-slate-400">({path.generation_source})</span>
        </div>
        <Badge color={path.status === "eligible_for_assessment" ? "green" : "slate"}>{path.status}</Badge>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {detailQuery.isLoading && <LoadingState />}
          {detailQuery.data?.activities.map((a: any) => (
            <ActivityRow key={a.learning_path_activity_id} activity={a} workerId={path.worker_id} pathId={path.learning_path_id} />
          ))}
        </div>
      )}
    </div>
  );
}

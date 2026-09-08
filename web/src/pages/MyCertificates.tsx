import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Badge, Card, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function MyCertificates() {
  const { currentUser } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["worker", currentUser?.worker_id],
    queryFn: () => api.get<any>(`/workers/${currentUser!.worker_id}`),
    enabled: !!currentUser?.worker_id,
  });

  if (!currentUser?.worker_id) return <Card>This demo user isn't linked to a worker record. Switch to the Employee demo user.</Card>;
  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load certificates" />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My Certificates</h1>
      <Card>
        {data.certificates.length === 0 ? (
          <div className="text-sm text-slate-400">No certificates yet — pass an assessment to earn one.</div>
        ) : (
          <div className="space-y-3">
            {data.certificates.map((c: any) => (
              <div key={c.certificate_id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <div className="font-medium">{c.process_name}</div>
                  <div className="text-xs text-slate-400">{c.certificate_number}</div>
                </div>
                <div className="flex items-center gap-2">
                  <LevelBadge code={c.level_code} />
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
  );
}

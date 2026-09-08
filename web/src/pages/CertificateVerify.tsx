import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { Badge, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function CertificateVerify() {
  const { qrToken } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify", qrToken],
    queryFn: () => api.get<any>(`/public/verify/${qrToken}`),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-indigo-600">
          Oworkly LMS — Certificate Verification
        </div>
        {isLoading && <LoadingState />}
        {(error || !data) && !isLoading && <ErrorState message="Invalid or unrecognized certificate token." />}
        {data && (
          <div className="space-y-3 text-center">
            <div className="text-xl font-bold">{data.first_name} {data.last_name}</div>
            <div className="text-sm text-slate-500">{data.process_name}</div>
            <div className="flex justify-center"><LevelBadge code={data.level_code} /></div>
            <div className="flex justify-center gap-2">
              <Badge color={data.status === "active" ? "green" : "red"}>{data.status.toUpperCase()}</Badge>
              <Badge>{data.certificate_type.replace(/_/g, " ")}</Badge>
            </div>
            <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">
              Certificate # {data.certificate_number}<br />
              Issued {new Date(data.issued_at).toLocaleDateString()} · Valid from {String(data.valid_from).slice(0, 10)}
              {data.valid_to ? ` to ${String(data.valid_to).slice(0, 10)}` : " (no expiry)"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

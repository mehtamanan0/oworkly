import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Badge, Card, ErrorState, LevelBadge, LoadingState } from "../components/ui";

export function Certificates() {
  const { data, isLoading, error } = useQuery({ queryKey: ["certificates"], queryFn: () => api.get<any[]>("/certificates") });

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Could not load certificates" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Certificates</h1>
        <p className="text-sm text-slate-500">Module 4 — Digital Competency Cards issued on a PASS outcome, with public QR verification.</p>
      </div>
      <Card className="!p-0">
        {data.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No certificates issued yet — run an assessment to PASS to see one appear here.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Certificate #</th>
                <th>Worker</th>
                <th>Process</th>
                <th>Level</th>
                <th>Status</th>
                <th>Issued</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.certificate_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs">{c.certificate_number}</td>
                  <td>{c.first_name} {c.last_name} <span className="text-xs text-slate-400">({c.hrms_employee_code})</span></td>
                  <td>{c.process_name}</td>
                  <td><LevelBadge code={c.level_code} /></td>
                  <td><Badge color={c.status === "active" ? "green" : "slate"}>{c.status}</Badge></td>
                  <td className="text-slate-500">{new Date(c.issued_at).toLocaleDateString()}</td>
                  <td>
                    <Link className="text-indigo-600 hover:underline" to={`/verify/${c.qr_verification_token}`} target="_blank">
                      Public verify ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

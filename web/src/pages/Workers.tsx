import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Worker } from "../lib/api";
import { Badge, Card, ErrorState, LoadingState } from "../components/ui";

export function Workers() {
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["workers", q],
    queryFn: () => api.get<Worker[]>(`/workers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Worker Roster</h1>
          <p className="text-sm text-slate-500">Real workers ingested from the WTG Daman skill matrix workbook.</p>
        </div>
        <input
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Search name or employee code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message="Could not load workers" />}
      {data && (
        <Card className="!p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th>Emp Code</th>
                <th>Org Unit</th>
                <th>Job Role</th>
                <th>Employment</th>
                <th>Processes tracked</th>
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.worker_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/workers/${w.worker_id}`} className="font-medium text-indigo-700 hover:underline">
                      {w.first_name} {w.last_name}
                    </Link>
                  </td>
                  <td className="font-mono text-xs text-slate-500">{w.hrms_employee_code}</td>
                  <td className="text-slate-500">{w.org_unit_name}</td>
                  <td className="text-slate-500">{w.job_role_name ?? "–"}</td>
                  <td>
                    <Badge color={w.employment_type === "contract" ? "amber" : "green"}>{w.employment_type}</Badge>
                  </td>
                  <td className="font-mono">{w.process_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

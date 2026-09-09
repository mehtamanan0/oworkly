import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { Button } from "../../components/figma/Button";
import { LevelBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";

interface WorkerRow {
  worker_id: string;
  hrms_employee_code: string;
  first_name: string;
  last_name: string;
  employment_type: string;
  designation: string | null;
  process_name: string | null;
  level_code: string | null;
}

export function WorkerSearch() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { data: workers, isLoading } = useQuery({
    queryKey: ["worker-search", q],
    queryFn: () => v2.get<WorkerRow[]>(`/workers/search${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  return (
    <AppShell breadcrumbs={[{ label: "Workers", to: "/workers" }, { label: "Search" }]}>
      <PageHeader title="Worker Search" description="Search by name or employee ID to begin assessment" />

      <div className="mb-5 flex gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fig-muted">🔍</span>
          {/* Deliberately no autoFocus here: this list can grow to 100+ rows
              once results load, and a focused element combined with that
              late layout shift made the browser scroll to a nonsensical
              position on page load (bug found via a visual QA pass). */}
          <input
            className="w-full rounded-lg border border-fig-border py-2.5 pl-9 pr-3 text-sm focus:border-fig-blue focus:outline-none"
            placeholder="Search by name or employee ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="secondary">🔄 Scan Badge</Button>
      </div>

      <div className="rounded-fig-card border border-fig-border bg-white shadow-fig-card">
        <div className="flex items-center justify-between border-b border-fig-border px-5 py-3 text-xs text-fig-muted">
          <span>{isLoading ? "Searching…" : `${workers?.length ?? 0} workers found`}</span>
          <span>Select a worker to view their profile</span>
        </div>
        {workers?.map((w) => (
          <button
            key={w.worker_id}
            type="button"
            onClick={() => navigate(`/workers/${w.worker_id}/profile`)}
            className="flex w-full items-center justify-between border-b border-fig-border px-5 py-3 text-left last:border-b-0 hover:bg-fig-bg"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fig-navy text-xs font-semibold text-white">
                {w.first_name[0]}
                {w.last_name?.[0]}
              </span>
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-fig-text">
                  {w.first_name} {w.last_name}
                  <span className="text-xs font-normal text-fig-muted">{w.employment_type}</span>
                </div>
                <div className="text-xs text-fig-muted">
                  {w.hrms_employee_code} · {w.designation}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[11px] text-fig-muted">Current Process</div>
                <div className="text-sm font-medium text-fig-text">{w.process_name ?? "Not enrolled"}</div>
              </div>
              <LevelBadge code={w.level_code} />
            </div>
          </button>
        ))}
        {workers?.length === 0 && <div className="p-8 text-center text-sm text-fig-muted">No workers match "{q}".</div>}
      </div>
      <p className="mt-3 text-center text-xs text-fig-muted">
        Click on any worker to select them, then click <span className="font-medium text-fig-text">View Profile</span>.
      </p>
    </AppShell>
  );
}

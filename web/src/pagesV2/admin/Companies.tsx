import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { Button } from "../../components/figma/Button";
import { StatusBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface Company {
  company_id: string;
  code: string;
  name: string;
  industry: string | null;
  status: string;
  hierarchy_level_count: number;
  process_count: number;
  active_worker_count: number;
}

export function Companies() {
  const { user } = useAuthV2();
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Companies" }]}>
      <PageHeader title="Companies" description="Manage client companies. The active company drives all admin configuration screens." action={<Button disabled>+ Add Company</Button>} />

      <div className="grid grid-cols-2 gap-4">
        {companies?.map((c) => (
          <div key={c.company_id} className={`rounded-fig-card border-2 bg-white p-5 shadow-fig-card ${c.status === "ACTIVE" ? "border-fig-blue" : "border-fig-border"}`}>
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fig-navy text-xs font-bold text-white">{c.code}</span>
                <div>
                  <div className="text-sm font-semibold text-fig-text">{c.name}</div>
                  <div className="text-xs text-fig-muted">
                    {c.industry ?? "—"} · {c.code}
                  </div>
                </div>
              </div>
              {c.status === "ACTIVE" ? <span className="text-fig-green">✓</span> : <span className="text-fig-orange">○</span>}
            </div>
            <div className="mb-1.5">
              <StatusBadge status={c.status} />
            </div>
            <div className="mb-4 grid grid-cols-3 gap-3 rounded-lg bg-fig-bg p-3 text-center">
              <div>
                <div className="text-sm font-bold text-fig-text">{c.hierarchy_level_count || "Not set"}</div>
                <div className="text-[11px] text-fig-muted">Hierarchy</div>
              </div>
              <div>
                <div className="text-sm font-bold text-fig-text">{c.process_count}</div>
                <div className="text-[11px] text-fig-muted">Processes</div>
              </div>
              <div>
                <div className="text-sm font-bold text-fig-text">{c.active_worker_count}</div>
                <div className="text-[11px] text-fig-muted">Workers</div>
              </div>
            </div>
            <div className="flex gap-2">
              {c.status !== "ACTIVE" && user?.companyId === null && (
                <Button variant="secondary" className="flex-1 justify-center" disabled>
                  Set as Active
                </Button>
              )}
              <Link to="/admin/org-hierarchy" className="flex-1">
                <Button variant={c.status === "ACTIVE" ? "primary" : "secondary"} className="w-full justify-center">
                  Configure →
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

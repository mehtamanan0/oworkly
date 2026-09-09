import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { KpiCard } from "../../components/figma/KpiCard";
import { SectionCard } from "../../components/figma/SectionCard";
import { StatusBadge } from "../../components/figma/Badge";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface Company {
  company_id: string;
  code: string;
  name: string;
  status: string;
  hierarchy_level_count: number;
  process_count: number;
  active_worker_count: number;
}

const TILES = [
  { key: "companies", icon: "🏢", title: "Companies", desc: "Manage client companies and set the active company context", to: "/admin/companies" },
  { key: "hierarchy", icon: "🗂️", title: "Org Hierarchy", desc: "Configure flexible hierarchy levels and build the org tree", to: "/admin/org-hierarchy" },
  { key: "processes", icon: "📐", title: "Processes & Levels", desc: "Define processes, competency levels, sub-levels and headcount targets", to: "/admin/processes" },
  { key: "assessments", icon: "📖", title: "Assessment Config", desc: "Build assessment templates, question banks, and level links with weightage", to: "/admin/assessments/library" },
  { key: "skillmatrix", icon: "🎛️", title: "Skill Matrix Config", desc: "Configure skill matrix layouts, level colours, and display rules", to: "/admin/skill-matrix-config" },
  { key: "primarylevels", icon: "🎚️", title: "Primary Levels", desc: "Define global L1-L4 levels used across all processes for reporting", to: "/admin/processes" },
];

export function AdminOverview() {
  const { user } = useAuthV2();
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const { data: assessmentDefs } = useQuery({ queryKey: ["assessment-definitions"], queryFn: () => v2.get<unknown[]>("/assessment-definitions") });
  const active = companies?.find((c) => c.status === "ACTIVE") ?? companies?.[0];
  const totals = companies?.reduce(
    (acc, c) => ({ processes: acc.processes + c.process_count, workers: acc.workers + c.active_worker_count }),
    { processes: 0, workers: 0 }
  );

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Overview" }]}>
      <PageHeader
        title="Admin Configuration"
        description="Manage master data, org structure, processes, and assessment configuration"
        action={
          active && (
            <div className="flex items-center gap-2 rounded-lg border border-fig-border bg-white px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fig-navy text-[10px] font-bold text-white">{active.code}</span>
              <div className="text-xs">
                <div className="font-semibold text-fig-text">{active.name}</div>
                <div className="text-fig-muted">Active company context</div>
              </div>
              <Link to="/admin/companies" className="ml-2 text-xs font-medium text-fig-blue">
                Switch
              </Link>
            </div>
          )
        }
      />

      <div className="mb-5 grid grid-cols-4 gap-4">
        <KpiCard value={companies?.length ?? "—"} label="Companies" icon="🏢" />
        <KpiCard value={totals?.processes ?? "—"} label="Processes" tone="purple" icon="📐" />
        <KpiCard value={assessmentDefs?.length ?? "—"} label="Assessments" tone="green" icon="📖" />
        <KpiCard value={totals?.workers ?? "—"} label="Workers" tone="orange" icon="👥" />
      </div>

      <div className="mb-5 grid grid-cols-3 gap-4">
        {TILES.map((t) => (
          <Link key={t.key} to={t.to} className="rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card hover:border-fig-blue/40">
            <div className="flex items-start justify-between">
              <span className="text-xl">{t.icon}</span>
              <span className="text-fig-muted">→</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-fig-text">{t.title}</div>
            <div className="text-xs text-fig-muted">{t.desc}</div>
          </Link>
        ))}
      </div>

      <SectionCard title="Company Setup Status" action={<Link to="/admin/companies" className="text-xs font-medium text-fig-blue">Manage Companies →</Link>} padded={false}>
        {companies?.map((c) => (
          <div key={c.company_id} className="flex items-center justify-between border-b border-fig-border px-5 py-3.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fig-navy text-xs font-bold text-white">{c.code}</span>
              <div>
                <div className="text-sm font-semibold text-fig-text">{c.name}</div>
                <StatusBadge status={c.status} />
              </div>
            </div>
            <div className="flex items-center gap-8 text-center text-sm">
              <div>
                <div className="font-semibold text-fig-text">{c.process_count}</div>
                <div className="text-[11px] text-fig-muted">Processes</div>
              </div>
              <div>
                <div className="font-semibold text-fig-text">{c.active_worker_count}</div>
                <div className="text-[11px] text-fig-muted">Workers</div>
              </div>
              <span className={`text-xs font-medium ${c.status === "ACTIVE" ? "text-fig-green" : "text-fig-orange"}`}>
                {c.status === "ACTIVE" ? "✓ Configured" : "○ Incomplete"}
              </span>
            </div>
          </div>
        ))}
      </SectionCard>

      <div className="mt-5 rounded-fig-card border border-fig-border bg-white p-5 shadow-fig-card">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-fig-text">🧱 Platform Architecture</div>
        <p className="text-xs leading-relaxed text-fig-muted">
          OWorkly uses a flexible hierarchy — any depth, any level names (Vertical, Division, Plant, Team…). Processes attach to any node in that tree. Each
          process defines its own competency levels (E1-E5) with sub-levels and criteria. Primary Levels (L1-L4) provide cross-process reporting consistency.
          Assessments are reusable templates linked to levels with configurable weightage and gate thresholds.
        </p>
      </div>

      {user?.companyId === null && <p className="mt-3 text-center text-xs text-fig-muted">Signed in as Platform Admin — viewing across all companies.</p>}
    </AppShell>
  );
}

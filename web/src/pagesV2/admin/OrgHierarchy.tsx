import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface LevelType {
  org_level_type_id: string;
  code: string;
  name: string;
  sequence: number;
}
interface Unit {
  org_unit_id: string;
  parent_org_unit_id: string | null;
  code: string;
  name: string;
  level_type_code: string;
  level_type_name: string;
  level_sequence: number;
  head_worker_id: string | null;
  head_first_name: string | null;
  head_last_name: string | null;
}
interface Company {
  company_id: string;
  code: string;
  name: string;
}

export function OrgHierarchy() {
  const { user } = useAuthV2();
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];
  const { data } = useQuery({
    queryKey: ["hierarchy", company?.company_id],
    queryFn: () => v2.get<{ levelTypes: LevelType[]; units: Unit[] }>(`/companies/${company!.company_id}/hierarchy`),
    enabled: !!company,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<string | null, Unit[]>();
    for (const u of data?.units ?? []) {
      const key = u.parent_org_unit_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return map;
  }, [data]);

  const root = (data?.units ?? []).find((u) => !u.parent_org_unit_id);
  const selected = data?.units.find((u) => u.org_unit_id === selectedId) ?? root;

  if (!data || !company) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Org Hierarchy" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Org Hierarchy" }]}>
      <PageHeader
        title="Org Hierarchy"
        description={`${company.name} · ${data.levelTypes.length} hierarchy levels · ${data.units.length} nodes`}
        action={
          <>
            <Button variant="secondary" disabled>+ Add Level Type</Button>
            <Button disabled>+ Add Node</Button>
          </>
        }
      />

      <div className="mb-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fig-muted">Hierarchy Level Types ({data.levelTypes.length})</div>
        <div className="flex flex-wrap gap-2">
          {data.levelTypes.map((lt) => (
            <span key={lt.org_level_type_id} className="rounded-full bg-fig-bg px-3 py-1 text-xs font-medium text-fig-text">
              #{lt.sequence} {lt.name}
              {lt.sequence === data.levelTypes.length && <span className="ml-1 text-fig-muted">(leaf)</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <SectionCard title="Org Tree" padded={false} className="col-span-1">
          <div className="max-h-[600px] overflow-y-auto p-2 text-sm">
            {root && <TreeNode unit={root} byParent={byParent} depth={0} selectedId={selected?.org_unit_id ?? null} onSelect={setSelectedId} />}
          </div>
        </SectionCard>

        {selected && (
          <div className="col-span-2 space-y-4">
            <SectionCard>
              <div className="mb-1 text-xs text-fig-muted">{company.name}</div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-bold text-fig-text">{selected.name}</h3>
                {(byParent.get(selected.org_unit_id)?.length ?? 0) === 0 && (
                  <Button variant="secondary" disabled>
                    + Add child
                  </Button>
                )}
              </div>
              <div className="mb-3 flex gap-2">
                <span className="rounded bg-fig-bg px-2 py-0.5 text-xs font-medium text-fig-muted">{selected.code}</span>
                <span className="rounded bg-fig-bg px-2 py-0.5 text-xs font-medium text-fig-muted">{selected.level_type_name}</span>
              </div>
              <div className="flex items-center justify-between border-t border-fig-border pt-3 text-sm">
                <span className="text-fig-muted">👤 Department Head</span>
                {selected.head_worker_id ? (
                  <span className="font-medium text-fig-text">
                    {selected.head_first_name} {selected.head_last_name}
                  </span>
                ) : (
                  <>
                    <span className="text-fig-muted">No head assigned yet</span>
                    <button className="text-xs font-medium text-fig-blue">Assign</button>
                  </>
                )}
              </div>
            </SectionCard>

            <SectionCard title={`${data.levelTypes.find((lt) => lt.sequence === selected.level_sequence + 1)?.name ?? "Children"} (${byParent.get(selected.org_unit_id)?.length ?? 0})`} padded={false}>
              {(byParent.get(selected.org_unit_id) ?? []).length === 0 && <div className="p-5 text-sm text-fig-muted">No child nodes.</div>}
              {(byParent.get(selected.org_unit_id) ?? []).map((child) => (
                <button
                  key={child.org_unit_id}
                  onClick={() => setSelectedId(child.org_unit_id)}
                  className="flex w-full items-center justify-between border-b border-fig-border px-5 py-3 text-left last:border-b-0 hover:bg-fig-bg"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fig-navy text-[10px] font-bold text-white">{child.code.slice(0, 2)}</span>
                    <div>
                      <div className="text-sm font-medium text-fig-text">{child.name}</div>
                      <div className="text-xs text-fig-muted">
                        {(byParent.get(child.org_unit_id) ?? []).length} child nodes
                      </div>
                    </div>
                  </div>
                  <span className="text-fig-muted">›</span>
                </button>
              ))}
            </SectionCard>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function TreeNode({
  unit,
  byParent,
  depth,
  selectedId,
  onSelect,
}: {
  unit: Unit;
  byParent: Map<string | null, Unit[]>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const children = byParent.get(unit.org_unit_id) ?? [];
  return (
    <div>
      <button
        onClick={() => onSelect(unit.org_unit_id)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded py-1.5 pr-2 text-left text-xs ${
          selectedId === unit.org_unit_id ? "bg-blue-50 font-medium text-fig-blue" : "text-fig-text hover:bg-fig-bg"
        }`}
      >
        {children.length > 0 && <span className="text-fig-muted">▾</span>}
        <span className="text-[10px] uppercase text-fig-muted">{unit.level_type_code}</span>
        <span className="truncate">{unit.name}</span>
      </button>
      {children.map((c) => (
        <TreeNode key={c.org_unit_id} unit={c} byParent={byParent} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

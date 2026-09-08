import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type OrgUnit, type Process } from "../lib/api";
import { Badge, Card, ErrorState, LoadingState } from "../components/ui";

function OrgNode({ node, selected, onSelect }: { node: OrgUnit; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="ml-2">
      <button
        onClick={() => onSelect(node.org_unit_id)}
        className={`my-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
          selected === node.org_unit_id ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-50"
        }`}
      >
        <Badge color={node.unit_type === "PLANT" ? "indigo" : "slate"}>{node.unit_type}</Badge>
        {node.name}
      </button>
      {node.children && node.children.length > 0 && (
        <div className="ml-3 border-l border-slate-200 pl-2">
          {node.children.map((c) => (
            <OrgNode key={c.org_unit_id} node={c} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgStructure() {
  const [selectedOrgUnit, setSelectedOrgUnit] = useState<string | null>(null);
  const treeQuery = useQuery({ queryKey: ["org-tree"], queryFn: () => api.get<OrgUnit[]>("/org-units/tree") });
  const processesQuery = useQuery({
    queryKey: ["processes", selectedOrgUnit],
    queryFn: () => api.get<Process[]>(`/processes${selectedOrgUnit ? `?orgUnitId=${selectedOrgUnit}` : ""}`),
  });

  if (treeQuery.isLoading) return <LoadingState />;
  if (treeQuery.error || !treeQuery.data) return <ErrorState message="Could not load org structure" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Org Structure & Processes</h1>
        <p className="text-sm text-slate-500">Plant → Area → Process, ingested from the real workbook header + process bands.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Org tree" className="md:col-span-1">
          <button
            onClick={() => setSelectedOrgUnit(null)}
            className={`mb-1 block w-full rounded-md px-2 py-1 text-left text-sm ${!selectedOrgUnit ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-50"}`}
          >
            All processes
          </button>
          {treeQuery.data.map((n) => (
            <OrgNode key={n.org_unit_id} node={n} selected={selectedOrgUnit} onSelect={setSelectedOrgUnit} />
          ))}
        </Card>
        <Card title="Processes" className="md:col-span-2">
          {processesQuery.isLoading && <LoadingState />}
          {processesQuery.data && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Code</th>
                  <th>Name</th>
                  <th>Area</th>
                  <th>Critical</th>
                  <th>Required HC (L2/L3/L4)</th>
                </tr>
              </thead>
              <tbody>
                {processesQuery.data.map((p) => (
                  <tr key={p.process_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2">
                      <Link to={`/processes/${p.process_id}`} className="font-mono text-xs text-indigo-600 hover:underline">
                        {p.code}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/processes/${p.process_id}`} className="hover:underline">{p.name}</Link>
                    </td>
                    <td className="text-slate-500">{p.org_unit_name}</td>
                    <td>{p.is_critical ? <Badge color="red">Critical</Badge> : <Badge>Standard</Badge>}</td>
                    <td className="font-mono text-xs text-slate-500">
                      {p.required_headcount_l2 ?? "–"} / {p.required_headcount_l3 ?? "–"} / {p.required_headcount_l4 ?? "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

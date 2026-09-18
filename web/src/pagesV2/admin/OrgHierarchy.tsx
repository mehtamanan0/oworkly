import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface LevelType {
  org_level_type_id: string;
  code: string;
  name: string;
  sequence: number;
  is_leaf: boolean;
  is_active: boolean;
}
interface Unit {
  org_unit_id: string;
  parent_org_unit_id: string | null;
  code: string;
  name: string;
  org_level_type_id: string;
  level_type_code: string;
  level_type_name: string;
  level_sequence: number;
  is_active: boolean;
  head_worker_id: string | null;
  head_first_name: string | null;
  head_last_name: string | null;
}
interface Company {
  company_id: string;
  code: string;
  name: string;
}
interface WorkerRow {
  worker_id: string;
  first_name: string;
  last_name: string;
}
interface HeadAssignment {
  org_unit_head_assignment_id: string;
  worker_id: string;
  first_name: string;
  last_name: string;
  effective_from: string;
  effective_to: string | null;
  assigned_by_name: string | null;
  end_reason: string | null;
}

export function OrgHierarchy() {
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const canEdit = user?.roles?.includes("ADMIN") || user?.roles?.includes("LND_TEAM");
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];
  const hierarchyKey = ["hierarchy", company?.company_id];
  const { data } = useQuery({
    queryKey: hierarchyKey,
    queryFn: () => v2.get<{ levelTypes: LevelType[]; units: Unit[] }>(`/companies/${company!.company_id}/hierarchy?includeInactive=1`),
    enabled: !!company,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: hierarchyKey });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingLevelType, setAddingLevelType] = useState(false);
  const [addingNode, setAddingNode] = useState<{ parentId: string | null } | null>(null);
  const [assigningHead, setAssigningHead] = useState<Unit | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<string | null, Unit[]>();
    for (const u of data?.units ?? []) {
      const key = u.parent_org_unit_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return map;
  }, [data]);

  const roots = (data?.units ?? []).filter((u) => !u.parent_org_unit_id);
  const selected = data?.units.find((u) => u.org_unit_id === selectedId) ?? roots[0];

  const archive = useMutation({ mutationFn: (id: string) => v2.post(`/org-units/${id}/archive`), onSuccess: invalidate });
  const restore = useMutation({ mutationFn: (id: string) => v2.post(`/org-units/${id}/restore`), onSuccess: invalidate });

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
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setAddingLevelType(true)}>+ Add Level Type</Button>
              <Button onClick={() => setAddingNode({ parentId: null })}>+ Add Node</Button>
            </>
          ) : (
            <span className="text-xs text-fig-muted">Only Admin / L&amp;D can edit the hierarchy</span>
          )
        }
      />

      <div className="mb-4 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fig-muted">Hierarchy Level Types ({data.levelTypes.length})</div>
        <div className="flex flex-wrap gap-2">
          {data.levelTypes.map((lt) => (
            <span key={lt.org_level_type_id} className={`rounded-full px-3 py-1 text-xs font-medium ${lt.is_active ? "bg-fig-bg text-fig-text" : "bg-red-50 text-fig-red line-through"}`}>
              #{lt.sequence} {lt.name}
              {lt.is_leaf && <span className="ml-1 text-fig-muted">(leaf)</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <SectionCard title="Org Tree" padded={false} className="col-span-1">
          <div className="max-h-[600px] overflow-y-auto p-2 text-sm">
            {roots.map((root) => (
              <TreeNode key={root.org_unit_id} unit={root} byParent={byParent} depth={0} selectedId={selected?.org_unit_id ?? null} onSelect={setSelectedId} />
            ))}
          </div>
        </SectionCard>

        {selected && (
          <div className="col-span-2 space-y-4">
            <SectionCard>
              <div className="mb-1 flex items-center justify-between text-xs text-fig-muted">
                <span>{company.name}</span>
                {!selected.is_active && <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-fig-red">Archived</span>}
              </div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-bold text-fig-text">{selected.name}</h3>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <Button variant="secondary" className="text-xs" onClick={() => setAddingNode({ parentId: selected.org_unit_id })}>+ Add child</Button>
                    {selected.is_active ? (
                      <Button variant="danger" className="text-xs" disabled={archive.isPending} onClick={() => archive.mutate(selected.org_unit_id)}>Archive</Button>
                    ) : (
                      <Button variant="secondary" className="text-xs" disabled={restore.isPending} onClick={() => restore.mutate(selected.org_unit_id)}>Restore</Button>
                    )}
                  </div>
                )}
              </div>
              <div className="mb-3 flex gap-2">
                <span className="rounded bg-fig-bg px-2 py-0.5 text-xs font-medium text-fig-muted">{selected.code}</span>
                <span className="rounded bg-fig-bg px-2 py-0.5 text-xs font-medium text-fig-muted">{selected.level_type_name}</span>
              </div>
              {archive.isError && <div className="mb-2 text-xs text-fig-red">{(archive.error as Error).message}</div>}
              <div className="flex items-center justify-between border-t border-fig-border pt-3 text-sm">
                <span className="text-fig-muted">👤 Department Head</span>
                {selected.head_worker_id ? (
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-fig-text">{selected.head_first_name} {selected.head_last_name}</span>
                    {canEdit && <button onClick={() => setAssigningHead(selected)} className="text-xs font-medium text-fig-blue">Change / history</button>}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-fig-muted">No head assigned yet</span>
                    {canEdit && <button onClick={() => setAssigningHead(selected)} className="text-xs font-medium text-fig-blue">Assign</button>}
                  </span>
                )}
              </div>
            </SectionCard>

            <SectionCard title={`${data.levelTypes.find((lt) => lt.sequence === selected.level_sequence + 1)?.name ?? "Children"} (${byParent.get(selected.org_unit_id)?.length ?? 0})`} padded={false}>
              {(byParent.get(selected.org_unit_id) ?? []).length === 0 && <div className="p-5 text-sm text-fig-muted">No child nodes.</div>}
              {(byParent.get(selected.org_unit_id) ?? []).map((child) => (
                <button
                  key={child.org_unit_id}
                  onClick={() => setSelectedId(child.org_unit_id)}
                  className={`flex w-full items-center justify-between border-b border-fig-border px-5 py-3 text-left last:border-b-0 hover:bg-fig-bg ${!child.is_active ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fig-navy text-[10px] font-bold text-white">{child.code.slice(0, 2)}</span>
                    <div>
                      <div className="text-sm font-medium text-fig-text">{child.name}{!child.is_active && " (archived)"}</div>
                      <div className="text-xs text-fig-muted">{(byParent.get(child.org_unit_id) ?? []).length} child nodes</div>
                    </div>
                  </div>
                  <span className="text-fig-muted">›</span>
                </button>
              ))}
            </SectionCard>
          </div>
        )}
      </div>

      {addingLevelType && <AddLevelTypeModal companyId={company.company_id} onClose={() => setAddingLevelType(false)} onSaved={() => { setAddingLevelType(false); invalidate(); }} />}
      {addingNode && (
        <AddNodeModal
          companyId={company.company_id}
          parentId={addingNode.parentId}
          levelTypes={data.levelTypes}
          onClose={() => setAddingNode(null)}
          onSaved={(id) => { setAddingNode(null); invalidate(); setSelectedId(id); }}
        />
      )}
      {assigningHead && <HeadAssignmentModal unit={assigningHead} onClose={() => setAssigningHead(null)} onChanged={invalidate} />}
    </AppShell>
  );
}

function AddLevelTypeModal({ companyId, onClose, onSaved }: { companyId: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLeaf, setIsLeaf] = useState(false);
  const save = useMutation({
    mutationFn: () => v2.post(`/companies/${companyId}/org-level-types`, { code: code.trim(), name: name.trim(), description: description.trim() || undefined, isLeaf }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title="New hierarchy level type" onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Code"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. VERTICAL" /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vertical" /></Field>
      <Field label="Purpose (optional)"><textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isLeaf} onChange={(e) => setIsLeaf(e.target.checked)} /> This is the lowest (leaf) level — workers attach directly here</label>
      <p className="mt-2 text-xs text-fig-muted">New level types are appended to the bottom of the hierarchy; reorder them from the level-type chips.</p>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function AddNodeModal({ companyId, parentId, levelTypes, onClose, onSaved }: { companyId: string; parentId: string | null; levelTypes: LevelType[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [orgLevelTypeId, setOrgLevelTypeId] = useState(levelTypes.find((lt) => lt.is_active)?.org_level_type_id ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () =>
      parentId
        ? v2.post<{ org_unit_id: string }>(`/org-units/${parentId}/children`, { orgLevelTypeId, code: code.trim(), name: name.trim() })
        : v2.post<{ org_unit_id: string }>(`/companies/${companyId}/org-units`, { orgLevelTypeId, code: code.trim(), name: name.trim() }),
    onSuccess: (row) => onSaved(row.org_unit_id),
  });
  return (
    <Modal open title={parentId ? "Add child node" : "New organisation node"} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!orgLevelTypeId || !code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Level type">
        <select className={inputClass} value={orgLevelTypeId} onChange={(e) => setOrgLevelTypeId(e.target.value)}>
          {levelTypes.filter((lt) => lt.is_active).map((lt) => <option key={lt.org_level_type_id} value={lt.org_level_type_id}>{lt.name}</option>)}
        </select>
      </Field>
      <Field label="Code"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function HeadAssignmentModal({ unit, onClose, onChanged }: { unit: Unit; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const historyKey = ["head-history", unit.org_unit_id];
  const { data: history } = useQuery({ queryKey: historyKey, queryFn: () => v2.get<HeadAssignment[]>(`/org-units/${unit.org_unit_id}/head-assignments`) });
  const { data: workers } = useQuery({ queryKey: ["workers-search-plain"], queryFn: () => v2.get<WorkerRow[]>("/workers/search") });
  const [workerId, setWorkerId] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: historyKey }); onChanged(); };
  const assign = useMutation({ mutationFn: () => v2.post(`/org-units/${unit.org_unit_id}/head-assignments`, { workerId }), onSuccess: refresh });
  const current = history?.find((h) => !h.effective_to);
  const end = useMutation({ mutationFn: () => v2.patch(`/head-assignments/${current!.org_unit_head_assignment_id}/end`, { reason: "Ended by admin" }), onSuccess: refresh });

  return (
    <Modal open wide title={`${unit.name} — department head`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={onClose} saveLabel="Close" />}>
      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-fig-muted">Assign a new head</label>
          <select className={inputClass} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Select a worker…</option>
            {workers?.map((w) => <option key={w.worker_id} value={w.worker_id}>{w.first_name} {w.last_name}</option>)}
          </select>
        </div>
        <Button disabled={!workerId || assign.isPending} onClick={() => assign.mutate()}>Assign</Button>
      </div>
      {current && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-green-50 p-2.5 text-sm">
          <span>Current: <strong>{current.first_name} {current.last_name}</strong> since {new Date(current.effective_from).toLocaleDateString()}</span>
          <button onClick={() => end.mutate()} disabled={end.isPending} className="text-xs font-semibold text-fig-red hover:underline">End assignment</button>
        </div>
      )}
      <div className="text-xs font-semibold uppercase tracking-wide text-fig-muted">History</div>
      <ul className="mt-1 space-y-1.5">
        {history?.map((h) => (
          <li key={h.org_unit_head_assignment_id} className="rounded border border-fig-border p-2 text-xs">
            <strong>{h.first_name} {h.last_name}</strong> — {new Date(h.effective_from).toLocaleDateString()} to {h.effective_to ? new Date(h.effective_to).toLocaleDateString() : "present"}
            {h.end_reason && <span className="text-fig-muted"> ({h.end_reason})</span>}
          </li>
        ))}
        {(!history || history.length === 0) && <li className="text-xs text-fig-muted">No assignment history yet.</li>}
      </ul>
      {(assign.isError || end.isError) && <div className="mt-2 text-xs text-fig-red">{((assign.error ?? end.error) as Error).message}</div>}
    </Modal>
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
        } ${!unit.is_active ? "opacity-50" : ""}`}
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

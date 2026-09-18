import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
import { v2 } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface Product {
  product_id: string;
  parent_product_id: string | null;
  code: string;
  name: string;
  product_type: "FAMILY" | "PRODUCT" | "VARIANT";
  description: string | null;
  is_active: boolean;
}
interface Company {
  company_id: string;
  code: string;
  name: string;
}
interface OrgUnitOption {
  org_unit_id: string;
  name: string;
  level_type_name: string;
}
interface ProcessOption {
  process_id: string;
  code: string;
  name: string;
}
interface Links {
  orgUnits: { product_org_unit_link_id: string; org_unit_id: string; name: string; level_type_name: string }[];
  processes: { product_process_link_id: string; process_id: string; code: string; name: string }[];
}

const TYPE_TONE: Record<string, string> = { FAMILY: "bg-purple-50 text-fig-purple", PRODUCT: "bg-blue-50 text-fig-blue", VARIANT: "bg-fig-bg text-fig-muted" };

export function ProductMaster() {
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const canEdit = user?.roles?.includes("ADMIN") || user?.roles?.includes("LND_TEAM");
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];
  const productsKey = ["products", company?.company_id];
  const { data: products } = useQuery({
    queryKey: productsKey,
    queryFn: () => v2.get<Product[]>(`/companies/${company!.company_id}/products?includeInactive=1`),
    enabled: !!company,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: productsKey });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [linking, setLinking] = useState<Product | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<string | null, Product[]>();
    for (const p of products ?? []) {
      const key = p.parent_product_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  const roots = (products ?? []).filter((p) => !p.parent_product_id);
  const selected = products?.find((p) => p.product_id === selectedId) ?? roots[0];

  const archive = useMutation({ mutationFn: (id: string) => v2.post(`/products/${id}/archive`), onSuccess: invalidate, onError: (e) => window.alert((e as Error).message) });
  const restore = useMutation({ mutationFn: (id: string) => v2.post(`/products/${id}/restore`), onSuccess: invalidate });

  if (!company) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Product Master" }]}>
        <div className="py-16 text-center text-sm text-fig-muted">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Product Master" }]}>
      <PageHeader
        title="Product Master"
        description={`${company.name} · Hierarchical product tree — family, product and sub-product configuration`}
        action={canEdit ? <Button onClick={() => setAdding({ parentId: null })}>+ New Product Family</Button> : <span className="text-xs text-fig-muted">Only Admin / L&amp;D can edit Product Master</span>}
      />

      <div className="grid grid-cols-3 gap-4">
        <SectionCard title={`Product Tree (${products?.length ?? 0})`} padded={false} className="col-span-1">
          <div className="max-h-[600px] overflow-y-auto p-2 text-sm">
            {roots.length === 0 && <div className="p-4 text-xs text-fig-muted">No products yet — create a product family to get started.</div>}
            {roots.map((root) => (
              <ProductTreeNode key={root.product_id} product={root} byParent={byParent} depth={0} selectedId={selected?.product_id ?? null} onSelect={setSelectedId} />
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
                    <Button variant="secondary" className="text-xs" onClick={() => setAdding({ parentId: selected.product_id })}>+ Add sub-product</Button>
                    {selected.is_active ? (
                      <Button variant="danger" className="text-xs" disabled={archive.isPending} onClick={() => archive.mutate(selected.product_id)}>Archive</Button>
                    ) : (
                      <Button variant="secondary" className="text-xs" disabled={restore.isPending} onClick={() => restore.mutate(selected.product_id)}>Restore</Button>
                    )}
                  </div>
                )}
              </div>
              <div className="mb-3 flex gap-2">
                <span className="rounded bg-fig-bg px-2 py-0.5 text-xs font-medium text-fig-muted">{selected.code}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_TONE[selected.product_type]}`}>{selected.product_type}</span>
              </div>
              {selected.description && <p className="mb-3 text-sm text-fig-muted">{selected.description}</p>}
              <div className="flex items-center justify-between border-t border-fig-border pt-3 text-sm">
                <span className="text-fig-muted">🔗 Organisation &amp; process links</span>
                <button onClick={() => setLinking(selected)} className="text-xs font-medium text-fig-blue">Manage links</button>
              </div>
            </SectionCard>

            <SectionCard title={`Sub-products (${byParent.get(selected.product_id)?.length ?? 0})`} padded={false}>
              {(byParent.get(selected.product_id) ?? []).length === 0 && <div className="p-5 text-sm text-fig-muted">No sub-products.</div>}
              {(byParent.get(selected.product_id) ?? []).map((child) => (
                <button
                  key={child.product_id}
                  onClick={() => setSelectedId(child.product_id)}
                  className={`flex w-full items-center justify-between border-b border-fig-border px-5 py-3 text-left last:border-b-0 hover:bg-fig-bg ${!child.is_active ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fig-navy text-[10px] font-bold text-white">{child.code.slice(0, 2)}</span>
                    <div>
                      <div className="text-sm font-medium text-fig-text">{child.name}{!child.is_active && " (archived)"}</div>
                      <div className="text-xs text-fig-muted">{child.product_type} · {(byParent.get(child.product_id) ?? []).length} sub-products</div>
                    </div>
                  </div>
                  <span className="text-fig-muted">›</span>
                </button>
              ))}
            </SectionCard>
          </div>
        )}
      </div>

      {adding && (
        <AddProductModal
          companyId={company.company_id}
          parentId={adding.parentId}
          onClose={() => setAdding(null)}
          onSaved={(id) => { setAdding(null); invalidate(); setSelectedId(id); }}
        />
      )}
      {linking && <LinkManagerModal product={linking} companyId={company.company_id} onClose={() => setLinking(null)} />}
    </AppShell>
  );
}

function ProductTreeNode({
  product,
  byParent,
  depth,
  selectedId,
  onSelect,
}: {
  product: Product;
  byParent: Map<string | null, Product[]>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const children = byParent.get(product.product_id) ?? [];
  return (
    <div>
      <button
        onClick={() => onSelect(product.product_id)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded py-1.5 pr-2 text-left text-xs ${
          selectedId === product.product_id ? "bg-blue-50 font-medium text-fig-blue" : "text-fig-text hover:bg-fig-bg"
        } ${!product.is_active ? "opacity-50" : ""}`}
      >
        {children.length > 0 && <span className="text-fig-muted">▾</span>}
        <span className="text-[10px] uppercase text-fig-muted">{product.product_type.slice(0, 3)}</span>
        <span className="truncate">{product.name}</span>
      </button>
      {children.map((c) => (
        <ProductTreeNode key={c.product_id} product={c} byParent={byParent} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function AddProductModal({ companyId, parentId, onClose, onSaved }: { companyId: string; parentId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [productType, setProductType] = useState(parentId ? "PRODUCT" : "FAMILY");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () =>
      v2.post<{ product_id: string }>(`/companies/${companyId}/products`, { parentProductId: parentId, code: code.trim(), name: name.trim(), productType, description: description.trim() || undefined }),
    onSuccess: (row) => onSaved(row.product_id),
  });
  return (
    <Modal open title={parentId ? "Add sub-product" : "New product family"} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Code"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Type">
        <select className={inputClass} value={productType} onChange={(e) => setProductType(e.target.value)}>
          <option value="FAMILY">Family</option>
          <option value="PRODUCT">Product</option>
          <option value="VARIANT">Variant / Sub-product</option>
        </select>
      </Field>
      <Field label="Description (optional)"><textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function LinkManagerModal({ product, companyId, onClose }: { product: Product; companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["product-links", product.product_id];
  const { data: links } = useQuery({ queryKey: key, queryFn: () => v2.get<Links>(`/products/${product.product_id}/links`) });
  const { data: hierarchy } = useQuery({ queryKey: ["hierarchy", companyId], queryFn: () => v2.get<{ units: OrgUnitOption[] }>(`/companies/${companyId}/hierarchy`) });
  const { data: processes } = useQuery({ queryKey: ["processes"], queryFn: () => v2.get<ProcessOption[]>("/processes") });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [orgUnitId, setOrgUnitId] = useState("");
  const [processId, setProcessId] = useState("");
  const linkOrg = useMutation({ mutationFn: () => v2.post(`/products/${product.product_id}/organisation-links`, { orgUnitId }), onSuccess: invalidate });
  const unlinkOrg = useMutation({ mutationFn: (id: string) => v2.del(`/products/${product.product_id}/organisation-links/${id}`), onSuccess: invalidate });
  const linkProc = useMutation({ mutationFn: () => v2.post(`/products/${product.product_id}/process-links`, { processId }), onSuccess: invalidate });
  const unlinkProc = useMutation({ mutationFn: (id: string) => v2.del(`/products/${product.product_id}/process-links/${id}`), onSuccess: invalidate });

  return (
    <Modal open wide title={`${product.name} — links`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={onClose} saveLabel="Close" />}>
      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fig-muted">Organisation nodes</div>
        <ul className="mb-2 space-y-1">
          {links?.orgUnits.map((l) => (
            <li key={l.product_org_unit_link_id} className="flex items-center justify-between rounded border border-fig-border px-2.5 py-1.5 text-xs">
              <span>{l.name} <span className="text-fig-muted">({l.level_type_name})</span></span>
              <button onClick={() => unlinkOrg.mutate(l.product_org_unit_link_id)} className="font-semibold text-fig-red hover:underline">remove</button>
            </li>
          ))}
          {(!links || links.orgUnits.length === 0) && <li className="text-xs text-fig-muted">No organisation nodes linked yet.</li>}
        </ul>
        <div className="flex items-center gap-1.5">
          <select value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} className={inputClass}>
            <option value="">Select a node…</option>
            {hierarchy?.units.map((u) => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name} ({u.level_type_name})</option>)}
          </select>
          <Button variant="secondary" className="shrink-0 px-2.5 py-1.5 text-xs" disabled={!orgUnitId || linkOrg.isPending} onClick={() => linkOrg.mutate()}>Link</Button>
        </div>
        {linkOrg.isError && <div className="mt-1 text-[11px] text-fig-red">{(linkOrg.error as Error).message}</div>}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fig-muted">Processes</div>
        <ul className="mb-2 space-y-1">
          {links?.processes.map((l) => (
            <li key={l.product_process_link_id} className="flex items-center justify-between rounded border border-fig-border px-2.5 py-1.5 text-xs">
              <span>{l.name} <span className="text-fig-muted">({l.code})</span></span>
              <button onClick={() => unlinkProc.mutate(l.product_process_link_id)} className="font-semibold text-fig-red hover:underline">remove</button>
            </li>
          ))}
          {(!links || links.processes.length === 0) && <li className="text-xs text-fig-muted">No processes linked yet.</li>}
        </ul>
        <div className="flex items-center gap-1.5">
          <select value={processId} onChange={(e) => setProcessId(e.target.value)} className={inputClass}>
            <option value="">Select a process…</option>
            {processes?.map((p) => <option key={p.process_id} value={p.process_id}>{p.name} ({p.code})</option>)}
          </select>
          <Button variant="secondary" className="shrink-0 px-2.5 py-1.5 text-xs" disabled={!processId || linkProc.isPending} onClick={() => linkProc.mutate()}>Link</Button>
        </div>
        {linkProc.isError && <div className="mt-1 text-[11px] text-fig-red">{(linkProc.error as Error).message}</div>}
      </div>
    </Modal>
  );
}

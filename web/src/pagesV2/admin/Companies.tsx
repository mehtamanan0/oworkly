import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { Button } from "../../components/figma/Button";
import { StatusBadge } from "../../components/figma/Badge";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
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
interface ChecklistItem {
  code: string;
  label: string;
  passed: boolean;
  detail?: string;
}
interface AuditRow {
  audit_id: number;
  action: string;
  changed_at: string;
  reason: string | null;
  changed_by_name: string | null;
}

export function Companies() {
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const isPlatformAdmin = user?.companyId === null;
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["companies"] });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [activating, setActivating] = useState<Company | null>(null);
  const [deactivating, setDeactivating] = useState<Company | null>(null);
  const [viewingAudit, setViewingAudit] = useState<Company | null>(null);

  const canEdit = (c: Company) => isPlatformAdmin || (user?.companyId === c.company_id && user?.roles?.includes("ADMIN"));

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Companies" }]}>
      <PageHeader
        title="Companies"
        description="Manage client companies. The active company drives all admin configuration screens."
        action={
          isPlatformAdmin ? (
            <Button onClick={() => setCreating(true)}>+ Add Company</Button>
          ) : (
            <span className="text-xs text-fig-muted">Only a platform administrator can add companies</span>
          )
        }
      />

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
            <div className="mb-1.5 flex items-center justify-between">
              <StatusBadge status={c.status} />
              <button onClick={() => setViewingAudit(c)} className="text-[11px] font-medium text-fig-muted hover:text-fig-blue">
                History
              </button>
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
            <div className="flex flex-wrap gap-2">
              {c.status !== "ACTIVE" && isPlatformAdmin && (
                <Button variant="secondary" className="flex-1 justify-center" onClick={() => setActivating(c)}>
                  Set as Active
                </Button>
              )}
              {c.status === "ACTIVE" && isPlatformAdmin && (
                <Button variant="danger" className="flex-1 justify-center" onClick={() => setDeactivating(c)}>
                  Deactivate
                </Button>
              )}
              {canEdit(c) && (
                <Button variant="secondary" className="flex-1 justify-center" onClick={() => setEditing(c)}>
                  Edit
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

      {creating && <CreateCompanyModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); invalidate(); }} />}
      {editing && <EditCompanyModal company={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
      {activating && <ActivateCompanyModal company={activating} onClose={() => setActivating(null)} onSaved={() => { setActivating(null); invalidate(); }} />}
      {deactivating && <DeactivateCompanyModal company={deactivating} onClose={() => setDeactivating(null)} onSaved={() => { setDeactivating(null); invalidate(); }} />}
      {viewingAudit && <AuditHistoryModal company={viewingAudit} onClose={() => setViewingAudit(null)} />}
    </AppShell>
  );
}

function CreateCompanyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const save = useMutation({
    mutationFn: () => v2.post("/companies", { code: code.trim().toUpperCase(), name: name.trim(), industry: industry.trim() || undefined }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title="New company" onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!code.trim() || !name.trim()} saveLabel="Create" />}>
      <Field label="Company code (unique, e.g. ACME)"><input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Industry (optional)"><input className={inputClass} value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
      <p className="text-xs text-fig-muted">The company is created in <strong>IN_SETUP</strong> status. Configure its org hierarchy and assign an admin, then activate it.</p>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function EditCompanyModal({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(company.name);
  const [industry, setIndustry] = useState(company.industry ?? "");
  const save = useMutation({
    mutationFn: () => v2.patch(`/companies/${company.company_id}`, { name: name.trim(), industry: industry.trim() || null }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title={`Edit ${company.name}`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => save.mutate()} saving={save.isPending} disabled={!name.trim()} />}>
      <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Industry"><input className={inputClass} value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
      {save.isError && <div className="mt-2 text-xs text-fig-red">{(save.error as Error).message}</div>}
    </Modal>
  );
}

function ActivateCompanyModal({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved: () => void }) {
  const { data: checklist } = useQuery({
    queryKey: ["activation-checklist", company.company_id],
    queryFn: () => v2.get<ChecklistItem[]>(`/companies/${company.company_id}/activation-checklist`),
  });
  const allPassed = !!checklist && checklist.every((c) => c.passed);
  const activate = useMutation({ mutationFn: () => v2.post(`/companies/${company.company_id}/activate`), onSuccess: onSaved });
  return (
    <Modal
      open
      title={`Activate ${company.name}`}
      onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={() => activate.mutate()} saving={activate.isPending} disabled={!allPassed} saveLabel="Activate" />}
    >
      <p className="mb-3 text-sm text-fig-muted">Every item below must pass before this tenant can go live.</p>
      <ul className="space-y-2">
        {checklist?.map((c) => (
          <li key={c.code} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${c.passed ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}`}>
            <span className={c.passed ? "text-fig-green" : "text-fig-orange"}>{c.passed ? "✓" : "⚠"}</span>
            <div>
              <div className={c.passed ? "text-fig-text" : "font-medium text-fig-text"}>{c.label}</div>
              {c.detail && <div className="text-xs text-fig-muted">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {!allPassed && <p className="mt-3 text-xs text-fig-orange">Complete the missing items above (via Org Hierarchy / User Management), then reopen this dialog.</p>}
      {activate.isError && <div className="mt-2 text-xs text-fig-red">{(activate.error as Error).message}</div>}
    </Modal>
  );
}

function DeactivateCompanyModal({ company, onClose, onSaved }: { company: Company; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const deactivate = useMutation({ mutationFn: () => v2.post(`/companies/${company.company_id}/deactivate`, { reason: reason.trim() }), onSuccess: onSaved });
  return (
    <Modal open title={`Deactivate ${company.name}`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => deactivate.mutate()} saving={deactivate.isPending} disabled={!reason.trim()} saveLabel="Deactivate" />}>
      <p className="mb-3 text-sm text-fig-text">
        This blocks new sign-ins for {company.name}'s users. All historical workers, assessments, certificates and audit records are preserved — nothing is deleted.
      </p>
      <Field label="Reason (required)"><textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Contract paused pending renewal" /></Field>
      {deactivate.isError && <div className="mt-2 text-xs text-fig-red">{(deactivate.error as Error).message}</div>}
    </Modal>
  );
}

function AuditHistoryModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const { data: rows } = useQuery({ queryKey: ["company-audit", company.company_id], queryFn: () => v2.get<AuditRow[]>(`/companies/${company.company_id}/audit`) });
  return (
    <Modal open wide title={`${company.name} — history`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={onClose} saveLabel="Close" />}>
      {(!rows || rows.length === 0) && <p className="text-sm text-fig-muted">No changes recorded yet.</p>}
      <ul className="space-y-2">
        {rows?.map((r) => (
          <li key={r.audit_id} className="rounded-lg border border-fig-border p-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-fig-text">{r.action.replace("_", " ")}</span>
              <span className="text-xs text-fig-muted">{new Date(r.changed_at).toLocaleString()}</span>
            </div>
            <div className="text-xs text-fig-muted">by {r.changed_by_name ?? "system"}{r.reason ? ` — ${r.reason}` : ""}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

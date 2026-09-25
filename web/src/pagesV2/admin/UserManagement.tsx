import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { Modal, ModalActions, Field, inputClass } from "../../components/figma/Modal";
import { Forbidden } from "../../components/figma/Forbidden";
import { v2, ApiV2Error } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

interface Company { company_id: string; code: string; name: string }
interface Role { role_id: number; role_code: string; role_name: string }
interface UserRow {
  user_id: string;
  display_name: string;
  email: string;
  is_active: boolean;
  last_success_login_at: string | null;
  roles: string[];
}

export function UserManagement() {
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const canManage = user?.roles?.includes("ADMIN");

  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];

  const usersKey = ["company-users", company?.company_id];
  const { data: users, error: usersError } = useQuery({
    queryKey: usersKey,
    queryFn: () => v2.get<UserRow[]>(`/companies/${company!.company_id}/users`),
    enabled: !!company,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: usersKey });

  const [assigningTo, setAssigningTo] = useState<UserRow | null>(null);
  const [deactivatingReasonFor, setDeactivatingReasonFor] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<{ user: UserRow; password: string } | null>(null);

  const reactivate = useMutation({ mutationFn: (id: string) => v2.post(`/users/${id}/reactivate`), onSuccess: invalidate, onError: (e) => window.alert(e instanceof ApiV2Error ? e.message : "Failed") });
  const resetPassword = useMutation({
    mutationFn: (id: string) => v2.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
    onSuccess: (res, id) => setTempPassword({ user: users!.find((u) => u.user_id === id)!, password: res.temporaryPassword }),
    onError: (e) => window.alert(e instanceof ApiV2Error ? e.message : "Failed"),
  });
  const removeRole = useMutation({
    mutationFn: (v: { userId: string; roleId: number }) => v2.del(`/users/${v.userId}/roles/${v.roleId}`),
    onSuccess: invalidate,
    onError: (e) => window.alert(e instanceof ApiV2Error ? e.message : "Failed"),
  });

  if (usersError instanceof ApiV2Error && usersError.status === 403) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "User Management" }]}>
        <PageHeader title="User Management" />
        <Forbidden />
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "User Management" }]}>
      <PageHeader
        title="User Management"
        description={company ? `${company.name} · Accounts, roles, and company scope` : undefined}
        action={<span className="text-xs text-fig-muted">Invite-based account creation is on the roadmap — accounts are currently seeded/provisioned by a platform admin.</span>}
      />

      <SectionCard padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
              <th className="px-5 py-2.5">Name</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Roles</th>
              <th className="px-3 py-2.5">Last login</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.user_id} className={`border-b border-fig-border last:border-b-0 ${!u.is_active ? "opacity-50" : ""}`}>
                <td className="px-5 py-3 font-medium text-fig-text">{u.display_name}</td>
                <td className="px-3 py-3 text-fig-muted">{u.email}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <span key={r} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-blue">
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-fig-muted">{u.last_success_login_at ? new Date(u.last_success_login_at).toLocaleDateString() : "Never"}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? "bg-green-50 text-fig-green" : "bg-red-50 text-fig-red"}`}>
                    {u.is_active ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  {canManage && (
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setAssigningTo(u)} className="rounded bg-fig-bg px-2 py-1 text-xs font-medium text-fig-text">+ Role</button>
                      <button onClick={() => resetPassword.mutate(u.user_id)} disabled={resetPassword.isPending} className="rounded bg-fig-bg px-2 py-1 text-xs font-medium text-fig-text">Reset PW</button>
                      {u.is_active ? (
                        <button onClick={() => setDeactivatingReasonFor(u)} className="rounded px-2 py-1 text-xs font-medium text-fig-red hover:bg-red-50">Deactivate</button>
                      ) : (
                        <button onClick={() => reactivate.mutate(u.user_id)} disabled={reactivate.isPending} className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-fig-blue">Reactivate</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users?.length === 0 && <div className="px-5 py-6 text-center text-sm text-fig-muted">No users found for this company.</div>}
      </SectionCard>

      {assigningTo && company && <AssignRoleModal user={assigningTo} companyId={company.company_id} onClose={() => setAssigningTo(null)} onSaved={() => { setAssigningTo(null); invalidate(); }} onRemoveRole={(roleId) => removeRole.mutate({ userId: assigningTo.user_id, roleId })} />}
      {deactivatingReasonFor && (
        <DeactivateModal
          user={deactivatingReasonFor}
          onClose={() => setDeactivatingReasonFor(null)}
          onSaved={() => { setDeactivatingReasonFor(null); invalidate(); }}
        />
      )}
      {tempPassword && (
        <Modal open title="Temporary password issued" onClose={() => setTempPassword(null)} footer={<ModalActions onCancel={() => setTempPassword(null)} onSave={() => setTempPassword(null)} saveLabel="Done" />}>
          <p className="mb-2 text-sm text-fig-text">
            One-time password for <strong>{tempPassword.user.display_name}</strong> — shown once, relay it out-of-band. All their existing sessions have been revoked.
          </p>
          <code className="block rounded-lg bg-fig-bg px-3 py-2 text-sm font-mono">{tempPassword.password}</code>
        </Modal>
      )}
    </AppShell>
  );
}

function DeactivateModal({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const deactivate = useMutation({ mutationFn: () => v2.post(`/users/${user.user_id}/deactivate`, { reason }), onSuccess: onSaved });
  return (
    <Modal open title={`Deactivate ${user.display_name}`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => deactivate.mutate()} saving={deactivate.isPending} disabled={!reason.trim()} saveLabel="Deactivate" />}>
      <Field label="Reason (required, audited)"><textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {deactivate.isError && <div className="mt-2 text-xs text-fig-red">{deactivate.error instanceof ApiV2Error ? deactivate.error.message : "Failed"}</div>}
    </Modal>
  );
}

function AssignRoleModal({ user, companyId, onClose, onSaved, onRemoveRole }: { user: UserRow; companyId: string; onClose: () => void; onSaved: () => void; onRemoveRole: (roleId: number) => void }) {
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => v2.get<Role[]>("/roles") });
  const { data: hierarchy } = useQuery({ queryKey: ["hierarchy", companyId], queryFn: () => v2.get<{ units: { org_unit_id: string; name: string; level_type_name: string }[] }>(`/companies/${companyId}/hierarchy`) });
  const [roleCode, setRoleCode] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const assign = useMutation({
    mutationFn: () => v2.post(`/users/${user.user_id}/roles`, { roleCode, companyId, orgUnitId }),
    onSuccess: onSaved,
  });
  return (
    <Modal open title={`Roles — ${user.display_name}`} onClose={onClose} footer={<ModalActions onCancel={onClose} onSave={() => assign.mutate()} saving={assign.isPending} disabled={!roleCode || !orgUnitId} saveLabel="Assign" />}>
      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fig-muted">Current roles</div>
        <ul className="space-y-1">
          {user.roles.map((code) => {
            const role = roles?.find((r) => r.role_code === code);
            return (
              <li key={code} className="flex items-center justify-between rounded border border-fig-border px-2.5 py-1.5 text-xs">
                <span>{code}</span>
                {role && <button onClick={() => onRemoveRole(role.role_id)} className="font-semibold text-fig-red hover:underline">remove</button>}
              </li>
            );
          })}
        </ul>
      </div>
      <Field label="Add role">
        <select className={inputClass} value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
          <option value="">Select a role…</option>
          {roles?.map((r) => <option key={r.role_id} value={r.role_code}>{r.role_code} — {r.role_name}</option>)}
        </select>
      </Field>
      <Field label="Organisation scope">
        <select className={inputClass} value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
          <option value="">Select a node…</option>
          {hierarchy?.units.map((u) => <option key={u.org_unit_id} value={u.org_unit_id}>{u.name} ({u.level_type_name})</option>)}
        </select>
      </Field>
      {assign.isError && <div className="mt-2 text-xs text-fig-red">{assign.error instanceof ApiV2Error ? assign.error.message : "Failed"}</div>}
    </Modal>
  );
}

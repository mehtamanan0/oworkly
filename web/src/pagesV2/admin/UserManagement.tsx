import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { authApi } from "../../lib/apiV2";

export function UserManagement() {
  const { data: users } = useQuery({ queryKey: ["dev-users"], queryFn: () => authApi.devUsers() });

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "User Management" }]}>
      <PageHeader title="User Management" description="Accounts, roles, and company scope" action={<Button disabled>+ Add User</Button>} />

      <SectionCard padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-fig-border text-left text-[11px] uppercase tracking-wide text-fig-muted">
              <th className="px-5 py-2.5">Name</th>
              <th className="px-3 py-2.5">Username</th>
              <th className="px-3 py-2.5">Roles</th>
              <th className="px-3 py-2.5">Company Scope</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.username} className="border-b border-fig-border last:border-b-0">
                <td className="px-5 py-3 font-medium text-fig-text">{u.display_name}</td>
                <td className="px-3 py-3 text-fig-muted">{u.username}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <span key={r} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-fig-blue">
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-fig-text">{u.companies.length > 1 ? "Platform-wide" : u.companies.join(", ")}</td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-fig-green">Active</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
      <p className="mt-3 text-center text-xs text-fig-muted">Editing (invite, deactivate, reassign role/scope) lands in the next phase — this view is read-only, backed by real seeded accounts.</p>
    </AppShell>
  );
}

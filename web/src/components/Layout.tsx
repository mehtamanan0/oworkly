import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ROLE_LABELS, useAuth } from "../lib/AuthContext";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { users, currentUser, setCurrentUserId, hasRole } = useAuth();
  const isEmployeeOnly = hasRole("EMPLOYEE") && !hasRole("ADMIN", "LND_TEAM", "MANAGER", "ASSESSOR", "SUPERVISOR");

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold text-indigo-700">Oworkly LMS</div>
          <div className="text-xs text-slate-400">Phase 1 MVP · WTG Daman demo</div>
        </div>
        <nav className="space-y-1">
          {isEmployeeOnly ? (
            <>
              <NavItem to="/me" label="My Journey" />
              <NavItem to="/me/certificates" label="My Certificates" />
            </>
          ) : (
            <>
              <NavItem to="/" label="Dashboard" />
              <NavItem to="/org" label="Org & Processes" />
              <NavItem to="/skill-matrix" label="Skill Matrix" />
              <NavItem to="/workers" label="Workers" />
              <NavItem to="/assessments" label="Assessments" />
              <NavItem to="/certificates" label="Certificates" />
              <NavItem to="/gap-analysis" label="Gap Analysis & Retest" />
              <NavItem to="/ingestion" label="Ingestion Report" />
            </>
          )}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">Standalone deployment mode · Demo data: real WTG Daman skill matrix</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Viewing as</span>
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={currentUser?.user_id ?? ""}
              onChange={(e) => setCurrentUserId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name} — {u.role_codes.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

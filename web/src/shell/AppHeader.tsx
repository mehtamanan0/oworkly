import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthV2 } from "../lib/AuthV2Context";

interface NavItem {
  label: string;
  to?: string;
  match?: string; // path prefix used to decide "active" when it differs from `to`
  children?: { label: string; to: string; description?: string }[];
}

const NAV: NavItem[] = [
  { label: "Dashboard", to: "/dashboard" },
  {
    label: "Workers",
    match: "/workers",
    children: [
      { label: "Worker Search", to: "/workers/search", description: "Find a worker to begin an assessment" },
      { label: "Worker Master", to: "/workers", description: "All workers across every data source" },
      { label: "Data Sources", to: "/workers/data-sources", description: "HRMS/vendor feeds into OWorkly" },
    ],
  },
  {
    label: "Assessments",
    match: "/assessments",
    children: [{ label: "Start Assessment", to: "/workers/search", description: "Search for a worker, then start their package" }],
  },
  {
    label: "Qualifications",
    match: "/qualifications",
    children: [
      { label: "Pending Approval", to: "/qualifications?status=PENDING_APPROVAL", description: "Cases awaiting an approval stage" },
      { label: "Failed / Retest Due", to: "/qualifications?status=FAILED&status=RETEST_COOLING", description: "Cases that need a retest" },
    ],
  },
  { label: "Skill Matrix", to: "/skill-matrix" },
  { label: "Reports", to: "/reports/management-dashboard", match: "/reports" },
  {
    label: "Admin",
    to: "/admin",
    children: [
      { label: "Overview", to: "/admin" },
      { label: "Companies", to: "/admin/companies" },
      { label: "Org Hierarchy", to: "/admin/org-hierarchy" },
      { label: "Processes & Levels", to: "/admin/processes" },
      { label: "Assessment Configuration", to: "/admin/assessments/library" },
      { label: "Skill Matrix Config", to: "/admin/skill-matrix-config" },
    ],
  },
];

const DEMO_USERS: { username: string; label: string; roleLabel: string }[] = [
  { username: "admin", label: "Platform Admin (Amit Admin)", roleLabel: "Platform Admin" },
  { username: "cwec_admin", label: "CWE Company Admin (Preethi Krishnan)", roleLabel: "Company Admin" },
  { username: "sunil_trainer", label: "Trainer — Blade Assembly (Sunil Mehta)", roleLabel: "Trainer" },
  { username: "arjun_trainer", label: "Trainer (Arjun Tiwari)", roleLabel: "Trainer" },
  { username: "rajiv_hod", label: "Head of Department (Rajiv Desai)", roleLabel: "HOD" },
  { username: "sss_admin", label: "SSS Company Admin", roleLabel: "Company Admin" },
];

export function AppHeader({ breadcrumbs }: { breadcrumbs?: { label: string; to?: string }[] }) {
  const { user, signOut, signIn } = useAuthV2();
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  const isActive = (item: NavItem) => {
    const prefix = item.match ?? item.to;
    if (!prefix) return false;
    return location.pathname === prefix || location.pathname.startsWith(prefix + "/");
  };

  async function switchDemoUser(username: string) {
    setDemoOpen(false);
    const { authApi } = await import("../lib/apiV2");
    const res = await authApi.devLogin(username);
    signIn(res.accessToken, res.user);
    navigate("/dashboard");
  }

  const initials = (user?.displayName ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const roleLabel = user?.roles?.[0]
    ? user.roles[0].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  return (
    <div className="sticky top-0 z-30 bg-white">
      <header className="flex h-14 items-center justify-between border-b border-fig-border px-4">
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fig-navy text-white">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 2z" fill="currentColor" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-fig-navy">OWorkly</span>
              <span className="block text-[9px] font-medium tracking-wide text-fig-muted">WORKFORCE SKILLS</span>
            </span>
          </Link>

          <nav className="flex items-center gap-6 text-sm">
            {NAV.map((item) => (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => item.children && setOpenMenu(item.label)}
                onMouseLeave={() => item.children && setOpenMenu(null)}
              >
                {item.to && !item.children ? (
                  <Link
                    to={item.to}
                    className={`relative py-4 font-medium ${isActive(item) ? "text-fig-blue" : "text-fig-text hover:text-fig-blue"}`}
                  >
                    {item.label}
                    {isActive(item) && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-fig-blue" />}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={`relative flex items-center gap-1 py-4 font-medium ${isActive(item) ? "text-fig-blue" : "text-fig-text hover:text-fig-blue"}`}
                    onClick={() => item.to && !item.children && navigate(item.to)}
                  >
                    {item.label}
                    {item.children && (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    )}
                    {isActive(item) && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-fig-blue" />}
                  </button>
                )}

                {item.children && openMenu === item.label && (
                  <div className="absolute left-0 top-full z-40 w-72 rounded-lg border border-fig-border bg-white py-2 shadow-lg">
                    {item.children.map((child) => (
                      <Link
                        key={child.to}
                        to={child.to}
                        className="block px-4 py-2 hover:bg-fig-bg"
                        onClick={() => setOpenMenu(null)}
                      >
                        <div className="text-sm font-medium text-fig-text">{child.label}</div>
                        {child.description && <div className="text-xs text-fig-muted">{child.description}</div>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDemoOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-fig-orange/30 bg-fig-orange/10 px-3 py-1 text-xs font-semibold text-fig-orange"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-fig-orange" /> Demo
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
            {demoOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border border-fig-border bg-white py-2 shadow-lg">
                <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fig-muted">Switch demo user</div>
                {DEMO_USERS.map((d) => (
                  <button
                    key={d.username}
                    type="button"
                    onClick={() => switchDemoUser(d.username)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-fig-bg"
                  >
                    <span className="text-sm text-fig-text">{d.label}</span>
                    <span className="rounded bg-fig-bg px-1.5 py-0.5 text-[10px] font-medium text-fig-muted">{d.roleLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="relative rounded-full p-1.5 text-fig-muted hover:bg-fig-bg" aria-label="Notifications">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="relative group">
            <button type="button" className="flex items-center gap-2" onClick={() => signOut()} title="Sign out">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fig-navy text-xs font-semibold text-white">{initials}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium text-fig-text">{user?.displayName}</span>
                <span className="block text-[11px] text-fig-muted">{roleLabel}</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex h-8 items-center gap-1.5 border-b border-fig-border bg-white px-4 text-xs text-fig-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-fig-border">›</span>}
              {b.to ? (
                <Link to={b.to} className="hover:text-fig-blue">
                  {b.label}
                </Link>
              ) : (
                <span className={i === breadcrumbs.length - 1 ? "font-medium text-fig-text" : ""}>{b.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

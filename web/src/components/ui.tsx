import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <div className="mb-3 text-sm font-semibold text-slate-500">{title}</div>}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: string; tone?: "default" | "warn" | "danger" | "good" }) {
  const toneClass = {
    default: "text-slate-900",
    warn: "text-amber-600",
    danger: "text-rose-600",
    good: "text-emerald-600",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: "slate" | "red" | "green" | "blue" | "amber" | "indigo" }) {
  const colorClass = {
    slate: "bg-slate-100 text-slate-600",
    red: "bg-rose-100 text-rose-700",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
    amber: "bg-amber-100 text-amber-700",
    indigo: "bg-indigo-100 text-indigo-700",
  }[color];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>{children}</span>;
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  const colorMap: Record<string, "indigo" | "blue" | "amber"> = { SELF: "amber", SUPERVISOR: "blue", TRAINER: "indigo" };
  const label: Record<string, string> = { SELF: "Self-Check", SUPERVISOR: "Supervisor", TRAINER: "Trainer" };
  return <Badge color={colorMap[category] ?? "slate"}>{label[category] ?? category}</Badge>;
}

export function EvaluatorBadge({ capacity }: { capacity: string | null | undefined }) {
  if (!capacity) return null;
  const colorMap: Record<string, "amber" | "blue" | "indigo" | "slate"> = {
    SELF: "amber", SUPERVISOR_ASSESSOR: "blue", TRAINER: "indigo", SYSTEM: "slate",
  };
  const label: Record<string, string> = { SELF: "Self", SUPERVISOR_ASSESSOR: "Supervisor/Assessor", TRAINER: "Trainer", SYSTEM: "System" };
  return <Badge color={colorMap[capacity] ?? "slate"}>{label[capacity] ?? capacity}</Badge>;
}

export function LevelBadge({ code }: { code: string | null | undefined }) {
  if (!code) return <Badge color="slate">Not assessed</Badge>;
  const colorMap: Record<string, "red" | "blue" | "green" | "indigo"> = { L1: "red", L2: "blue", L3: "green", L4: "indigo" };
  return <Badge color={colorMap[code] ?? "slate"}>{code}</Badge>;
}

export function LoadingState() {
  return <div className="p-8 text-center text-sm text-slate-400">Loading…</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{message}</div>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const variantClass = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClass}`}
    >
      {children}
    </button>
  );
}

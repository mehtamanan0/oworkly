import type { ReactNode } from "react";

const TONES = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-50 text-fig-blue",
  orange: "bg-orange-50 text-fig-orange",
  green: "bg-green-50 text-fig-green",
  red: "bg-red-50 text-fig-red",
  purple: "bg-purple-50 text-fig-purple",
};

export function KpiCard({
  value,
  label,
  icon,
  tone = "slate",
}: {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="flex items-center gap-3 rounded-fig-card border border-fig-border bg-white p-4 shadow-fig-card">
      {icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>{icon}</span>}
      <div>
        <div className="text-xl font-bold leading-tight text-fig-text">{value}</div>
        <div className="text-xs text-fig-muted">{label}</div>
      </div>
    </div>
  );
}

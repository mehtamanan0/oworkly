const STATUS_TONE: Record<string, string> = {
  // qualification_case statuses
  DRAFT: "bg-slate-100 text-slate-600",
  NOT_ELIGIBLE: "bg-red-50 text-fig-red",
  TRAINING_REQUIRED: "bg-orange-50 text-fig-orange",
  READY_FOR_ASSESSMENT: "bg-blue-50 text-fig-blue",
  ASSESSMENT_IN_PROGRESS: "bg-blue-50 text-fig-blue",
  FAILED: "bg-red-50 text-fig-red",
  RETEST_COOLING: "bg-orange-50 text-fig-orange",
  PENDING_APPROVAL: "bg-orange-50 text-fig-orange",
  RETURNED_FOR_REVIEW: "bg-red-50 text-fig-red",
  APPROVED: "bg-green-50 text-fig-green",
  CERTIFIED: "bg-green-50 text-fig-green",
  EXPIRED: "bg-slate-100 text-slate-600",
  RENEWAL_IN_PROGRESS: "bg-orange-50 text-fig-orange",
  CANCELLED: "bg-slate-100 text-slate-600",
  // generic
  ACTIVE: "bg-green-50 text-fig-green",
  IN_SETUP: "bg-orange-50 text-fig-orange",
  PENDING: "bg-slate-100 text-slate-600",
  APPROVED_ACTION: "bg-green-50 text-fig-green",
  RETURNED: "bg-red-50 text-fig-red",
  PASS: "bg-green-50 text-fig-green",
  FAIL: "bg-red-50 text-fig-red",
  CONNECTED: "bg-green-50 text-fig-green",
  DEGRADED: "bg-orange-50 text-fig-orange",
  DISCONNECTED: "bg-red-50 text-fig-red",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status.toUpperCase()] ?? "bg-slate-100 text-slate-600";
  const text = label ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{text}</span>;
}

// Primary-level colors (L1-L4) match primary_level_definition's seeded
// hex values exactly (server/ingestion migration 0004 seed): L1 slate, L2
// blue, L3 green, L4 purple.
const PRIMARY_LEVEL_TONE: Record<string, string> = {
  L1: "bg-slate-100 text-slate-600",
  L2: "bg-blue-50 text-fig-blue",
  L3: "bg-green-50 text-fig-green",
  L4: "bg-purple-50 text-fig-purple",
};

export function LevelBadge({ code, size = "sm" }: { code: string | null | undefined; size?: "sm" | "md" }) {
  if (!code) return <span className="text-fig-muted">—</span>;
  const primary = PRIMARY_LEVEL_TONE[code.toUpperCase()];
  const cls = primary ?? "bg-fig-navy text-white";
  const pad = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return <span className={`inline-flex items-center rounded font-semibold ${pad} ${cls}`}>{code}</span>;
}

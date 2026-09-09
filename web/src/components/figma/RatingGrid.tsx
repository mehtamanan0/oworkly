const LABELS = ["Poor", "Below Avg", "Average", "Good", "Excellent"];

export function RatingRow({
  title,
  description,
  value,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-fig-border py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fig-text">{title}</div>
        {description && <div className="text-xs text-fig-muted">{description}</div>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            title={LABELS[n - 1]}
            className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm font-semibold transition-colors ${
              value === n ? "border-fig-blue bg-blue-50 text-fig-blue" : "border-fig-border bg-white text-fig-text hover:border-fig-blue/50"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RatingGridHeader() {
  return (
    <div className="flex items-center justify-between border-b border-fig-border pb-2 text-[11px] font-medium uppercase tracking-wide text-fig-muted">
      <span>Evaluation Parameters</span>
      <div className="flex gap-1.5">
        {LABELS.map((l) => (
          <span key={l} className="w-9 text-center text-[10px] leading-tight">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

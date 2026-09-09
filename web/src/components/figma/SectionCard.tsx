import type { ReactNode } from "react";

export function SectionCard({
  title,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`rounded-fig-card border border-fig-border bg-white shadow-fig-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-fig-border px-5 py-3.5">
          <div className="text-sm font-semibold text-fig-text">{title}</div>
          {action}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  );
}

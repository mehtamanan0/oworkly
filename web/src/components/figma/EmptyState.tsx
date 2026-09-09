export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-fig-card border border-dashed border-fig-border bg-white px-6 py-16 text-center shadow-fig-card">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fig-bg text-fig-muted">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="text-sm font-semibold text-fig-text">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-fig-muted">{description}</p>}
    </div>
  );
}

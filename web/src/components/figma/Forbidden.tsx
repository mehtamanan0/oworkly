// M15: a real forbidden-state UI, not a blank page -- the brief explicitly
// calls out "show forbidden states rather than blank pages." Use whenever a
// query/mutation error is a 403 (ApiV2Error with status 403).
export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-fig-card border border-dashed border-fig-border bg-white px-6 py-16 text-center shadow-fig-card">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-fig-red">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <path d="M12 15v2m-6.5 3h13a2 2 0 001.75-2.97l-6.5-11.9a2 2 0 00-3.5 0l-6.5 11.9A2 2 0 005.5 20z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 9v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      <div className="text-sm font-semibold text-fig-text">You don't have permission to view this</div>
      <p className="mt-1 max-w-sm text-sm text-fig-muted">{message ?? "Ask an administrator to grant you the required role or permission."}</p>
    </div>
  );
}

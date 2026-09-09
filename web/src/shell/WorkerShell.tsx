import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthV2 } from "../lib/AuthV2Context";
import { Avatar } from "../components/figma/Avatar";

export function WorkerShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuthV2();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-fig-bg">
      <header className="flex h-14 items-center justify-between border-b border-fig-border bg-white px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fig-navy text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 2z" fill="currentColor" />
            </svg>
          </span>
          <span className="text-[15px] font-bold text-fig-navy">OWorkly</span>
          <span className="ml-1 text-sm text-fig-muted">Self-Assessment Portal</span>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-fig-text">{user.displayName}</div>
              <div className="text-[11px] text-fig-muted">EMP code on file</div>
            </div>
            <Avatar name={user.displayName} size="sm" />
            <button
              type="button"
              onClick={() => {
                signOut();
                navigate("/worker-login");
              }}
              className="rounded-md border border-fig-border px-3 py-1.5 text-xs font-medium text-fig-text hover:bg-fig-bg"
            >
              Sign Out
            </button>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthV2 } from "./AuthV2Context";

export function ProtectedRoute({ children, requireWorker = false }: { children: ReactNode; requireWorker?: boolean }) {
  const { isAuthenticated, isLoading, user } = useAuthV2();
  // A stored token is trusted optimistically (isAuthenticated) the instant
  // the app boots, but it may have been revoked/expired since the last
  // visit -- wait for that one round-trip to resolve before deciding
  // whether to redirect to sign-in or render the page, so a soon-to-be-
  // invalidated session never flashes protected content first.
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-fig-bg">
        <div className="text-sm text-fig-muted">Loading your session…</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to={requireWorker ? "/worker-login" : "/login"} replace />;
  if (requireWorker && !user?.roles.includes("EMPLOYEE")) return <Navigate to="/worker-login" replace />;
  if (!requireWorker && user?.roles.includes("EMPLOYEE") && user.roles.length === 1) return <Navigate to="/worker/dashboard" replace />;
  return <>{children}</>;
}

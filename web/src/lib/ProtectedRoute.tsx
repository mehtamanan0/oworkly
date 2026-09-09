import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthV2 } from "./AuthV2Context";

export function ProtectedRoute({ children, requireWorker = false }: { children: ReactNode; requireWorker?: boolean }) {
  const { isAuthenticated, user } = useAuthV2();
  if (!isAuthenticated) return <Navigate to={requireWorker ? "/worker-login" : "/login"} replace />;
  if (requireWorker && !user?.roles.includes("EMPLOYEE")) return <Navigate to="/worker-login" replace />;
  if (!requireWorker && user?.roles.includes("EMPLOYEE") && user.roles.length === 1) return <Navigate to="/worker/dashboard" replace />;
  return <>{children}</>;
}

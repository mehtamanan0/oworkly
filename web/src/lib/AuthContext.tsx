import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type DemoUser } from "./api";

interface AuthContextValue {
  users: DemoUser[];
  currentUser: DemoUser | null;
  setCurrentUserId: (id: string) => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    localStorage.getItem("lms_demo_user_id")
  );

  useEffect(() => {
    api.get<DemoUser[]>("/users").then((rows) => {
      setUsers(rows);
      if (!currentUserId && rows.length) {
        const admin = rows.find((r) => r.role_codes.includes("ADMIN")) ?? rows[0];
        setCurrentUserId(admin.user_id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUser = useMemo(
    () => users.find((u) => u.user_id === currentUserId) ?? null,
    [users, currentUserId]
  );

  function handleSetUserId(id: string) {
    setCurrentUserId(id);
    localStorage.setItem("lms_demo_user_id", id);
  }

  function hasRole(...roles: string[]) {
    if (!currentUser) return false;
    return roles.some((r) => currentUser.role_codes.includes(r));
  }

  return (
    <AuthContext.Provider value={{ users, currentUser, setCurrentUserId: handleSetUserId, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  LND_TEAM: "L&D Team",
  MANAGER: "Manager",
  TRAINER: "Trainer",
  ASSESSOR: "Assessor",
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  AUDITOR: "Auditor",
};

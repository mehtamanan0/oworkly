import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi, clearSession, getStoredToken, getStoredUser, storeSession, type CurrentUserV2 } from "./apiV2";

interface AuthV2ContextValue {
  user: CurrentUserV2 | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (accessToken: string, user: CurrentUserV2) => void;
  signOut: () => void;
}

const AuthV2Context = createContext<AuthV2ContextValue | undefined>(undefined);

export function AuthV2Provider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUserV2 | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  // Starts true only when a stored token exists -- there is something to
  // verify with the server before the app can trust it's still valid
  // (not revoked/expired/deactivated since the last visit).
  const [isLoading, setIsLoading] = useState(() => !!getStoredToken());

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    authApi
      .session()
      .then((res) => {
        if (cancelled) return;
        storeSession(token, res.user);
        setUser(res.user);
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only re-verify when the token itself changes (sign-in/sign-out), not
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signIn = (accessToken: string, nextUser: CurrentUserV2) => {
    storeSession(accessToken, nextUser);
    setToken(accessToken);
    setUser(nextUser);
    setIsLoading(false);
  };

  const signOut = () => {
    // Best-effort server-side revocation -- a dev-login/worker-portal token
    // carries no session to revoke, so this 404/401s harmlessly for those;
    // the client-side clear below always happens regardless.
    authApi.logout().catch(() => {});
    clearSession();
    setToken(null);
    setUser(null);
    // Prevents stale, tenant-scoped data from a previous session (or a
    // different user entirely) from flashing on screen after the next
    // sign-in.
    queryClient.clear();
  };

  return (
    <AuthV2Context.Provider value={{ user, token, isAuthenticated: !!token, isLoading, signIn, signOut }}>
      {children}
    </AuthV2Context.Provider>
  );
}

export function useAuthV2() {
  const ctx = useContext(AuthV2Context);
  if (!ctx) throw new Error("useAuthV2 must be used within AuthV2Provider");
  return ctx;
}

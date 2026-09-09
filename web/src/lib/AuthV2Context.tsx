import { createContext, useContext, useState, type ReactNode } from "react";
import { clearSession, getStoredToken, getStoredUser, storeSession, type CurrentUserV2 } from "./apiV2";

interface AuthV2ContextValue {
  user: CurrentUserV2 | null;
  token: string | null;
  isAuthenticated: boolean;
  signIn: (accessToken: string, user: CurrentUserV2) => void;
  signOut: () => void;
}

const AuthV2Context = createContext<AuthV2ContextValue | undefined>(undefined);

export function AuthV2Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUserV2 | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  const signIn = (accessToken: string, nextUser: CurrentUserV2) => {
    storeSession(accessToken, nextUser);
    setToken(accessToken);
    setUser(nextUser);
  };

  const signOut = () => {
    clearSession();
    setToken(null);
    setUser(null);
  };

  return (
    <AuthV2Context.Provider value={{ user, token, isAuthenticated: !!token, signIn, signOut }}>
      {children}
    </AuthV2Context.Provider>
  );
}

export function useAuthV2() {
  const ctx = useContext(AuthV2Context);
  if (!ctx) throw new Error("useAuthV2 must be used within AuthV2Provider");
  return ctx;
}

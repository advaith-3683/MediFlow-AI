import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthSession, AuthUser } from "./types";
import { apiUrl } from "../config";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (session: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const validRole = (role: unknown): role is AuthUser["role"] => ["patient", "doctor", "admin"].includes(String(role));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback((session: AuthSession) => {
    if (!session.token || !validRole(session.user?.role)) throw new Error("Invalid session received from server");
    localStorage.setItem("token", session.token);
    localStorage.setItem("user", JSON.stringify(session.user));
    setToken(session.token);
    setUser(session.user);
  }, []);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const refresh = async () => {
      const current = ++revision;
      const storedToken = localStorage.getItem("token");
      if (!storedToken) { if (active) { logout(); setLoading(false); } return; }
      try {
        const response = await fetch(apiUrl("/api/auth/session"), { headers: { Authorization: `Bearer ${storedToken}` }, signal: controller.signal });
        if (!active || current !== revision || localStorage.getItem("token") !== storedToken) return;
        if (response.status === 401 || response.status === 403) { logout(); return; }
        if (!response.ok) throw new Error("Session refresh unavailable");
        const data = await response.json() as { user: AuthUser };
        if (active && current === revision && localStorage.getItem("token") === storedToken) login({ token: storedToken, user: data.user });
      } catch { /* Never restore an unvalidated cached identity on startup. Retry on focus/timer. */ }
      finally { if (active) setLoading(false); }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 30000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [logout, login]);

  useEffect(() => {
    window.addEventListener("mediflow:unauthorized", logout);
    return () => window.removeEventListener("mediflow:unauthorized", logout);
  }, [logout]);

  const value = useMemo(() => ({ user, token, isAuthenticated: Boolean(user && token), loading, login, logout }), [user, token, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

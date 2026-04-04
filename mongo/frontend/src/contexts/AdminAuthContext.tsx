"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type AdminAuthUser = {
  email: string;
};

type AdminAuthContextValue = {
  user: AdminAuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AdminAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (pathname?.startsWith("/admin/login")) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/auth/me", { credentials: "include" });
      if (!res.ok) {
        setUser(null);
      } else {
        const j = (await res.json()) as { email?: string | null };
        setUser(j.email ? { email: j.email } : null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/admin/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    window.location.href = "/admin/login";
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth debe usarse dentro de AdminAuthProvider");
  }
  return ctx;
}

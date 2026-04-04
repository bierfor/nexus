"use client";

import Link from "next/link";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export function FooterAdminLink() {
  const { user, loading } = useAdminAuth();
  if (loading || !user) return null;
  return (
    <Link
      href="/admin"
      className="text-stone-700 hover:text-stone-500"
      aria-label="Ir al panel de administración"
    >
      Panel
    </Link>
  );
}

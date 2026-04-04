import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--surface)] px-4 py-10 text-[var(--body)] md:px-8">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  );
}

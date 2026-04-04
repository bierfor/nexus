import type { ReactNode } from "react";

/**
 * Entrada suave solo con CSS: misma marca en servidor y cliente (sin estado → sin avisos de hidratación).
 */
export function FadeInSection({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`fade-in-section ${className}`.trim()}>{children}</div>;
}

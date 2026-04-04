"use client";

import type { ReactNode } from "react";
import { ViewTransition } from "react";

/**
 * Transiciones entre rutas (View Transitions API + integración Next).
 * Requiere `experimental.viewTransition` en next.config.
 */
export function PageViewTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="pf-vt-flow">
      {children}
    </ViewTransition>
  );
}

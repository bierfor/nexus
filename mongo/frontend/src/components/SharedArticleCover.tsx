"use client";

import type { ReactNode } from "react";
import { ViewTransition } from "react";

/** Misma `name` en listado y en artículo para morph de portada (MIP). */
export function SharedArticleCover({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition name={`pf-cover-${slug}`} share="pf-vt-cover-share">
      <div className="dom-isolate relative h-full w-full">{children}</div>
    </ViewTransition>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { graphqlEndpoint } from "@/lib/graphql";

const MUTATION = `
  mutation RecordArticleView($slug: String!) {
    recordArticleView(slug: $slug)
  }
`;

type Props = {
  slug: string;
  initialCount: number;
};

export function ArticleViewCounter({ slug, initialCount }: Props) {
  const [count, setCount] = useState(initialCount);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.NEXT_PUBLIC_GRAPHQL_URL?.trim() &&
      !process.env.NEXT_PUBLIC_BACKEND_URL?.trim()
    ) {
      return;
    }

    const url = graphqlEndpoint();

    void (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: MUTATION, variables: { slug } }),
        });
        const json = (await res.json()) as {
          data?: { recordArticleView?: number };
        };
        const n = json?.data?.recordArticleView;
        if (typeof n === "number") setCount(n);
      } catch {
        /* sin telemetría en cliente */
      }
    })();
  }, [slug]);

  const label = count === 1 ? "vista" : "vistas";

  return (
    <span className="tabular-nums" title="Vistas (una por IP cada ~45 min)">
      {count.toLocaleString("es")} {label}
    </span>
  );
}

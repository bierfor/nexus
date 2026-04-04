"use client";

import { useEffect, useState } from "react";

/** Barra fija según scroll dentro del `<article>` principal. */
export function ArticleReadingProgress() {
  const [p, setP] = useState(0);

  useEffect(() => {
    const article = document.querySelector("main article");
    if (!article) return;

    const update = () => {
      const rect = article.getBoundingClientRect();
      const h = rect.height;
      const denom = Math.max(h - window.innerHeight, 1);
      const raw = Math.min(Math.max(-rect.top, 0), denom);
      setP(raw / denom);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-50 h-[3px] w-full bg-[var(--border)]/25"
      aria-hidden
    >
      <div
        className="h-full origin-left bg-[var(--accent)] transition-[transform] duration-150 ease-out will-change-transform"
        style={{ transform: `scaleX(${p})` }}
      />
    </div>
  );
}

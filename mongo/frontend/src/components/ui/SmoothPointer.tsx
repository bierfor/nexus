"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  maxShift?: number;
};

/**
 * Suaviza micro-movimientos del mouse con RAF y lerp.
 * Se desactiva en pantallas tactiles o con reduced-motion.
 */
export function SmoothPointer({
  children,
  className,
  maxTilt = 4,
  maxShift = 8,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduced || coarse) return;

    let raf = 0;
    let hovering = false;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const animate = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      const rx = (-cy / maxShift) * maxTilt;
      const ry = (cx / maxShift) * maxTilt;
      el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (hovering || Math.abs(cx) > 0.01 || Math.abs(cy) > 0.01) {
        raf = window.requestAnimationFrame(animate);
      } else {
        el.style.willChange = "";
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      tx = nx * maxShift;
      ty = ny * maxShift;
      if (!hovering) return;
      if (!raf) raf = window.requestAnimationFrame(animate);
    };

    const onEnter = () => {
      hovering = true;
      el.style.willChange = "transform";
      if (!raf) raf = window.requestAnimationFrame(animate);
    };

    const onLeave = () => {
      hovering = false;
      tx = 0;
      ty = 0;
      if (!raf) raf = window.requestAnimationFrame(animate);
    };

    el.addEventListener("mousemove", onMove, { passive: true });
    el.addEventListener("mouseenter", onEnter, { passive: true });
    el.addEventListener("mouseleave", onLeave, { passive: true });

    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [maxShift, maxTilt]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

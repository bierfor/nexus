"use client";

import { LeadMagnet } from "@/components/LeadMagnet";

/** Solo cliente: evita hidratación incoherente si el HTML del RSC va desfasado respecto al bundle del formulario. */
export default function LeadMagnetHeroClient() {
  return <LeadMagnet variant="hero" />;
}

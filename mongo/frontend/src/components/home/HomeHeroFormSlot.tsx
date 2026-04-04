"use client";

import dynamic from "next/dynamic";

function HeroLeadFormSkeleton() {
  return (
    <div className="w-full min-w-0 max-w-[550px] overflow-hidden text-left" aria-hidden>
      <div className="mt-5 space-y-3">
        <div className="h-[52px] w-full max-w-full animate-pulse rounded-lg border border-white/10 bg-neutral-800/60" />
        <div className="h-3 w-48 max-w-full animate-pulse rounded-full bg-neutral-700/80" />
        <div className="h-20 w-full max-w-full animate-pulse rounded-lg bg-neutral-800/40" />
      </div>
    </div>
  );
}

const LeadMagnetHeroClient = dynamic(() => import("@/components/LeadMagnetHeroClient"), {
  ssr: false,
  loading: () => <HeroLeadFormSkeleton />,
});

export function HomeHeroFormSlot() {
  return <LeadMagnetHeroClient />;
}

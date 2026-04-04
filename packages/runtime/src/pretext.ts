/**
 * Pretext — merged `nxPretext(ctx)` payloads from layouts + page, embedded in SSR as
 * `<script type="application/json" id="__NEXUS_PRETEXT__">` and read before island hydration.
 */

import { deserialize } from '@nexus_js/serialize';

let _pretext: Record<string, unknown> = {};

/** Parse `__NEXUS_PRETEXT__` from the document (called automatically before hydrating islands). */
export function initPretextFromDocument(): void {
  const el = document.getElementById('__NEXUS_PRETEXT__');
  const raw = el?.textContent?.trim();
  if (!raw) {
    _pretext = {};
    return;
  }
  try {
    _pretext = deserialize(raw) as Record<string, unknown>;
  } catch {
    _pretext = {};
  }
}

/** Read-only merged pretext object (same keys as server `ctx.pretext`). */
export function getPretext(): Readonly<Record<string, unknown>> {
  return _pretext;
}

/**
 * Primary context for islands — zero client fetch; same payload the server used for SSR.
 * Prefer destructuring: `const { flow } = $pretext()`.
 */
export function $pretext(): Record<string, unknown> {
  return _pretext;
}

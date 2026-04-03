/**
 * Nexus Island Runtime — selective hydration engine.
 * Activates interactive "islands" on an otherwise static HTML page.
 */

import { $state, $derived, $effect, batch } from './runes.js';

export { $state, $derived, $effect, batch };

export type HydrationStrategy =
  | 'client:load'
  | 'client:idle'
  | 'client:visible'
  | 'client:media'
  | 'server:only';

export interface IslandOptions {
  template: string;
  strategy?: HydrationStrategy;
  props?: Record<string, unknown>;
  mediaQuery?: string;
}

export interface IslandInstance {
  el: Element;
  destroy: () => void;
  update: (props: Record<string, unknown>) => void;
}

/** Registry of all mounted islands on the page */
const islandRegistry = new Map<string, IslandInstance>();

/**
 * Core island hydration function.
 * Called by the generated client module for each interactive island.
 */
export function createIsland(
  el: Element,
  opts: IslandOptions,
): IslandInstance {
  const cleanups: Array<() => void> = [];

  function hydrate(): void {
    // Inject props as reactive signals
    const propSignals: Record<string, { value: unknown }> = {};
    for (const [key, val] of Object.entries(opts.props ?? {})) {
      propSignals[key] = $state(val);
    }

    // Mark element as hydrated
    el.setAttribute('data-nexus-hydrated', 'true');

    // Attach event listeners from data attributes
    attachEventListeners(el, propSignals, cleanups);
  }

  function destroy(): void {
    for (const cleanup of cleanups) cleanup();
    el.removeAttribute('data-nexus-hydrated');
    const id = el.getAttribute('data-nexus-island');
    if (id) islandRegistry.delete(id);
  }

  function update(newProps: Record<string, unknown>): void {
    batch(() => {
      for (const [key, val] of Object.entries(newProps)) {
        if (el.hasAttribute(`data-prop-${key}`)) {
          el.setAttribute(`data-prop-${key}`, String(val));
        }
      }
    });
  }

  hydrate();

  const instance: IslandInstance = { el, destroy, update };
  const islandId = el.getAttribute('data-nexus-island') ?? crypto.randomUUID();
  el.setAttribute('data-nexus-island', islandId);
  islandRegistry.set(islandId, instance);

  return instance;
}

/**
 * Scans the document for islands and hydrates them according to their strategy.
 * Called once on page load by the Nexus bootstrap script.
 */
export function hydrateAll(): void {
  const islands = document.querySelectorAll('[data-nexus-island]');

  for (const el of islands) {
    const strategy = (el.getAttribute('data-nexus-strategy') ??
      'client:load') as HydrationStrategy;

    switch (strategy) {
      case 'client:load':
        scheduleHydration(el, () => hydrateElement(el));
        break;
      case 'client:idle':
        requestIdleCallback(() => hydrateElement(el), { timeout: 2000 });
        break;
      case 'client:visible':
        hydrateOnVisible(el);
        break;
      case 'client:media':
        hydrateOnMedia(el);
        break;
      case 'server:only':
        // Never hydrate — server rendered HTML only
        break;
    }
  }
}

function scheduleHydration(el: Element, fn: () => void): void {
  // Use microtask to avoid blocking paint
  queueMicrotask(fn);
}

async function hydrateElement(el: Element): Promise<void> {
  if (el.getAttribute('data-nexus-hydrated') === 'true') return;

  const componentPath = el.getAttribute('data-nexus-component');
  if (!componentPath) return;

  try {
    // Dynamic import of the island's client bundle
    const mod = await import(/* @vite-ignore */ componentPath);
    if (typeof mod.mount === 'function') {
      const props = getPropsFromElement(el);
      mod.mount(el, props);
    }
  } catch (err) {
    console.error(`[Nexus] Failed to hydrate island at ${componentPath}:`, err);
  }
}

function hydrateOnVisible(el: Element): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.unobserve(el);
          hydrateElement(el);
        }
      }
    },
    { rootMargin: '50px' },
  );
  observer.observe(el);
}

function hydrateOnMedia(el: Element): void {
  const query = el.getAttribute('data-nexus-media') ?? '';
  const mq = window.matchMedia(query);

  const check = (): void => {
    if (mq.matches) {
      mq.removeEventListener('change', check);
      hydrateElement(el);
    }
  };

  check();
  mq.addEventListener('change', check);
}

function getPropsFromElement(el: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const raw = el.getAttribute('data-nexus-props');
  if (raw) {
    try {
      Object.assign(props, JSON.parse(atob(raw)));
    } catch {
      // Invalid props encoding
    }
  }
  return props;
}

function attachEventListeners(
  el: Element,
  _signals: Record<string, { value: unknown }>,
  cleanups: Array<() => void>,
): void {
  // Find all [data-on-*] attributes and attach listeners
  for (const attr of el.attributes) {
    if (!attr.name.startsWith('data-on-')) continue;
    const eventName = attr.name.slice('data-on-'.length);
    const handlerName = attr.value;

    const handler = (e: Event): void => {
      const fn = (window as Record<string, unknown>)[handlerName];
      if (typeof fn === 'function') fn(e);
    };

    el.addEventListener(eventName, handler);
    cleanups.push(() => el.removeEventListener(eventName, handler));
  }
}

/** Bootstrap: auto-runs when the runtime script loads in the browser */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
}

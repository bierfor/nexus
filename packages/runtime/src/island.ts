/**
 * Nexus Island Runtime — selective hydration engine.
 * Activates interactive "islands" on an otherwise static HTML page.
 */

import { $state, $derived, $effect, batch } from './runes.js';
import { initPretextFromDocument } from './pretext.js';

export { $state, $derived, $effect, batch };
/** Same as `@nexus_js/runtime` — available in island bundles without a second import. */
export { $pretext, getPretext } from './pretext.js';

export type HydrationStrategy =
  | 'client:load'
  | 'client:idle'
  | 'client:visible'
  | 'client:media'
  | 'server:only';

export interface IslandOptions {
  /** Raw template (legacy) */
  template?: string;
  /** Template with `__NX_0__` placeholders; event attrs stripped at compile time */
  processedTemplate?: string;
  /** One thunk per placeholder, evaluated in an $effect (closes over rune signals) */
  exprFns?: Array<() => unknown>;
  strategy?: HydrationStrategy;
  props?: Record<string, unknown>;
  mediaQuery?: string;
  /** Event delegation target inside the island (survives DOM replacement each tick) */
  delegatedClickSelector?: string;
  onDelegatedClick?: (e: Event) => void;
}

export interface IslandInstance {
  el: Element;
  destroy: () => void;
  update: (props: Record<string, unknown>) => void;
}

/** Registry of all mounted islands on the page */
const islandRegistry = new Map<string, IslandInstance>();

function escapeIslandText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
    const propSignals: Record<string, { value: unknown }> = {};
    for (const [key, val] of Object.entries(opts.props ?? {})) {
      propSignals[key] = $state(val);
    }

    el.setAttribute('data-nexus-hydrated', 'true');

    const processed = opts.processedTemplate;
    const exprFns = opts.exprFns;

    if (processed && exprFns?.length) {
      const stop = $effect(() => {
        let html = processed;
        for (let i = 0; i < exprFns.length; i++) {
          const thunk = exprFns[i];
          if (!thunk) continue;
          const v = thunk();
          html = html.replace(`__NX_${i}__`, escapeIslandText(String(v)));
        }
        const inner = el.firstElementChild;
        if (inner) inner.outerHTML = html;
      });
      cleanups.push(stop);
    }

    if (opts.delegatedClickSelector && opts.onDelegatedClick) {
      const sel = opts.delegatedClickSelector;
      const cb = opts.onDelegatedClick;
      const fn = (e: Event) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest(sel)) cb(e);
      };
      el.addEventListener('click', fn);
      cleanups.push(() => el.removeEventListener('click', fn));
    }

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
  initPretextFromDocument();

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
      const fn = (window as unknown as Record<string, unknown>)[handlerName];
      if (typeof fn === 'function') fn(e);
    };

    el.addEventListener(eventName, handler);
    cleanups.push(() => el.removeEventListener(eventName, handler));
  }
}

function refreshPretextAndHydrate(): void {
  initPretextFromDocument();
  hydrateAll();
}

/** After streaming SSR fills a hole, re-read Pretext and hydrate any new islands. */
if (typeof document !== 'undefined') {
  document.addEventListener('nexus:stream-chunk', refreshPretextAndHydrate);
  document.addEventListener('nexus:stream-complete', refreshPretextAndHydrate);
}

/** Bootstrap: auto-runs when the runtime script loads in the browser */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
}

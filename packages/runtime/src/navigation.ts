/**
 * Nexus SPA Navigation — Server-Driven DOM Morphing.
 *
 * The core question: "How do you handle state rehydration when the user
 * navigates between routes without a page refresh?"
 *
 * ─── THE STRATEGY: Server-Driven Morphing ─────────────────────────────────
 *
 * We DON'T do client-side routing with a VDOM (React Router style).
 * We DON'T do full page reloads (MPA style).
 * We DO: fetch the new page HTML from the server, morph the current DOM
 * into the new DOM surgically, and preserve island state across the transition.
 *
 * Why morphing instead of innerHTML replacement?
 *   innerHTML = destroy all islands + re-create = flicker + lost state
 *   morphing  = surgical diff + update only what changed = smooth + preserved
 *
 * ─── THE ALGORITHM ────────────────────────────────────────────────────────
 *
 *   1. User clicks <a href="/new-route"> (or calls navigate('/new-route'))
 *   2. Intercept: preventDefault(), push to history
 *   3. Fetch: GET /_nexus/navigate?path=/new-route
 *      Server returns: { html, head, islands, props }
 *   4. Diff <head>: update title, meta, canonical (via @nexus_js/head)
 *   5. Morph <body>: walk the DOM tree
 *      a. Same node type + same [data-nx-key] → update attributes + children
 *      b. Island node ([data-nexus-island]) with same component path:
 *         → PRESERVE the island (skip re-hydration, keep its $state)
 *      c. New island in new page → mount fresh
 *      d. Removed island → destroy() cleanly
 *   6. Update URL, fire 'nexus:navigate' event, restore scroll
 *
 * ─── STATE PRESERVATION RULES ─────────────────────────────────────────────
 *
 *   Island state is preserved when ALL of these match:
 *     - Same [data-nexus-component] path (same component file)
 *     - Same [data-nx-key] if provided (explicit identity)
 *     - OR same position in the layout tree (implicit identity)
 *
 *   State is reset when:
 *     - The component file changes
 *     - The user explicitly passes key={Math.random()} (force reset)
 *     - The island is in a part of the layout that changed
 *
 * ─── LAYOUT PERSISTENCE ───────────────────────────────────────────────────
 *
 *   Shared layouts (+layout.nx) are identified by [data-nx-layout="path"].
 *   The morphing algorithm skips islands inside unchanged layouts,
 *   achieving the SvelteKit-style "layout persistence" where the
 *   sidebar counter doesn't reset when navigating between pages.
 *
 * ─── PREFETCHING ──────────────────────────────────────────────────────────
 *
 *   Links get automatic prefetching based on:
 *   - data-nx-prefetch="hover"   → prefetch on mouseenter (default)
 *   - data-nx-prefetch="load"    → prefetch on page load
 *   - data-nx-prefetch="visible" → prefetch when link enters viewport
 *   - data-nx-prefetch="false"   → disable prefetch for this link
 */

import { hydrateAll } from './island.js';
import { $state } from './runes.js';
import { snapshotStore, importStore } from './store.js';

// ── Public API ────────────────────────────────────────────────────────────────

export interface NavigateOptions {
  /** Replace current history entry instead of pushing */
  replace?: boolean;
  /** Scroll to top after navigation (default: true) */
  scroll?: boolean;
  /** Override prefetch cache */
  noCache?: boolean;
}

export interface NavigationState {
  url: string;
  pending: boolean;
  error: string | null;
}

/** Reactive navigation state — use in islands to show loading indicators */
export const navigation = {
  url: $state(typeof location !== 'undefined' ? location.href : ''),
  pending: $state(false),
  error: $state<string | null>(null),
};

/**
 * Programmatic SPA navigation.
 * Equivalent to `<a href="/path">` but callable from island code.
 */
export async function navigate(
  path: string,
  opts: NavigateOptions = {},
): Promise<void> {
  await performNavigation(path, opts);
}

/**
 * Prefetches a route in the background.
 * Call this in `$effect` or on mouse hover for instant navigation.
 */
export function prefetch(path: string): void {
  if (typeof document === 'undefined') return;
  if (prefetchCache.has(path)) return;

  // Use <link rel="prefetch"> for network-level prefetch
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = navigateEndpoint(path);
  link.as = 'fetch';
  link.crossOrigin = 'same-origin';
  document.head.appendChild(link);

  // Also start the JSON fetch to warm up our cache
  fetchRoute(path).then((data) => {
    if (data) prefetchCache.set(path, data);
  }).catch(() => {});
}

// ── Initialization ────────────────────────────────────────────────────────────

/** Bootstrap: call once when the page loads */
export function initNavigation(): void {
  if (typeof document === 'undefined') return;

  // Intercept all link clicks
  document.addEventListener('click', handleLinkClick, { passive: false });

  // Handle browser back/forward
  window.addEventListener('popstate', handlePopState);

  // Setup prefetch observers
  setupPrefetchObservers();

  // Store initial page state for back navigation
  history.replaceState({ nx: true, path: location.pathname }, '', location.href);
}

// ── Internal navigation engine ────────────────────────────────────────────────

const NAVIGATE_ENDPOINT = '/_nexus/navigate';
const prefetchCache = new Map<string, NavigationPayload>();

interface NavigationPayload {
  html: string;
  headHTML: string;
  islandManifest: Array<{ id: string; componentPath: string }>;
  timestamp: number;
}

function navigateEndpoint(path: string): string {
  return `${NAVIGATE_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

async function performNavigation(path: string, opts: NavigateOptions): Promise<void> {
  if (navigation.pending.value) return;

  navigation.pending.value = true;
  navigation.error.value = null;

  try {
    // Checkpoint all persisted island state before leaving the current page
    snapshotStore();

    // Check prefetch cache first
    const cached = !opts.noCache ? prefetchCache.get(path) : null;
    const payload = cached ?? (await fetchRoute(path));

    if (!payload) {
      throw new Error(`Failed to fetch route: ${path}`);
    }

    // Update history
    if (opts.replace) {
      history.replaceState({ nx: true, path }, '', path);
    } else {
      history.pushState({ nx: true, path }, '', path);
    }

    // Apply the navigation
    await applyNavigation(payload, opts);

    navigation.url.value = location.href;

    // Fire navigation event
    document.dispatchEvent(
      new CustomEvent('nexus:navigate', { detail: { path, payload } }),
    );
  } catch (err) {
    navigation.error.value = err instanceof Error ? err.message : String(err);
    console.error('[Nexus Navigation]', err);
  } finally {
    navigation.pending.value = false;
  }
}

async function fetchRoute(path: string): Promise<NavigationPayload | null> {
  try {
    const res = await fetch(navigateEndpoint(path), {
      headers: {
        'x-nexus-navigate': '1',
        'accept': 'application/json',
      },
    });

    if (!res.ok) return null;
    return await res.json() as NavigationPayload;
  } catch {
    return null;
  }
}

async function applyNavigation(
  payload: NavigationPayload,
  opts: NavigateOptions,
): Promise<void> {
  // 0. Rehydrate global store from server snapshot (Hydration Miss = 0)
  if ((payload as NavigationPayload & { storeSnapshot?: string }).storeSnapshot) {
    importStore((payload as NavigationPayload & { storeSnapshot: string }).storeSnapshot);
  }

  // 1. Take a snapshot of current islands to preserve state
  const preserved = snapshotIslands();

  // 2. Update <head> (title, meta, etc.)
  applyHeadUpdate(payload.headHTML);

  // 3. Morph <body> — surgical DOM update
  morphBody(payload.html, preserved);

  // 4. Hydrate new islands (skip preserved ones)
  hydrateAll();

  // 5. Restore scroll position
  if (opts.scroll !== false) {
    const hash = location.hash;
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
}

// ── Island State Preservation ──────────────────────────────────────────────────

interface IslandSnapshot {
  id: string;
  componentPath: string;
  key: string;
  element: Element;
}

function snapshotIslands(): Map<string, IslandSnapshot> {
  const snapshots = new Map<string, IslandSnapshot>();

  document.querySelectorAll('[data-nexus-island]').forEach((el) => {
    const id = el.getAttribute('data-nexus-island') ?? '';
    const componentPath = el.getAttribute('data-nexus-component') ?? '';
    const key = el.getAttribute('data-nx-key') ?? componentPath;

    snapshots.set(key, { id, componentPath, key, element: el });
  });

  return snapshots;
}

// ── DOM Morphing ───────────────────────────────────────────────────────────────

/**
 * Morphs the current <body> into the new HTML.
 * Preserves islands that survive the navigation.
 *
 * Algorithm: Walk both trees simultaneously.
 *   - Same tag + same key → patch attributes, recurse into children
 *   - Island with same component → skip (keep existing DOM element)
 *   - New node → insert
 *   - Removed node → remove (call island.destroy() if it's an island)
 */
function morphBody(newHTML: string, preserved: Map<string, IslandSnapshot>): void {
  const parser = new DOMParser();
  const newDoc = parser.parseFromString(newHTML, 'text/html');
  const newBody = newDoc.body;
  const oldBody = document.body;

  morphNode(oldBody, newBody, preserved);
}

function morphNode(
  oldNode: Element,
  newNode: Element,
  preserved: Map<string, IslandSnapshot>,
): void {
  // Update attributes
  patchAttributes(oldNode, newNode);

  const oldChildren = [...oldNode.childNodes];
  const newChildren = [...newNode.childNodes];

  let oldIdx = 0;
  let newIdx = 0;

  while (newIdx < newChildren.length) {
    const newChild = newChildren[newIdx];
    const oldChild = oldChildren[oldIdx];

    if (!newChild) break;

    // Check if this new child is a preserved island
    if (newChild instanceof Element) {
      const newIslandId = newChild.getAttribute('data-nexus-island');
      const newComponentPath = newChild.getAttribute('data-nexus-component');
      const newKey = newChild.getAttribute('data-nx-key') ?? newComponentPath ?? '';

      const snap = preserved.get(newKey);
      if (snap && newComponentPath === snap.componentPath) {
        // PRESERVE: replace new placeholder with existing island element
        if (oldChild !== snap.element) {
          oldNode.insertBefore(snap.element, oldChild ?? null);
        }
        oldIdx++;
        newIdx++;
        continue;
      }
    }

    if (!oldChild) {
      // New node has more children — append
      oldNode.appendChild(newChild.cloneNode(true));
      newIdx++;
      continue;
    }

    if (oldChild.nodeType !== newChild.nodeType) {
      // Different type — replace
      oldNode.replaceChild(newChild.cloneNode(true), oldChild);
      oldIdx++;
      newIdx++;
      continue;
    }

    if (oldChild instanceof Element && newChild instanceof Element) {
      if (oldChild.tagName === newChild.tagName) {
        // Same element — recurse
        morphNode(oldChild, newChild, preserved);
      } else {
        // Different tags — replace
        oldNode.replaceChild(newChild.cloneNode(true), oldChild);
      }
    } else if (oldChild.nodeType === Node.TEXT_NODE) {
      // Text node — update content
      if (oldChild.textContent !== newChild.textContent) {
        oldChild.textContent = newChild.textContent;
      }
    }

    oldIdx++;
    newIdx++;
  }

  // Remove extra old children
  while (oldIdx < oldChildren.length) {
    const toRemove = oldChildren[oldIdx];
    if (toRemove) {
      // Destroy island if applicable
      const islandId = toRemove instanceof Element
        ? toRemove.getAttribute('data-nexus-island')
        : null;
      if (islandId) {
        toRemove.dispatchEvent(new Event('nexus:destroy'));
      }
      oldNode.removeChild(toRemove);
    }
    oldIdx++;
  }
}

function patchAttributes(oldEl: Element, newEl: Element): void {
  // Add/update new attributes
  for (const attr of newEl.attributes) {
    if (oldEl.getAttribute(attr.name) !== attr.value) {
      oldEl.setAttribute(attr.name, attr.value);
    }
  }
  // Remove old attributes not in new element
  for (const attr of [...oldEl.attributes]) {
    if (!newEl.hasAttribute(attr.name)) {
      oldEl.removeAttribute(attr.name);
    }
  }
}

function applyHeadUpdate(headHTML: string): void {
  if (!headHTML) return;

  // Update title
  const titleMatch = /<title>([^<]*)<\/title>/.exec(headHTML);
  if (titleMatch?.[1]) document.title = titleMatch[1];

  // Remove previous navigation-injected metas (marked with data-nx-nav)
  document.querySelectorAll('[data-nx-nav]').forEach((el) => el.remove());

  // Inject new metas
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<head>${headHTML}</head>`, 'text/html');
  for (const el of doc.head.children) {
    if (el.tagName === 'TITLE') continue;
    el.setAttribute('data-nx-nav', '');
    document.head.appendChild(el.cloneNode(true));
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────────

function handleLinkClick(e: MouseEvent): void {
  const target = (e.target as Element).closest('a');
  if (!target) return;

  const href = target.getAttribute('href');
  if (!href) return;

  // Skip: external, hash-only, download, target="_blank", data-nx-prefetch="false"
  if (
    href.startsWith('http') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href === '#' ||
    target.hasAttribute('download') ||
    target.getAttribute('target') === '_blank' ||
    target.getAttribute('data-nx-prefetch') === 'false' ||
    target.getAttribute('data-nx-external') !== null
  ) {
    return;
  }

  e.preventDefault();
  navigate(href).catch(console.error);
}

function handlePopState(e: PopStateEvent): void {
  if (e.state?.nx) {
    navigate(location.pathname, { replace: true, noCache: true }).catch(console.error);
  }
}

function setupPrefetchObservers(): void {
  // Hover prefetch (default)
  document.addEventListener('mouseover', (e) => {
    const target = (e.target as Element).closest('a[href]');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#')) return;
    const prefetchMode = target.getAttribute('data-nx-prefetch') ?? 'hover';
    if (prefetchMode === 'hover' || prefetchMode === '') {
      prefetch(href);
    }
  }, { passive: true });

  // Viewport prefetch
  const visibleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const target = entry.target as Element;
      const href = target.getAttribute('href') ?? '';
      if (href && !href.startsWith('http')) prefetch(href);
      visibleObserver.unobserve(target);
    }
  }, { rootMargin: '100px' });

  document.querySelectorAll('a[data-nx-prefetch="visible"]').forEach((el) => {
    visibleObserver.observe(el);
  });
}

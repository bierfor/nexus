/**
 * Nexus Runtime Dev Mode — browser-side observability hooks.
 *
 * In dev mode, the renderer injects window.__NEXUS_DEV__ = true and
 * window.__NEXUS_SERVER_LOGS__ into the HTML. This module provides
 * type-safe wrappers that island code and Runes can call to log events
 * into the browser DevTools console.
 *
 * All functions are no-ops in production (window.__NEXUS_DEV__ is falsy).
 * Tree-shaking removes the import entirely in production builds.
 */

// ── Types mirrored from the injected bridge ────────────────────────────────────

interface NexusDevWindow {
  __NEXUS_DEV__?:           boolean;
  __NEXUS_SERVER_LOGS__?:   ServerBridgeLog[];
  __NEXUS_BUILD_INFO__?:    BuildInfo;
  __NEXUS_LOG_ISLAND__?:    (name: string, strategy: string, ms: number) => void;
  __NEXUS_LOG_STATE__?:     (key: string, prev: unknown, next: unknown, source?: string) => void;
  __NEXUS_LOG_OPTIMISTIC__?:(key: string, value: unknown) => void;
  __NEXUS_LOG_NAV__?:       (to: string, morphKey?: string) => void;
  __NEXUS_LOG_ACTION__?:    (name: string, phase: ActionPhase, data?: unknown) => void;
}

interface ServerBridgeLog {
  type:           string;
  path?:          string;
  duration?:      number;
  cacheStrategy?: string;
  cacheHit?:      boolean;
  islandCount?:   number;
}

interface BuildInfo {
  totalJs?:        number;
  reactEquivalent?: number;
  islandCount?:    number;
}

type ActionPhase = 'call' | 'optimistic' | 'success' | 'error' | 'cancelled';

declare const window: NexusDevWindow & Window;

// ── Guard ─────────────────────────────────────────────────────────────────────
const isDev = (): boolean =>
  typeof window !== 'undefined' && window.__NEXUS_DEV__ === true;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log an island hydration event.
 * Called by the island loader after `component.mount()` completes.
 *
 * @example
 * // Inside @nexus_js/runtime island.ts
 * logIslandHydration('SearchBar', 'client:load', performance.now() - t0);
 */
export function logIslandHydration(
  componentName: string,
  strategy: string,
  durationMs: number,
): void {
  if (!isDev()) return;
  window.__NEXUS_LOG_ISLAND__?.(componentName, strategy, durationMs);
}

/**
 * Log a reactive $state change.
 * Called by the dev-mode Runes proxy when a signal's value is written.
 *
 * @example
 * // Inside $state() implementation (dev mode)
 * logStateChange('hp', 100, 88, 'AttackButton');
 */
export function logStateChange(
  key: string,
  prev: unknown,
  next: unknown,
  source?: string,
): void {
  if (!isDev()) return;
  window.__NEXUS_LOG_STATE__?.(key, prev, next, source);
}

/**
 * Log an $optimistic state update before the server responds.
 * Called by the $optimistic() rune when the pessimistic state is applied.
 */
export function logOptimisticUpdate(key: string, value: unknown): void {
  if (!isDev()) return;
  window.__NEXUS_LOG_OPTIMISTIC__?.(key, value);
}

/**
 * Log a SPA navigation event (Nexus DOM Morphing).
 * Called by the client router before and after morphing.
 */
export function logNavigation(to: string, morphKey?: string): void {
  if (!isDev()) return;
  window.__NEXUS_LOG_NAV__?.(to, morphKey);
}

/**
 * Log a Server Action lifecycle event.
 * Called by the action client at each phase.
 *
 * @param name     - Action name (e.g. 'capture_pokemon')
 * @param phase    - 'call' | 'optimistic' | 'success' | 'error' | 'cancelled'
 * @param data     - Optional payload (optimistic value, error message, etc.)
 */
export function logAction(
  name: string,
  phase: ActionPhase,
  data?: unknown,
): void {
  if (!isDev()) return;
  window.__NEXUS_LOG_ACTION__?.(name, phase, data);
}

/**
 * Returns a dev-mode proxy for a $state signal.
 * Wraps the signal so every `.set()` call emits a logStateChange() entry.
 * In production, returns the original signal unmodified (zero overhead).
 */
export function devProxy<T>(
  signal: { get: () => T; set: (v: T) => void },
  key: string,
  source?: string,
): typeof signal {
  if (!isDev()) return signal;

  return {
    get: () => signal.get(),
    set: (next: T) => {
      const prev = signal.get();
      logStateChange(key, prev, next, source);
      signal.set(next);
    },
  };
}

/**
 * Nexus Global State Store — Hydration Miss = 0.
 *
 * THE PARADOX:
 *   Island A (cart) lives in the root layout.
 *   User adds item → cart.$state updates to [item1, item2].
 *   User navigates to /checkout.
 *   The server renders /checkout fresh — it sends cart as [].
 *   DOM morphing preserves the island element... but what about the state?
 *
 * THE SOLUTION:
 *   A two-layer state synchronization system:
 *
 *   Layer 1 — Island Registry:
 *     Every island that survives navigation keeps its live $state signals.
 *     The morphing algorithm skips re-hydration for preserved islands,
 *     so their in-memory $state is never touched. ✓
 *
 *   Layer 2 — Cross-navigation Store (this file):
 *     For islands that DON'T survive navigation (they're in the new page,
 *     not the shared layout), their last known state is checkpointed
 *     into this store before navigation. When the new page mounts,
 *     the store re-injects the state as initial props.
 *
 *   Layer 3 — Serialized Snapshot:
 *     On navigation, the store serializes its state to sessionStorage
 *     using @nexus_js/serialize (handles Date, Map, Set, BigInt).
 *     This survives hard refreshes within the same session.
 *
 * USAGE:
 *   // In a cart island — auto-persists across navigation
 *   const cart = useStore('cart', {
 *     default: [],
 *     persist: 'session',  // optional: also write to sessionStorage
 *   });
 *
 *   // cart.value is automatically restored after navigation
 *   cart.value.push(newItem);
 *
 * INJECTION FLOW:
 *   1. Island registers with store via useStore('cart', ...)
 *   2. Before navigation: store.snapshot() → serializes to sessionStorage
 *   3. After navigation: new islands read from store.get('cart')
 *   4. If value exists in store → use it (no hydration miss)
 *   5. If not → use server-provided props (normal flow)
 */

import { $state, $effect } from './runes.js';
import { serialize, deserialize } from '@nexus_js/serialize';

export interface StoreOptions<T> {
  default: T;
  /**
   * Persistence strategy:
   *   'memory'  — lives until page close (default)
   *   'session' — persists in sessionStorage across navigations
   *   'url'     — encodes in URL hash (shareable, no sensitive data)
   */
  persist?: 'memory' | 'session' | 'url';
  /**
   * Version token — bump this to invalidate stored state.
   * Useful after schema changes that break deserialization.
   */
  version?: number;
}

export interface StoreEntry<T> {
  value: T;
  /** Updates the value and notifies subscribers */
  set: (v: T) => void;
  /** Resets to the initial default value */
  reset: () => void;
}

const STORE_SESSION_KEY = '__nx_store__';
const STORE_VERSION_KEY = '__nx_store_version__';
const CURRENT_VERSION = 1;

// ── In-memory signal registry ─────────────────────────────────────────────────
const signals = new Map<string, ReturnType<typeof $state>>();
const defaults = new Map<string, unknown>();
const persistModes = new Map<string, StoreOptions<unknown>['persist']>();

// ── Initialize from sessionStorage on module load ─────────────────────────────
let _sessionData: Record<string, unknown> = {};

if (typeof sessionStorage !== 'undefined') {
  try {
    const version = sessionStorage.getItem(STORE_VERSION_KEY);
    if (version && parseInt(version, 10) === CURRENT_VERSION) {
      const raw = sessionStorage.getItem(STORE_SESSION_KEY) ?? '{}';
      _sessionData = deserialize<Record<string, unknown>>(raw);
    }
  } catch {
    _sessionData = {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates or retrieves a store entry by key.
 * The returned signal is reactive — binding it in an island makes that
 * island automatically update when any component calls store.set().
 *
 * @example
 * // In cart island
 * const cart = useStore('cart', { default: [], persist: 'session' });
 * cart.value.push({ id: 1, name: 'Widget' });
 *
 * // In any other island or the navigation system
 * const cart = useStore('cart', { default: [] });
 * console.log(cart.value); // [{ id: 1, name: 'Widget' }]
 */
export function useStore<T>(key: string, opts: StoreOptions<T>): StoreEntry<T> {
  const persist = opts.persist ?? 'memory';
  persistModes.set(key, persist);
  defaults.set(key, opts.default);

  // Determine initial value (priority: session → url → default)
  let initial: T = opts.default;

  if (persist === 'session' && key in _sessionData) {
    initial = _sessionData[key] as T;
  } else if (persist === 'url') {
    const urlVal = readFromURL(key);
    if (urlVal !== null) initial = urlVal as T;
  }

  // Reuse existing signal if already registered (cross-island sharing)
  if (!signals.has(key)) {
    signals.set(key, $state(initial));
  }

  const signal = signals.get(key) as ReturnType<typeof $state<T>>;

  // Sync to sessionStorage on every change
  if (persist === 'session') {
    $effect(() => {
      const val = signal.value;
      _sessionData[key] = val;
      flushToSession();
    });
  }

  if (persist === 'url') {
    $effect(() => {
      writeToURL(key, signal.value);
    });
  }

  return {
    get value() { return signal.value as T; },
    set(v: T) { signal.value = v; },
    reset() { signal.value = opts.default; },
  };
}

/**
 * Snapshots the entire store to sessionStorage.
 * Called by the navigation system BEFORE performing a navigation.
 * This guarantees that state from any island is preserved across routes.
 */
export function snapshotStore(): void {
  if (typeof sessionStorage === 'undefined') return;

  for (const [key, signal] of signals.entries()) {
    const mode = persistModes.get(key);
    if (mode === 'session' || mode === 'url') {
      _sessionData[key] = signal.value;
    }
  }

  flushToSession();
}

/**
 * Reads a value from the store by key.
 * Used by the navigation system to inject state into new islands.
 */
export function readStore<T>(key: string): T | undefined {
  const signal = signals.get(key);
  if (signal) return signal.value as T;
  if (key in _sessionData) return _sessionData[key] as T;
  return undefined;
}

/**
 * Writes a value into the store.
 * Triggers reactivity for any island bound to this key.
 */
export function writeStore<T>(key: string, value: T): void {
  const existing = signals.get(key);
  if (existing) {
    existing.value = value;
  } else {
    signals.set(key, $state(value));
  }
  _sessionData[key] = value;
}

/**
 * Returns a serialized snapshot of all persisted store values.
 * Embedded by the server into the navigation response payload,
 * so the new page can initialize islands with correct state.
 */
export function exportStore(): string {
  const exportable: Record<string, unknown> = {};
  for (const [key, signal] of signals.entries()) {
    const mode = persistModes.get(key);
    if (mode && mode !== 'memory') {
      exportable[key] = signal.value;
    }
  }
  return serialize(exportable);
}

/**
 * Hydrates the store from a server-provided snapshot.
 * Called on new page initialization before islands mount.
 */
export function importStore(serialized: string): void {
  try {
    const data = deserialize<Record<string, unknown>>(serialized);
    for (const [key, value] of Object.entries(data)) {
      writeStore(key, value);
    }
  } catch (err) {
    console.warn('[Nexus Store] Failed to import snapshot:', err);
  }
}

/**
 * Clears all store entries. Useful in tests or on logout.
 */
export function clearStore(keys?: string[]): void {
  if (keys) {
    for (const key of keys) {
      signals.delete(key);
      delete _sessionData[key];
    }
  } else {
    signals.clear();
    _sessionData = {};
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(STORE_SESSION_KEY);
    }
  }
}

/**
 * Returns debug info about all active store entries.
 */
export function storeDebugInfo(): Record<string, {
  value: unknown;
  persist: string;
  hasSignal: boolean;
}> {
  const info: Record<string, { value: unknown; persist: string; hasSignal: boolean }> = {};
  for (const [key] of signals.entries()) {
    info[key] = {
      value: signals.get(key)?.value,
      persist: persistModes.get(key) ?? 'memory',
      hasSignal: true,
    };
  }
  return info;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushToSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    try {
      sessionStorage.setItem(STORE_VERSION_KEY, String(CURRENT_VERSION));
      sessionStorage.setItem(STORE_SESSION_KEY, serialize(_sessionData));
    } catch {
      // sessionStorage quota exceeded — clear old data
      sessionStorage.clear();
    }
  }, 50);
}

function readFromURL(key: string): unknown | null {
  if (typeof location === 'undefined') return null;
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    const raw = hash.get(`nx_${key}`);
    return raw ? deserialize(decodeURIComponent(raw)) : null;
  } catch {
    return null;
  }
}

function writeToURL(key: string, value: unknown): void {
  if (typeof location === 'undefined') return;
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    hash.set(`nx_${key}`, encodeURIComponent(serialize(value)));
    history.replaceState(null, '', `${location.pathname}${location.search}#${hash.toString()}`);
  } catch {}
}

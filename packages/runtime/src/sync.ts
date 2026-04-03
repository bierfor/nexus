/**
 * Nexus $sync Rune — "The Teleportation Rune"
 *
 * Automatically synchronizes client state with:
 *   - Browser cookies
 *   - SessionStorage / LocalStorage
 *   - Server-side DB (via Server Action endpoint)
 *
 * Usage:
 *   // Sync with a cookie (persists across sessions)
 *   const theme = $sync('theme', { default: 'dark', persist: 'cookie' });
 *   theme.value = 'light'; // auto-saves to cookie + syncs to server
 *
 *   // Sync with DB (calls /_nexus/sync/:key automatically)
 *   const cart = $sync('cart', { default: [], persist: 'db' });
 *   cart.value = [...cart.value, newItem]; // writes to DB in background
 *
 *   // Optimistic DB sync
 *   const likes = $sync('post:42:likes', { default: 0, persist: 'db', optimistic: true });
 *   likes.value++; // UI updates immediately, DB writes in background
 */

import { $state, $effect } from './runes.js';

export type SyncPersistence = 'cookie' | 'session' | 'local' | 'db';

export interface SyncOptions<T> {
  default?: T;
  persist?: SyncPersistence;
  optimistic?: boolean;
  /** Debounce writes in ms (default: 300) */
  debounce?: number;
  /** Cookie options (when persist: 'cookie') */
  cookie?: {
    maxAge?: number;
    path?: string;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  };
}

export interface SyncedSignal<T> {
  value: T;
  pending: boolean;
  error: string | null;
  /** Force sync with server/storage */
  refresh: () => Promise<void>;
}

const SYNC_ENDPOINT = '/_nexus/sync/';

/**
 * Creates a synced reactive signal.
 * Reads initial value from storage/server, writes back on every change.
 */
export function $sync<T>(key: string, opts: SyncOptions<T> = {}): SyncedSignal<T> {
  const persist = opts.persist ?? 'local';
  const debounceMs = opts.debounce ?? 300;

  // Read initial value from storage
  const initial = readFromStorage<T>(key, persist) ?? (opts.default as T);
  const signal = $state<T>(initial);
  const pending = $state(false);
  const error = $state<string | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Watch for changes and persist
  $effect(() => {
    const val = signal.value;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      pending.value = true;
      error.value = null;

      try {
        await writeToStorage(key, val, persist, opts.cookie);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        console.error(`[Nexus $sync] Failed to persist "${key}":`, err);
      } finally {
        pending.value = false;
      }
    }, debounceMs);
  });

  const refresh = async (): Promise<void> => {
    pending.value = true;
    try {
      const fresh = await readFromServer<T>(key);
      if (fresh !== null) signal.value = fresh;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      pending.value = false;
    }
  };

  // Initial server sync for 'db' persistence
  if (persist === 'db') {
    refresh().catch(() => {});
  }

  return {
    get value() { return signal.value; },
    set value(v: T) { signal.value = v; },
    get pending() { return pending.value; },
    get error() { return error.value; },
    refresh,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage adapters
// ─────────────────────────────────────────────────────────────────────────────

function readFromStorage<T>(key: string, persist: SyncPersistence): T | null {
  if (typeof window === 'undefined') return null;

  try {
    switch (persist) {
      case 'cookie': {
        const match = document.cookie.match(new RegExp(`(?:^|; )nx_${escKey(key)}=([^;]*)`));
        return match ? (JSON.parse(decodeURIComponent(match[1] ?? '')) as T) : null;
      }
      case 'session': {
        const raw = sessionStorage.getItem(`nx:${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
      }
      case 'local': {
        const raw = localStorage.getItem(`nx:${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
      }
      case 'db':
        return null; // DB reads happen async via refresh()
    }
  } catch {
    return null;
  }
}

async function writeToStorage<T>(
  key: string,
  value: T,
  persist: SyncPersistence,
  cookieOpts: SyncOptions<T>['cookie'] = {},
): Promise<void> {
  const serialized = JSON.stringify(value);

  switch (persist) {
    case 'cookie': {
      const maxAge = cookieOpts?.maxAge ?? 60 * 60 * 24 * 30; // 30 days
      const path = cookieOpts?.path ?? '/';
      const secure = cookieOpts?.secure ? '; Secure' : '';
      const sameSite = cookieOpts?.sameSite ?? 'Lax';
      document.cookie =
        `nx_${escKey(key)}=${encodeURIComponent(serialized)}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}${secure}`;
      break;
    }
    case 'session':
      sessionStorage.setItem(`nx:${key}`, serialized);
      break;
    case 'local':
      localStorage.setItem(`nx:${key}`, serialized);
      break;
    case 'db':
      await writeToServer(key, value);
      break;
  }
}

async function readFromServer<T>(key: string): Promise<T | null> {
  const res = await fetch(`${SYNC_ENDPOINT}${encodeURIComponent(key)}`, {
    headers: { 'x-nexus-sync': '1' },
  });
  if (!res.ok) return null;
  const data = await res.json() as { value: T };
  return data.value ?? null;
}

async function writeToServer<T>(key: string, value: T): Promise<void> {
  await fetch(`${SYNC_ENDPOINT}${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nexus-sync': '1',
    },
    body: JSON.stringify({ value }),
  });
}

function escKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Nexus Connect — Client-side $socket() rune.
 *
 * Connects to /_nexus/connect/:topic via SSE and returns a reactive
 * state object whose .value updates in real time whenever the server publishes.
 *
 * Usage in a .nx island:
 *   <script>
 *   import { $socket } from '@nexus/connect/client';
 *
 *   const captures = $socket('global-captures', { default: { count: 0 } });
 *   // captures.value.count is always up-to-date
 *   </script>
 *   <p>Global captures: {captures.value.count}</p>
 */

export interface SocketState<T> {
  /** Current value — reactive in island components */
  readonly value: T;
  /** Register a callback that fires on every update */
  subscribe: (fn: (value: T, prev: T) => void) => () => void;
  /** Manually close the SSE connection */
  close: () => void;
  /** true while the SSE connection is establishing */
  readonly connecting: boolean;
  /** true if the connection is live */
  readonly connected: boolean;
}

export interface SocketOptions<T> {
  default: T;
  /** Optional transform applied to the raw JSON payload */
  transform?: (raw: unknown) => T;
  /** Called on SSE connection error */
  onError?: (err: Event) => void;
  /** Reconnect automatically on error (default: true) */
  reconnect?: boolean;
}

/** Dev-mode type for the injected window property */
interface NexusDevWindow extends Window {
  __NEXUS_DEV__?: boolean;
}

declare const window: NexusDevWindow;

export function $socket<T>(topic: string, opts: SocketOptions<T>): SocketState<T> {
  let current: T = opts.default;
  let _connecting = true;
  let _connected  = false;
  const listeners = new Set<(value: T, prev: T) => void>();
  let es: EventSource | null = null;

  function notify(next: T): void {
    const prev = current;
    current = next;
    if (typeof window !== 'undefined' && window.__NEXUS_DEV__) {
      console.log(
        `%c[Nexus] 🛰️  Connect%c "${topic}" →`,
        'color:#7c3aed;font-weight:700', 'color:#64748b',
        next,
      );
    }
    listeners.forEach((fn) => fn(next, prev));
  }

  function connect(): void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    es = new EventSource(`/_nexus/connect/${encodeURIComponent(topic)}`);

    es.addEventListener('connected', () => {
      _connecting = false;
      _connected  = true;
      if (typeof window !== 'undefined' && window.__NEXUS_DEV__) {
        console.log(`%c[Nexus] 🛰️  Connect%c "${topic}" established`, 'color:#7c3aed;font-weight:700', 'color:#10b981');
      }
    });

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data) as unknown;
        const value = opts.transform ? opts.transform(raw) : (raw as T);
        notify(value);
      } catch {
        // malformed JSON — ignore
      }
    });

    es.onerror = (err: Event) => {
      _connected  = false;
      _connecting = true;
      opts.onError?.(err);
      // EventSource auto-reconnects by default
    };
  }

  connect();

  return {
    get value()      { return current; },
    get connecting() { return _connecting; },
    get connected()  { return _connected; },

    subscribe(fn: (value: T, prev: T) => void) {
      listeners.add(fn);
      fn(current, current); // immediate call with current value
      return () => listeners.delete(fn);
    },

    close() {
      es?.close();
      _connected  = false;
      _connecting = false;
      listeners.clear();
    },
  };
}

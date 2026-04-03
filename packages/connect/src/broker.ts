/**
 * Nexus Connect — In-memory message broker.
 *
 * Maintains a pub/sub registry keyed by topic string.
 * Keeps the last published message per topic for late subscribers
 * (same semantics as RxJS BehaviorSubject).
 *
 * Designed to be a singleton per server process. In multi-process/Edge
 * environments, replace the singleton with a Redis/Upstash adapter.
 */

export interface ConnectMessage<T = unknown> {
  topic: string;
  data:  T;
  id:    string;
  ts:    number;
}

type Subscriber<T> = (msg: ConnectMessage<T>) => void;

class MessageBroker {
  private subs  = new Map<string, Set<Subscriber<unknown>>>();
  private cache = new Map<string, ConnectMessage<unknown>>();

  subscribe<T>(topic: string, fn: Subscriber<T>): () => void {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic)!.add(fn as Subscriber<unknown>);

    // Replay last message for late subscribers (catch-up semantics)
    const last = this.cache.get(topic);
    if (last) queueMicrotask(() => fn(last as ConnectMessage<T>));

    return () => {
      this.subs.get(topic)?.delete(fn as Subscriber<unknown>);
    };
  }

  publish<T>(topic: string, data: T): void {
    const msg: ConnectMessage<T> = {
      topic,
      data,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
    };
    this.cache.set(topic, msg as ConnectMessage<unknown>);
    this.subs.get(topic)?.forEach((fn) => fn(msg as ConnectMessage<unknown>));
  }

  /** Number of active SSE listeners for a topic (useful for presence) */
  subscriberCount(topic: string): number {
    return this.subs.get(topic)?.size ?? 0;
  }

  /** All currently active topics */
  topics(): string[] {
    return [...this.subs.keys()].filter((t) => (this.subs.get(t)?.size ?? 0) > 0);
  }
}

/** Singleton broker shared across all channels in this server process. */
export const broker = new MessageBroker();

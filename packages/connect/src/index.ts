/**
 * @nexus/connect — Edge-State Sync
 *
 * Server exports:
 *   getChannel(topic)     — pub/sub channel for server→client push
 *   handleSSERequest()    — Web-standard SSE Response handler
 *   handleSSERequestNode()— Node.js http.ServerResponse adapter
 *   isConnectRequest()    — Route guard for /_nexus/connect/* URLs
 *   CONNECT_PATH          — '/_nexus/connect/'
 *
 * Client exports (import from '@nexus/connect/client'):
 *   $socket(topic, opts)  — reactive SSE subscription rune
 */

export { broker } from './broker.js';
export { handleSSERequest, handleSSERequestNode, isConnectRequest, topicFromUrl, CONNECT_PATH } from './sse.js';

import { broker } from './broker.js';

export interface NexusChannel<T = unknown> {
  topic:           string;
  /** Push data to all connected clients subscribed to this topic */
  publish:         (data: T) => void;
  /** Subscribe to messages on this topic (server-side listener) */
  subscribe:       (fn: (data: T) => void) => () => void;
  /** Number of currently connected SSE clients */
  subscriberCount: () => number;
}

/**
 * Returns a typed channel for a given topic.
 * Call publish() from your server frontmatter to push state to clients.
 *
 * @example
 * // In .nx frontmatter:
 * import { getChannel } from '@nexus/connect';
 * const stats = getChannel<{ captures: number }>('global-stats');
 * stats.publish({ captures: await db.count('captures') });
 */
export function getChannel<T = unknown>(topic: string): NexusChannel<T> {
  return {
    topic,
    publish:         (data: T) => broker.publish<T>(topic, data),
    subscribe:       (fn: (data: T) => void) => broker.subscribe<T>(topic, (msg) => fn(msg.data)),
    subscriberCount: () => broker.subscriberCount(topic),
  };
}

/** All currently active (non-empty) topics — useful for admin dashboards */
export function activeTopics(): string[] {
  return broker.topics();
}

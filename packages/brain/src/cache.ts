import { createHash } from 'node:crypto';
import type { BrainProvider } from './types.js';

export interface CacheEntry {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

const MAX_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();
let order: string[] = [];

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function cacheKey(parts: {
  prompt: string;
  context: unknown;
  model: string;
  provider: BrainProvider;
}): string {
  const body = stableStringify({
    p: parts.prompt,
    c: parts.context ?? null,
    m: parts.model,
    r: parts.provider,
  });
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function cacheGet(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function cacheSet(key: string, entry: CacheEntry): void {
  if (cache.has(key)) {
    order = order.filter((k) => k !== key);
  }
  cache.set(key, entry);
  order.push(key);
  while (order.length > MAX_ENTRIES) {
    const drop = order.shift();
    if (drop) cache.delete(drop);
  }
}

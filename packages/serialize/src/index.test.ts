import { describe, it, expect } from 'vitest';
import { serialize, deserialize, encode, decode } from './index.js';

describe('Nexus Serialize — round-trip fidelity', () => {
  it('preserves Date', () => {
    const d = new Date('2026-04-03T12:00:00.000Z');
    const result = deserialize<Date>(serialize(d));
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(d.toISOString());
  });

  it('preserves Map', () => {
    const m = new Map<string, unknown>([['a', 1], ['b', new Date()]]);
    const result = deserialize<Map<string, unknown>>(serialize(m));
    expect(result).toBeInstanceOf(Map);
    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBeInstanceOf(Date);
  });

  it('preserves Set', () => {
    const s = new Set([1, 'hello', new Date()]);
    const result = deserialize<Set<unknown>>(serialize(s));
    expect(result).toBeInstanceOf(Set);
    expect(result.has(1)).toBe(true);
    expect(result.has('hello')).toBe(true);
    expect([...result].some(v => v instanceof Date)).toBe(true);
  });

  it('preserves BigInt', () => {
    const big = 9007199254740993n;
    expect(deserialize<bigint>(serialize(big))).toBe(big);
  });

  it('preserves RegExp with flags', () => {
    const re = /nexus[\w-]+/gi;
    const result = deserialize<RegExp>(serialize(re));
    expect(result).toBeInstanceOf(RegExp);
    expect(result.source).toBe(re.source);
    expect(result.flags).toBe(re.flags);
  });

  it('preserves URL', () => {
    const url = new URL('https://nexusjs.dev/blog?q=test#anchor');
    const result = deserialize<URL>(serialize(url));
    expect(result).toBeInstanceOf(URL);
    expect(result.href).toBe(url.href);
  });

  it('preserves NaN', () => {
    expect(Number.isNaN(deserialize(serialize(NaN)))).toBe(true);
  });

  it('preserves Infinity', () => {
    expect(deserialize(serialize(Infinity))).toBe(Infinity);
    expect(deserialize(serialize(-Infinity))).toBe(-Infinity);
  });

  it('preserves undefined in objects', () => {
    const obj = { a: 1, b: undefined, c: 'hello' };
    const result = deserialize<typeof obj>(serialize(obj));
    expect(result.a).toBe(1);
    expect(result.b).toBeUndefined();
    expect(result.c).toBe('hello');
  });

  it('preserves nested complex types', () => {
    const nested = {
      user: { createdAt: new Date(), id: 42n },
      tags: new Set(['svelte', 'nexus']),
      meta: new Map([['views', 1000]]),
    };
    const result = deserialize<typeof nested>(serialize(nested));
    expect(result.user.createdAt).toBeInstanceOf(Date);
    expect(result.user.id).toBe(42n);
    expect(result.tags).toBeInstanceOf(Set);
    expect(result.meta).toBeInstanceOf(Map);
  });

  it('handles null and primitive passthroughs', () => {
    expect(deserialize(serialize(null))).toBeNull();
    expect(deserialize(serialize(42))).toBe(42);
    expect(deserialize(serialize('hello'))).toBe('hello');
    expect(deserialize(serialize(true))).toBe(true);
  });

  it('preserves Error objects', () => {
    const err = new Error('Something went wrong');
    err.name = 'ValidationError';
    const result = deserialize<Error>(serialize(err));
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Something went wrong');
    expect(result.name).toBe('ValidationError');
  });
});

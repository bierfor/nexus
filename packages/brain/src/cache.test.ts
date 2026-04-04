import { describe, it, expect } from 'vitest';
import { cacheKey, cacheGet, cacheSet } from './cache.js';

describe('brain cache (no network)', () => {
  it('cacheKey is stable regardless of object key order in context', () => {
    const a = cacheKey({
      prompt:   'p',
      context:  { z: 1, a: 2 },
      model:    'm',
      provider: 'openai',
    });
    const b = cacheKey({
      prompt:   'p',
      context:  { a: 2, z: 1 },
      model:    'm',
      provider: 'openai',
    });
    expect(a).toBe(b);
  });

  it('cacheKey differs when prompt changes', () => {
    const x = cacheKey({
      prompt:   'a',
      context:  null,
      model:    'm',
      provider: 'openai',
    });
    const y = cacheKey({
      prompt:   'b',
      context:  null,
      model:    'm',
      provider: 'openai',
    });
    expect(x).not.toBe(y);
  });

  it('cacheSet and cacheGet round-trip', () => {
    const k = cacheKey({
      prompt:   'vitest-cache-roundtrip-unique',
      context:  {},
      model:    'x',
      provider: 'groq',
    });
    cacheSet(k, { text: 'hello', usage: { totalTokens: 3 } });
    expect(cacheGet(k)?.text).toBe('hello');
    expect(cacheGet(k)?.usage?.totalTokens).toBe(3);
  });
});

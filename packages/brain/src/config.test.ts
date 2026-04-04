import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveBrainConfig } from './config.js';

const KEYS = [
  'NEXUS_BRAIN_API_KEY',
  'NEXUS_BRAIN_PROVIDER',
  'NEXUS_BRAIN_BASE_URL',
  'NEXUS_BRAIN_MODEL',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
] as const;

describe('resolveBrainConfig (no API calls)', () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('throws a clear error when no API key is configured', () => {
    expect(() => resolveBrainConfig()).toThrow(/Nexus Brain.*API key/i);
  });

  it('resolves OpenAI when OPENAI_API_KEY is set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-placeholder';
    const c = resolveBrainConfig();
    expect(c.provider).toBe('openai');
    expect(c.apiKey).toBe('sk-test-placeholder');
    expect(c.baseUrl).toContain('openai.com');
  });

  it('resolves Groq when GROQ_API_KEY is set and OpenAI key is absent', () => {
    process.env['GROQ_API_KEY'] = 'gsk-test-placeholder';
    const c = resolveBrainConfig();
    expect(c.provider).toBe('groq');
    expect(c.apiKey).toBe('gsk-test-placeholder');
    expect(c.baseUrl).toContain('groq.com');
  });
});

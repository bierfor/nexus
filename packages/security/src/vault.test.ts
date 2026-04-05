import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { NexusVault } from './vault.js';

describe('NexusVault', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env['TEST_VAULT_A'] = 'one';
    process.env['TEST_VAULT_B'] = 'two';
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(prev)) {
      process.env[k] = v;
    }
  });

  it('seeds from env and patches override', () => {
    const v = new NexusVault();
    v.seedFromProcessEnv();
    expect(v.get('TEST_VAULT_A')).toBe('one');
    v.patch({ TEST_VAULT_A: 'hot' });
    expect(v.get('TEST_VAULT_A')).toBe('hot');
  });

  it('patch with empty string removes key', () => {
    const v = new NexusVault();
    v.seedFromProcessEnv();
    v.patch({ TEST_VAULT_B: '' });
    expect(v.has('TEST_VAULT_B')).toBe(false);
  });

  it('replaceAll re-seeds from env then applies entries', () => {
    const v = new NexusVault();
    v.patch({ EPHEMERAL: 'gone' });
    expect(v.get('EPHEMERAL')).toBe('gone');
    v.replaceAll({ EPHEMERAL: '' });
    expect(v.has('EPHEMERAL')).toBe(false);
    expect(v.get('TEST_VAULT_A')).toBe('one');
  });
});

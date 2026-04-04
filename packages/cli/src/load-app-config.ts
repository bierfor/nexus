/**
 * Load `nexus.config.{ts,mjs,js,cjs}` from the app root (used by dev, build, start).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import type { NexusConfig } from './config.js';

const CANDIDATES = [
  'nexus.config.ts',
  'nexus.config.mjs',
  'nexus.config.js',
  'nexus.config.cjs',
] as const;

export function loadAppConfig(root: string): NexusConfig {
  for (const name of CANDIDATES) {
    const abs = join(root, name);
    if (!existsSync(abs)) continue;
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const mod = jiti(abs) as { default?: NexusConfig };
    return (mod.default ?? mod) as NexusConfig;
  }
  return {};
}

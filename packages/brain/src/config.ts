/**
 * Resolve provider credentials from environment (no Vault yet — use process.env).
 */

import type { BrainProvider } from './types.js';

const OPENAI_DEFAULT = 'https://api.openai.com/v1';
const GROQ_DEFAULT = 'https://api.groq.com/openai/v1';

export interface ResolvedBrainConfig {
  provider: BrainProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : undefined;
}

/**
 * Reads `NEXUS_BRAIN_*` with fallbacks to `OPENAI_API_KEY` / `GROQ_API_KEY`.
 */
export function resolveBrainConfig(override?: { provider?: BrainProvider; model?: string }): ResolvedBrainConfig {
  const explicitProvider = env('NEXUS_BRAIN_PROVIDER') as BrainProvider | undefined;
  const provider: BrainProvider =
    override?.provider ??
    (explicitProvider === 'groq' || explicitProvider === 'openai' ? explicitProvider : inferProvider());

  const apiKey =
    env('NEXUS_BRAIN_API_KEY') ??
    (provider === 'groq' ? env('GROQ_API_KEY') : undefined) ??
    env('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error(
      '[Nexus Brain] Missing API key. Set NEXUS_BRAIN_API_KEY, or OPENAI_API_KEY / GROQ_API_KEY to match NEXUS_BRAIN_PROVIDER.',
    );
  }

  const baseUrl =
    env('NEXUS_BRAIN_BASE_URL') ??
    (provider === 'groq' ? GROQ_DEFAULT : OPENAI_DEFAULT);

  const model =
    override?.model ??
    env('NEXUS_BRAIN_MODEL') ??
    (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini');

  return { provider, baseUrl, apiKey, model };
}

function inferProvider(): BrainProvider {
  const p = env('NEXUS_BRAIN_PROVIDER');
  if (p === 'groq') return 'groq';
  if (p === 'openai') return 'openai';
  if (env('GROQ_API_KEY') && !env('OPENAI_API_KEY')) return 'groq';
  return 'openai';
}

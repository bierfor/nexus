/**
 * @nexus_js/brain — Server-only LLM helper with DevRadar telemetry and in-memory hash cache.
 *
 * @example
 * ```ts
 * import { $brain } from '@nexus_js/brain';
 *
 * export const suggestNext = async (flow: unknown) => {
 *   return $brain.complete({
 *     prompt: 'What node should follow in this automation flow? Reply with one short label.',
 *     context: flow,
 *     cache: true,
 *   });
 * };
 * ```
 */

import { chatCompleteOpenAICompatible } from './providers.js';
import { resolveBrainConfig } from './config.js';
import { cacheGet, cacheKey, cacheSet, type CacheEntry } from './cache.js';
import { emitBrainTelemetry } from './telemetry.js';
import type { BrainCompleteOptions } from './types.js';

export type { BrainCompleteOptions, BrainProvider } from './types.js';
export { resolveBrainConfig } from './config.js';

function buildUserContent(prompt: string, context: unknown): string {
  if (context === undefined) return prompt;
  let ctx: string;
  try {
    ctx = JSON.stringify(context, null, 0);
  } catch {
    ctx = String(context);
  }
  if (ctx.length > 48_000) {
    ctx = `${ctx.slice(0, 48_000)}…[truncated]`;
  }
  return `${prompt}\n\n---\nContext (JSON):\n${ctx}`;
}

/**
 * Run a chat completion. Emits `brain:completion` to DevRadar on every call (Studio DevRadar strip).
 */
export async function brainComplete(options: BrainCompleteOptions): Promise<string> {
  const cfg = resolveBrainConfig({
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
  });

  const userContent = buildUserContent(options.prompt, options.context);
  const useCache = options.cache !== false;
  const key = useCache
    ? cacheKey({
        prompt:   options.prompt,
        context:  options.context ?? null,
        model:    cfg.model,
        provider: cfg.provider,
      })
    : null;

  const promptChars = options.prompt.length;
  const contextChars =
    options.context === undefined
      ? 0
      : (() => {
          try {
            return JSON.stringify(options.context).length;
          } catch {
            return String(options.context).length;
          }
        })();

  const promptPreview = options.prompt.slice(0, 96);

  if (key) {
    const hit = cacheGet(key);
    if (hit) {
      const hitPayload: Parameters<typeof emitBrainTelemetry>[0] = {
        provider:     cfg.provider,
        model:        cfg.model,
        durationMs:   0,
        cached:       true,
        ok:           true,
        promptPreview,
        promptChars,
        contextChars,
      };
      if (hit.usage !== undefined) hitPayload.usage = hit.usage;
      emitBrainTelemetry(hitPayload);
      return hit.text;
    }
  }

  const t0 = Date.now();
  try {
    const req: Parameters<typeof chatCompleteOpenAICompatible>[0] = {
      baseUrl:     cfg.baseUrl,
      apiKey:      cfg.apiKey,
      model:       cfg.model,
      userContent,
    };
    if (options.signal !== undefined) req.signal = options.signal;
    if (options.maxTokens !== undefined) req.maxTokens = options.maxTokens;
    const result = await chatCompleteOpenAICompatible(req);

    const durationMs = Date.now() - t0;

    if (key) {
      const entry: CacheEntry = { text: result.text };
      if (result.usage !== undefined) entry.usage = result.usage;
      cacheSet(key, entry);
    }

    const okPayload: Parameters<typeof emitBrainTelemetry>[0] = {
      provider:     cfg.provider,
      model:        cfg.model,
      durationMs,
      cached:       false,
      ok:           true,
      promptPreview,
      promptChars,
      contextChars,
    };
    if (result.usage !== undefined) okPayload.usage = result.usage;
    emitBrainTelemetry(okPayload);

    return result.text;
  } catch (e) {
    const durationMs = Date.now() - t0;
    const message = e instanceof Error ? e.message : String(e);
    emitBrainTelemetry({
      provider:     cfg.provider,
      model:        cfg.model,
      durationMs,
      cached:       false,
      ok:           false,
      promptPreview,
      promptChars,
      contextChars,
      error:        message,
    });
    throw e;
  }
}

/** Same as `brainComplete` — dollar prefix matches docs / rune style. */
export const $brain = {
  complete: (opts: BrainCompleteOptions) => brainComplete(opts),
};

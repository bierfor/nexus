import type { IslandWrapResult } from './island-wrap.js';
import type { CompileWarning } from './types.js';

/**
 * Self-client islands serialize the inner fragment as a JSON string; `{#if}` / `{#each}` / `bind:`
 * are not evaluated in the browser the way SSR template literals are. Warn at compile time.
 */
export function scanSelfClientIslandTemplateWarnings(
  islandWrap: IslandWrapResult,
  filepath: string,
): CompileWarning[] {
  if (!islandWrap.didWrap) return [];

  const frags =
    islandWrap.clientFragments.length > 0
      ? islandWrap.clientFragments
      : islandWrap.clientTemplate
        ? [islandWrap.clientTemplate]
        : [];
  const text = frags.join('\n');
  if (!text.trim()) return [];

  const rel = filepath.replace(/\\/g, '/');
  const w: CompileWarning[] = [];

  if (/\{#if\s/i.test(text)) {
    w.push({
      message: `${rel}: {#if} inside client:* — the hydrated island does not evaluate control flow; use static HTML or update the DOM from script.`,
    });
  }
  if (/\{#each\s/i.test(text)) {
    w.push({
      message: `${rel}: {#each} inside client:* — lists are not rendered in the island bundle; build options in script or use SSR outside the island.`,
    });
  }
  if (/\bbind:[a-z][a-z-]*\s*=\s*\{/i.test(text)) {
    w.push({
      message: `${rel}: bind: inside client:* — two-way binding is not wired in islands; use event delegation on a stable root and $state .value in script.`,
    });
  }

  return w;
}

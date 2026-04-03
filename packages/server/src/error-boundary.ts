/**
 * Nexus Error Boundaries — file-based resilience system.
 *
 * Convention (mirrors Next.js App Router):
 *
 *   routes/
 *   ├── error.nx              ← catches errors in the root layout
 *   ├── dashboard/
 *   │   ├── error.nx          ← catches errors in /dashboard/**
 *   │   ├── +layout.nx
 *   │   └── +page.nx
 *   └── blog/
 *       ├── [slug]/
 *       │   ├── error.nx      ← catches errors ONLY in /blog/:slug
 *       │   └── +page.nx
 *       └── not-found.nx      ← custom 404 for /blog/**
 *
 * The error.nx component receives:
 *   - error: { message, name, digest? }
 *   - reset: () => void  (client-side — triggers re-render)
 *
 * Island hydration for error.nx:
 *   The "reset" button must be an island (client:load) to be interactive.
 *   The error info is server-rendered (no JS needed to display it).
 *
 * Usage in error.nx:
 *   ---
 *   const { error } = ctx.errorBoundary;
 *   ---
 *   <script>
 *     const { reset } = $props();
 *   </script>
 *   <div class="error-boundary" client:load>
 *     <h2>Something went wrong</h2>
 *     <p>{error.message}</p>
 *     <button onclick={reset}>Try again</button>
 *   </div>
 */

import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { NexusContext } from './context.js';

export interface BoundaryError {
  message: string;
  name: string;
  /** Opaque server-side error digest (safe to show in prod) */
  digest?: string;
  /** Full stack trace (dev only) */
  stack?: string;
}

export interface ErrorBoundaryContext {
  error: BoundaryError;
  pathname: string;
}

/**
 * Finds the nearest `error.nx` file to a given route filepath.
 * Walks up the directory tree until it finds one or reaches the routes root.
 */
export async function findErrorBoundary(
  routeFilepath: string,
  routesRoot: string,
): Promise<string | null> {
  let dir = dirname(routeFilepath);

  while (dir.startsWith(routesRoot)) {
    const candidate = join(dir, 'error.nx');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // No error.nx here — go up one level
      const parent = dirname(dir);
      if (parent === dir) break; // Reached filesystem root
      dir = parent;
    }
  }

  return null; // No error boundary found
}

/**
 * Finds the nearest `not-found.nx` for a given route directory.
 */
export async function findNotFoundBoundary(
  routeFilepath: string,
  routesRoot: string,
): Promise<string | null> {
  let dir = dirname(routeFilepath);

  while (dir.startsWith(routesRoot)) {
    const candidate = join(dir, 'not-found.nx');
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

/**
 * Renders an error boundary file to HTML.
 * Sanitizes error info for production (hides stack, generates digest).
 */
export async function renderErrorBoundary(
  boundaryFile: string,
  originalError: unknown,
  ctx: NexusContext,
  opts: { dev: boolean },
): Promise<string> {
  const error = normalizeError(originalError, opts.dev);

  // Try to import and render the error.nx boundary
  try {
    const mod = await import(/* @vite-ignore */ boundaryFile);
    if (typeof mod.render === 'function') {
      const result = await mod.render({ ...ctx, errorBoundary: { error } });
      return result.html ?? buildDefaultErrorHTML(error, opts.dev);
    }
  } catch (renderErr) {
    console.error('[Nexus] Error boundary itself threw:', renderErr);
  }

  return buildDefaultErrorHTML(error, opts.dev);
}

/**
 * Default error page when no error.nx is found.
 * Shows full details in dev, sanitized message in production.
 */
export function buildDefaultErrorHTML(error: BoundaryError, dev: boolean): string {
  const details = dev
    ? `<pre style="overflow:auto;background:#1a1a2e;padding:1rem;border-radius:8px;font-size:0.8rem;color:#ff6b6b">${htmlEscape(error.stack ?? '')}</pre>`
    : error.digest
      ? `<p style="font-family:monospace;color:#6b6b80;font-size:0.8rem">Error ID: ${error.digest}</p>`
      : '';

  return `<div data-nx-error-boundary style="
    max-width:640px; margin:4rem auto; padding:2rem;
    font-family:system-ui; background:#0a0a0f; color:#e8e8f0;
    border:1px solid #ff3e00; border-radius:12px;
  ">
    <h2 style="color:#ff3e00;font-size:1.5rem;margin-bottom:0.5rem">
      ${htmlEscape(error.name)}
    </h2>
    <p style="color:#a0a0b8;margin-bottom:1.5rem">${htmlEscape(error.message)}</p>
    ${details}
    <button
      onclick="location.reload()"
      style="background:#00d4aa;color:#000;border:none;padding:0.5rem 1.5rem;
             border-radius:6px;cursor:pointer;font-weight:700"
    >Try again</button>
  </div>`;
}

/**
 * Wraps a render function with error boundary protection.
 * If the render throws, catches it and renders the nearest error.nx.
 */
export async function withErrorBoundary<T>(
  fn: () => Promise<T>,
  opts: {
    routeFilepath: string;
    routesRoot: string;
    ctx: NexusContext;
    dev: boolean;
    fallback?: string;
  },
): Promise<T | { html: string; status: number }> {
  try {
    return await fn();
  } catch (err) {
    console.error('[Nexus] Route render error:', err);

    // Find nearest error boundary
    const boundaryFile = await findErrorBoundary(opts.routeFilepath, opts.routesRoot);

    const html = boundaryFile
      ? await renderErrorBoundary(boundaryFile, err, opts.ctx, { dev: opts.dev })
      : buildDefaultErrorHTML(normalizeError(err, opts.dev), opts.dev);

    return { html: wrapInPage(html), status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function normalizeError(err: unknown, dev: boolean): BoundaryError {
  if (err instanceof Error) {
    const normalized: BoundaryError = {
      message: err.message,
      name: err.name,
      digest: generateDigest(err.message),
    };
    if (dev && err.stack !== undefined) {
      normalized.stack = err.stack;
    }
    return normalized;
  }
  const msg = String(err);
  return {
    message: msg,
    name: 'Error',
    digest: generateDigest(msg),
  };
}

function generateDigest(msg: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).slice(0, 8).toUpperCase();
}

function wrapInPage(html: string): string {
  return `<!DOCTYPE html><html><body style="background:#0a0a0f">${html}</body></html>`;
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

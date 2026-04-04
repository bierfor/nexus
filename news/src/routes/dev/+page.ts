import type { NexusContext } from '@nexus_js/server/context';
import { mediaUploadUrlFromEnv } from '../../lib/admin-gql.ts';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchHealth(origin: string): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const u = new URL('/health', origin);
    const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
    const t = await r.text();
    return { ok: r.ok, status: r.status, detail: t.slice(0, 400) };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * QA / smoke page — only when not in production (404 in prod builds).
 * Use to verify: API health, env URLs, links to admin and CMS flows.
 */
export async function render(ctx: NexusContext) {
  if (isProduction()) {
    ctx.notFound();
  }

  const graphqlUrl = process.env.NEXUS_GRAPHQL_URL?.trim() || 'http://127.0.0.1:4000/graphql';
  let origin = 'http://127.0.0.1:4000';
  try {
    origin = new URL(graphqlUrl).origin;
  } catch {
    /* keep default */
  }

  const health = await fetchHealth(origin);
  const mediaUrl = mediaUploadUrlFromEnv();

  const healthClass = health.ok ? 'nx-dev-ok' : 'nx-dev-bad';
  const healthLabel = health.ok ? 'OK' : `FAIL (${health.status})`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>News — Dev / QA</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #0f172a; }
    h1 { font-size: 1.35rem; font-weight: 600; letter-spacing: -0.02em; }
    h2 { font-size: 1rem; margin-top: 1.5rem; font-weight: 600; color: #334155; }
    .nx-dev-ok { color: #15803d; font-weight: 600; }
    .nx-dev-bad { color: #b91c1c; font-weight: 600; }
    code { background: #f1f5f9; padding: 0.12rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.65rem 0.75rem; border-radius: 8px; font-size: 0.78rem; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    ul { padding-left: 1.15rem; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nx-dev-commands { background: #0f172a; color: #e2e8f0; padding: 0.85rem 1rem; border-radius: 10px; font-size: 0.8rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>News — QA / dev</h1>
  <p>Visible only when <code>NODE_ENV</code> is not <code>production</code> (production builds return 404).</p>

  <h2>Backend</h2>
  <p>GraphQL origin (from <code>NEXUS_GRAPHQL_URL</code>): <code>${esc(origin)}</code></p>
  <p>Media upload (Cloudinary proxy): <code>${esc(mediaUrl)}</code></p>
  <p>API <code>GET /health</code>: <span class="${healthClass}">${esc(healthLabel)}</span></p>
  <pre>${esc(health.detail)}</pre>

  <h2>Manual checks</h2>
  <ul>
    <li><a href="/admin">/admin</a> — CMS (JWT + GraphQL)</li>
    <li><a href="/login">/login</a> — admin login</li>
    <li><a href="/register">/register</a></li>
    <li><a href="/flash">/flash</a> — wire</li>
    <li><a href="/tags">/tags</a> · <a href="/authors">/authors</a></li>
  </ul>

  <h2>Commands (from repo root)</h2>
  <pre class="nx-dev-commands">pnpm --filter news check          # typecheck news app
pnpm --filter news exec nexus check
cd mongo/backend && npm run dev    # API + GraphQL + /media/upload</pre>
</body></html>`;

  return { html };
}

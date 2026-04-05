/**
 * Server-side GraphQL client for Fin.sh → Apollo API.
 * Forwards `User-Agent` as `x-finsh-ua` for bot / click heuristics behind SSR `fetch`.
 */

import type { NexusContext } from '@nexus_js/server';

export function finShGraphqlUrl(ctx?: Pick<NexusContext, 'secrets'>): string {
  const fromVault = ctx?.secrets.get('FIN_SH_GRAPHQL_URL');
  if (fromVault !== undefined && fromVault !== '') return fromVault;
  return process.env['FIN_SH_GRAPHQL_URL'] ?? 'http://127.0.0.1:4000/graphql';
}

/**
 * URL used by the browser (islands: login, register, ads). Must be reachable from visitors’ devices.
 * In production, set `FIN_SH_GRAPHQL_BROWSER_URL` when the API is on another host than the SSR default.
 * Server-side `fetch` keeps using `FIN_SH_GRAPHQL_URL` (e.g. internal Docker network).
 *
 * Dev: if the app is opened as `localhost:3050` but this returned `127.0.0.1:4000`, the session cookie
 * would be scoped to 127.0.0.1 and not sent on later requests to `localhost` — login “works” but SSR
 * `me` / dashboard see no session. Match API host to the page host for localhost / 127.0.0.1.
 */
export function finShGraphqlBrowserUrl(ctx?: Pick<NexusContext, 'secrets' | 'url'>): string {
  const v =
    ctx?.secrets.get('FIN_SH_GRAPHQL_BROWSER_URL') ??
    ctx?.secrets.get('FIN_SH_GRAPHQL_PUBLIC_URL');
  if (v !== undefined && v !== '') return v;
  const env =
    process.env['FIN_SH_GRAPHQL_BROWSER_URL'] ?? process.env['FIN_SH_GRAPHQL_PUBLIC_URL'];
  if (env !== undefined && env !== '') return env;
  const h = ctx?.url?.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    return `http://${h}:4000/graphql`;
  }
  return finShGraphqlUrl(ctx);
}

export async function finShGql<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  request: Request | undefined,
  secrets?: NexusContext['secrets'],
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const ua = request?.headers.get('user-agent');
  if (ua) headers['x-finsh-ua'] = ua;
  const cookie = request?.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;

  const r = await fetch(secrets !== undefined ? finShGraphqlUrl({ secrets }) : finShGraphqlUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = (await r.json()) as { data?: T; errors?: readonly { message: string }[] };
  if (!r.ok || (json.errors !== undefined && json.errors.length > 0)) {
    throw new Error(json.errors?.[0]?.message ?? `GraphQL HTTP ${r.status}`);
  }
  if (json.data === undefined) throw new Error('Empty GraphQL data');
  return json.data;
}

/** Resolve public origin for short URLs (Vault → env → request host). */
export function finShPublicOrigin(ctx: NexusContext): string {
  const fromVault = ctx.secrets.get('FIN_SH_PUBLIC_ORIGIN');
  if (fromVault !== undefined && fromVault !== '') return fromVault.replace(/\/$/, '');
  const env = process.env['FIN_SH_PUBLIC_ORIGIN']?.replace(/\/$/, '');
  if (env) return env;
  return `${ctx.url.protocol}//${ctx.url.host}`;
}

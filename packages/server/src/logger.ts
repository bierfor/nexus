/**
 * Nexus Server Logger — terminal observability for SSR, Actions, HMR.
 *
 * Symbol key:
 *   ○  Static / immutable (CDN-cached forever)
 *   ◑  PPR / SWR (partially cached, stale-while-revalidate)
 *   λ  Dynamic (no CDN cache, server-rendered per request)
 *   ~  Streaming (Suspense, can't cache)
 *   ▲  Server Action (mutation)
 *   ✖  Error (any 4xx/5xx)
 */

// ── ANSI palette ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m', bold:   '\x1b[1m', dim:    '\x1b[2m',
  red:    '\x1b[31m', green:  '\x1b[32m', yellow: '\x1b[33m',
  blue:   '\x1b[34m', mag:    '\x1b[35m', cyan:   '\x1b[36m',
  gray:   '\x1b[90m', white:  '\x1b[97m',
};

// ── Types ─────────────────────────────────────────────────────────────────────
export type CacheStrategy =
  | 'static-immutable'
  | 'swr'
  | 'dynamic-no-store'
  | 'streaming-no-store'
  | 'private-no-store';

export type RouteSymbol = 'static' | 'ppr' | 'dynamic' | 'streaming' | 'error';

export interface RouteLogEntry {
  method:        string;
  path:          string;
  status:        number;
  duration:      number;
  cacheStrategy?: CacheStrategy | string;
  /** Number of <nexus-island> markers found in the rendered HTML */
  islandCount?:  number;
  errorMessage?: string;
}

export interface ActionLogEntry {
  name:          string;
  duration:      number;
  status:        'success' | 'error' | 'cancelled' | 'rejected' | 'queued';
  islandId?:     string;
  raceStrategy?: string;
  errorMessage?: string;
}

export interface HmrLogEntry {
  filename: string;
  event:    string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function now(): string {
  return new Date().toLocaleTimeString('en', { hour12: false });
}

function routeSymbol(entry: RouteLogEntry): string {
  if (entry.status >= 500 || entry.status === 0) return `${c.red}✖${c.reset}`;
  if (entry.status >= 400) return `${c.yellow}✖${c.reset}`;
  switch (entry.cacheStrategy) {
    case 'static-immutable': return `${c.green}○${c.reset}`;
    case 'swr':              return `${c.cyan}◑${c.reset}`;
    case 'streaming-no-store': return `${c.mag}~${c.reset}`;
    case 'private-no-store': return `${c.gray}λ${c.reset}`;
    default:                 return `${c.yellow}λ${c.reset}`;
  }
}

function cacheTag(strategy?: string): string {
  if (!strategy) return '';
  const tags: Record<string, string> = {
    'static-immutable':   `${c.green}[Static ∞]${c.reset}`,
    'swr':                `${c.cyan}[SWR]${c.reset}`,
    'dynamic-no-store':   `${c.yellow}[Dynamic]${c.reset}`,
    'streaming-no-store': `${c.mag}[Stream]${c.reset}`,
    'private-no-store':   `${c.gray}[Private]${c.reset}`,
  };
  return '  ' + (tags[strategy] ?? `${c.gray}[${strategy}]${c.reset}`);
}

function durationColor(ms: number): string {
  if (ms < 50)  return c.green;
  if (ms < 300) return c.yellow;
  return c.red;
}

function actionStatusColor(status: ActionLogEntry['status']): string {
  switch (status) {
    case 'success':   return c.green;
    case 'cancelled': return c.yellow;
    case 'queued':    return c.cyan;
    default:          return c.red;
  }
}

// ── Exported logger ───────────────────────────────────────────────────────────
export const nexusLogger = {
  /**
   * Logs an SSR route render to the terminal.
   * Called by @nexus_js/server after each page response.
   */
  route(entry: RouteLogEntry): void {
    const sym    = routeSymbol(entry);
    const mCol   = entry.method === 'GET' ? c.cyan : c.mag;
    const sCol   = entry.status >= 500 ? c.red : entry.status >= 400 ? c.yellow : c.green;
    const tCol   = durationColor(entry.duration);
    const islands = typeof entry.islandCount === 'number' && entry.islandCount > 0
      ? `  ${c.dim}${entry.islandCount} island${entry.islandCount !== 1 ? 's' : ''}${c.reset}`
      : '';
    const errTag = entry.errorMessage
      ? `  ${c.red}${entry.errorMessage.slice(0, 60)}${c.reset}`
      : '';

    process.stdout.write(
      `  ${sym} ` +
      `${c.gray}${now()}${c.reset}` +
      `  ${mCol}${entry.method.padEnd(4)}${c.reset}` +
      `  ${entry.path.padEnd(38)}` +
      `  ${sCol}${entry.status}${c.reset}` +
      `  ${tCol}${entry.duration}ms${c.reset}` +
      cacheTag(entry.cacheStrategy) +
      islands +
      errTag +
      '\n',
    );
  },

  /**
   * Logs a Server Action invocation.
   * Called by @nexus_js/server/actions after each action resolves/rejects.
   */
  action(entry: ActionLogEntry): void {
    const sCol = actionStatusColor(entry.status);
    const sym  = entry.status === 'success'
      ? `${c.green}▲${c.reset}`
      : entry.status === 'cancelled' || entry.status === 'queued'
        ? `${c.yellow}▲${c.reset}`
        : `${c.red}▲${c.reset}`;
    const raceTag = entry.raceStrategy
      ? `  ${c.dim}[race:${entry.raceStrategy}]${c.reset}`
      : '';
    const islandTag = entry.islandId
      ? `  ${c.gray}↳ ${entry.islandId}${c.reset}`
      : '';
    const errTag = entry.errorMessage
      ? `  ${c.red}${entry.errorMessage.slice(0, 60)}${c.reset}`
      : '';

    process.stdout.write(
      `  ${sym} ` +
      `${c.gray}${now()}${c.reset}` +
      `  ${c.mag}${c.bold}ACTION${c.reset}` +
      `  ${c.white}${entry.name.padEnd(32)}${c.reset}` +
      `  ${sCol}${entry.status.toUpperCase().padEnd(10)}${c.reset}` +
      `  ${c.dim}+${entry.duration}ms${c.reset}` +
      raceTag +
      islandTag +
      errTag +
      '\n',
    );
  },

  /**
   * Logs a file-change event from the dev-mode watcher.
   */
  hmr(entry: HmrLogEntry): void {
    process.stdout.write(
      `  ${c.mag}◈${c.reset}` +
      `  ${c.gray}${now()}${c.reset}` +
      `  ${c.mag}[HMR]${c.reset}` +
      `  ${c.cyan}${entry.filename}${c.reset}` +
      `  ${c.dim}${entry.event} — routes reloaded${c.reset}` +
      '\n',
    );
  },

  /**
   * Startup banner. Printed by the CLI after the server port is bound.
   * The server itself does NOT call this — the CLI (or host) controls when/whether to print.
   */
  banner(opts: { port: number; version: string; elapsed: number; dev: boolean }): void {
    if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');

    const env   = opts.dev ? `${c.yellow}dev${c.reset}` : `${c.green}production${c.reset}`;
    const ready = `${c.green}ready in ${opts.elapsed}ms${c.reset}`;

    console.log(
      `\n  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}v${opts.version}${c.reset}` +
      `  ${env}   ${ready}\n` +
      `\n  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}    ${c.cyan}http://localhost:${opts.port}/${c.reset}` +
      (opts.dev
        ? `\n  ${c.green}➜${c.reset}  ${c.bold}Studio${c.reset}   ${c.cyan}http://localhost:7822/${c.reset}   ${c.dim}nexus studio${c.reset}`
        : '') +
      `\n\n  Symbol key:` +
      `  ${c.green}○${c.reset} static  ` +
      `${c.cyan}◑${c.reset} SWR  ` +
      `${c.yellow}λ${c.reset} dynamic  ` +
      `${c.mag}~${c.reset} stream  ` +
      `${c.green}▲${c.reset} action  ` +
      `${c.red}✖${c.reset} error` +
      `\n\n  ${c.dim}press Ctrl+C to stop${c.reset}\n`,
    );
  },
};

// ── Re-export for use in @nexus_js/server/index.ts ───────────────────────────────
export type { RouteLogEntry as NexusRouteLog, ActionLogEntry as NexusActionLog };

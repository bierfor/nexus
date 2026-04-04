import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname, basename, dirname } from 'node:path';
import type { RouteManifest, RouteEntry } from '@nexus_js/compiler';

export type { RouteManifest, RouteEntry };

// Re-export Multi-Tenant support
export {
  extractTenant,
  scopeTenantKey,
  tenantHeaders,
  tenantVaryHeader,
} from './tenant.js';
export type { TenantInfo, TenantConfig, TenantMode } from './tenant.js';

export interface MatchedRoute {
  route: RouteEntry;
  params: Record<string, string>;
  layouts: RouteEntry[];
}

/**
 * Scans a directory tree and builds a route manifest.
 *
 * File conventions:
 *   routes/
 *   ├── +layout.nx          → root layout
 *   ├── +page.nx            → /
 *   ├── about/
 *   │   └── +page.nx        → /about
 *   ├── blog/
 *   │   ├── +layout.nx      → nested layout for all /blog/* routes
 *   │   ├── +page.nx        → /blog
 *   │   └── [slug]/
 *   │       └── +page.nx    → /blog/:slug
 *   └── api/
 *       └── users/
 *           └── +server.nx  → GET/POST /api/users (API route)
 */
export async function buildRouteManifest(routesDir: string): Promise<RouteManifest> {
  const files = await collectFiles(routesDir);
  const routes: RouteEntry[] = [];

  for (const file of files) {
    const rel = relative(routesDir, file);
    const ext = extname(file);
    const base = basename(file, ext);

    if (!['.nx', '.ts', '.js'].includes(ext)) continue;
    if (!base.startsWith('+')) continue;

    const isLayout = base === '+layout';
    const isServerRoute = base === '+server';
    const isPage = base === '+page';

    if (!isLayout && !isServerRoute && !isPage) continue;

    const pattern = filePathToRoutePattern(rel, routesDir);
    const params = extractParams(pattern);

    routes.push({
      pattern,
      filepath: file,
      params,
      isDynamic: params.length > 0,
      isLayout,
      serverActions: [],
    });
  }

  // Link layouts to their children
  linkLayouts(routes);

  return { routes };
}

/**
 * Matches an incoming URL pathname against the route manifest.
 * Returns the matched route + resolved params + layout chain.
 */
export function matchRoute(
  pathname: string,
  manifest: RouteManifest,
): MatchedRoute | null {
  /** Prefer static segments over dynamic (`/blog/new` before `/blog/:slug`). */
  const pageRoutes = manifest.routes
    .filter((r) => !r.isLayout)
    .sort((a, b) => {
      const n = a.params.length - b.params.length;
      if (n !== 0) return n;
      return a.pattern.localeCompare(b.pattern);
    });

  for (const route of pageRoutes) {
    const params = matchPattern(pathname, route.pattern);
    if (params !== null) {
      const layouts = resolveLayoutChain(route, manifest);
      return { route, params, layouts };
    }
  }

  return null;
}

/**
 * Converts a file system path to a URL pattern.
 *
 * routes/blog/[slug]/+page.nx → /blog/:slug
 * routes/+page.nx             → /
 * routes/about/+page.nx       → /about
 */
function filePathToRoutePattern(filepath: string, _routesDir: string): string {
  const parts = filepath.split('/').filter(Boolean);
  const segments: string[] = [];

  for (const part of parts) {
    if (part.startsWith('+')) continue; // skip +page, +layout
    if (part.startsWith('[') && part.endsWith(']')) {
      // Dynamic segment [slug] → :slug
      segments.push(':' + part.slice(1, -1));
    } else if (part.startsWith('(') && part.endsWith(')')) {
      // Route group (auth) — invisible in URL
      continue;
    } else {
      segments.push(part);
    }
  }

  return '/' + segments.join('/');
}

function extractParams(pattern: string): string[] {
  return [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1] ?? '');
}

function matchPattern(
  pathname: string,
  pattern: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i] ?? '';
    const path = pathParts[i] ?? '';
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(path);
    } else if (pp !== path) {
      return null;
    }
  }

  return params;
}

function resolveLayoutChain(
  route: RouteEntry,
  manifest: RouteManifest,
): RouteEntry[] {
  const layouts: RouteEntry[] = [];
  const layoutRoutes = manifest.routes.filter((r) => r.isLayout);

  // Walk up the path tree to find applicable layouts
  const parts = route.pattern.split('/').filter(Boolean);
  const prefixes = ['/', ...parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/'))];

  for (const prefix of prefixes) {
    const layout = layoutRoutes.find((l) => l.pattern === prefix);
    if (layout) layouts.push(layout);
  }

  return layouts;
}

function linkLayouts(routes: RouteEntry[]): void {
  const layouts = routes.filter((r) => r.isLayout);
  for (const route of routes) {
    if (route.isLayout) continue;
    const parentDir = dirname(route.pattern);
    const parentLayout = layouts.find((l) => l.pattern === parentDir);
    if (parentLayout) {
      route.parentLayout = parentLayout.filepath;
    }
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      results.push(...(await collectFiles(fullPath)));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

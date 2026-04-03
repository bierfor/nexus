/**
 * vite-plugin-nexus — Official Vite integration for the Nexus Framework.
 *
 * What this plugin does:
 *   1. Transforms .nx files through the Nexus compiler pipeline
 *   2. Splits server/client code (virtual modules)
 *   3. Handles HMR with surgical island updates (no full-page reload)
 *   4. Generates and updates nexus-types.d.ts on every save
 *   5. Emits island manifests for runtime hydration
 *   6. Integrates with PostCSS/Sass via Vite's native pipeline
 *   7. Handles /_nexus/action/* and /_nexus/image/* in dev server
 *   8. Optimizes assets via Rollup in build mode
 */

import type { Plugin, ViteDevServer, ModuleNode } from 'vite';
import { compile } from '@nexus/compiler';
import { generateTypes } from '@nexus/types';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface NexusPluginOptions {
  /** Root directory of the Nexus app (default: process.cwd()) */
  root?: string;
  /** Enable SSR mode */
  ssr?: boolean;
  /** Enable debug output */
  debug?: boolean;
  /** Auto-generate types on save */
  typeGen?: boolean;
  /** Island hydration default strategy */
  defaultHydration?: string;
}

/** Virtual module IDs */
const VIRTUAL_SERVER = 'virtual:nexus-server/';
const VIRTUAL_CLIENT = 'virtual:nexus-client/';
const RESOLVED_SERVER = '\0' + VIRTUAL_SERVER;
const RESOLVED_CLIENT = '\0' + VIRTUAL_CLIENT;

const NX_FILE_RE = /\.nx(\?.*)?$/;
const ACTION_ROUTE_RE = /^\/_nexus\/action\//;
const IMAGE_ROUTE_RE = /^\/_nexus\/image/;
const SYNC_ROUTE_RE = /^\/_nexus\/sync\//;

export function nexus(opts: NexusPluginOptions = {}): Plugin[] {
  const root = opts.root ?? process.cwd();
  const typeGen = opts.typeGen ?? true;

  // Compiled cache: filepath → { serverCode, clientCode, css, manifest }
  const compiledCache = new Map<string, ReturnType<typeof compile>>();

  let devServer: ViteDevServer | null = null;
  let typeGenDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── Type generation debouncer ──────────────────────────────────────────────
  function scheduleTypeGen(): void {
    if (!typeGen) return;
    if (typeGenDebounce) clearTimeout(typeGenDebounce);
    typeGenDebounce = setTimeout(async () => {
      try {
        await generateTypes({ root });
      } catch (err) {
        console.error('[vite-plugin-nexus] Type generation failed:', err);
      }
    }, 300);
  }

  // ── Main transform plugin ──────────────────────────────────────────────────
  const transformPlugin: Plugin = {
    name: 'nexus:transform',
    enforce: 'pre',

    configResolved(config) {
      if (opts.debug) {
        console.log('[vite-plugin-nexus] Root:', root, 'SSR:', opts.ssr ?? config.build.ssr);
      }
    },

    configureServer(server) {
      devServer = server;

      // Intercept /_nexus/* routes in dev
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';

        // Server Actions endpoint
        if (ACTION_ROUTE_RE.test(url)) {
          const { handleActionRequest } = await import('@nexus/server/actions' as string);
          const webReq = nodeToWebRequest(req);
          const webRes = await handleActionRequest(webReq);
          await pipeResponse(webRes, res);
          return;
        }

        // Image optimizer endpoint
        if (IMAGE_ROUTE_RE.test(url)) {
          const { handleImageRequest } = await import('@nexus/assets/image' as string);
          const webReq = nodeToWebRequest(req);
          const webRes = await handleImageRequest(webReq);
          await pipeResponse(webRes, res);
          return;
        }

        next();
      });
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_SERVER)) return RESOLVED_SERVER + id.slice(VIRTUAL_SERVER.length);
      if (id.startsWith(VIRTUAL_CLIENT)) return RESOLVED_CLIENT + id.slice(VIRTUAL_CLIENT.length);
      return undefined;
    },

    async load(id) {
      if (id.startsWith(RESOLVED_SERVER)) {
        const filepath = id.slice(RESOLVED_SERVER.length);
        const compiled = compiledCache.get(filepath);
        return compiled?.serverCode ?? null;
      }
      if (id.startsWith(RESOLVED_CLIENT)) {
        const filepath = id.slice(RESOLVED_CLIENT.length);
        const compiled = compiledCache.get(filepath);
        return compiled?.clientCode ?? null;
      }
      return null;
    },

    async transform(code, id, transformOpts) {
      if (!NX_FILE_RE.test(id)) return null;

      const filepath = id.split('?')[0] ?? id;
      const isSSR = transformOpts?.ssr ?? false;

      try {
        const result = compile(code, filepath, {
          mode: isSSR ? 'server' : 'client',
          dev: true,
          ssr: isSSR,
          emitIslandManifest: true,
          target: isSSR ? 'node' : 'browser',
        });

        compiledCache.set(filepath, result);

        // Inject island manifest as metadata
        if (result.islandManifest) {
          this.emitFile?.({
            type: 'asset',
            fileName: `islands/${sanitizePath(filepath)}.manifest.json`,
            source: JSON.stringify(result.islandManifest, null, 2),
          });
        }

        // Trigger type generation on save
        scheduleTypeGen();

        if (opts.debug) {
          console.log(`[nexus] Compiled: ${filepath} (server=${isSSR}, islands=${result.islandManifest?.islands.length ?? 0})`);
        }

        // Return appropriate code for the context
        return {
          code: isSSR ? result.serverCode : (result.clientCode ?? result.serverCode),
          map: result.map ?? null,
        };
      } catch (err) {
        this.error(`[nexus] Failed to compile ${filepath}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },

    // ── HMR ─────────────────────────────────────────────────────────────────
    handleHotUpdate({ file, server, modules }) {
      if (!NX_FILE_RE.test(file)) return;

      console.log(`  \x1b[33m[nexus HMR]\x1b[0m ${file.split('/').pop()}`);

      // Invalidate the compiled cache for this file
      compiledCache.delete(file);
      scheduleTypeGen();

      // Find and invalidate affected modules
      const affected = new Set<ModuleNode>();
      for (const mod of modules) {
        affected.add(mod);
        for (const importer of mod.importers) {
          affected.add(importer);
        }
      }

      // Send HMR update payload
      server.ws.send({
        type: 'custom',
        event: 'nexus:hmr',
        data: {
          file,
          // Only reload the specific island, not the whole page
          islandUpdate: true,
          timestamp: Date.now(),
        },
      });

      return [...affected];
    },
  };

  // ── CSS handling plugin ────────────────────────────────────────────────────
  const cssPlugin: Plugin = {
    name: 'nexus:css',
    enforce: 'post',

    transform(code, id) {
      if (!NX_FILE_RE.test(id)) return null;

      const compiled = compiledCache.get(id.split('?')[0] ?? id);
      if (!compiled?.css) return null;

      // Inject scoped CSS as a virtual CSS module
      return {
        code: `${code}\nimport '${id}?nexus-css';`,
      };
    },

    load(id) {
      if (!id.includes('?nexus-css')) return null;
      const filepath = id.split('?')[0] ?? id;
      const compiled = compiledCache.get(filepath);
      return compiled?.css ?? null;
    },
  };

  // ── Type generation plugin ─────────────────────────────────────────────────
  const typesPlugin: Plugin = {
    name: 'nexus:types',

    async buildStart() {
      if (typeGen) {
        await generateTypes({ root }).catch(console.error);
      }
    },
  };

  // ── Islands manifest plugin (build only) ──────────────────────────────────
  const manifestPlugin: Plugin = {
    name: 'nexus:manifest',
    apply: 'build',

    generateBundle(_opts, bundle) {
      const allIslands: unknown[] = [];

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'asset') continue;
        if (!chunk.fileName.includes('.manifest.json')) continue;
        try {
          const manifest = JSON.parse(chunk.source as string);
          allIslands.push(...(manifest.islands ?? []));
        } catch {}
      }

      if (allIslands.length > 0) {
        this.emitFile({
          type: 'asset',
          fileName: 'nexus-islands.json',
          source: JSON.stringify({ islands: allIslands, generated: new Date().toISOString() }, null, 2),
        });
      }
    },
  };

  return [transformPlugin, cssPlugin, typesPlugin, manifestPlugin];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '_');
}

function nodeToWebRequest(req: import('node:http').IncomingMessage): Request {
  const url = `http://localhost${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  return new Request(url, { method: req.method ?? 'GET', headers });
}

async function pipeResponse(
  webRes: Response,
  res: import('node:http').ServerResponse,
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const body = await webRes.text();
  res.end(body);
}

/**
 * Convenience: creates a full Vite config for a Nexus project.
 */
export function defineNexusConfig(config: Record<string, unknown> = {}) {
  return {
    plugins: [nexus()],
    optimizeDeps: {
      include: ['@nexus/runtime'],
    },
    build: {
      rollupOptions: {
        external: ['node:fs', 'node:path', 'node:http', 'node:crypto'],
      },
    },
    ...config,
  };
}

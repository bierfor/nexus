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
import { compile, componentHash } from '@nexus_js/compiler';
import { generateTypes } from '@nexus_js/types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  /**
   * Inject `virtual:nexus-style-bridge` into `index.html` so scoped `.nx` CSS can hot-patch
   * via WebSocket without full reload (islands / runes stay warm).
   * @default true
   */
  styleBridge?: boolean;
}

/** Virtual module IDs */
const VIRTUAL_SERVER = 'virtual:nexus-server/';
const VIRTUAL_CLIENT = 'virtual:nexus-client/';
const RESOLVED_SERVER = '\0' + VIRTUAL_SERVER;
const RESOLVED_CLIENT = '\0' + VIRTUAL_CLIENT;

/** Client HMR: applies `nexus:style-update` payloads to `<style data-nx-style-scope>`. */
const VIRTUAL_STYLE_BRIDGE = 'virtual:nexus-style-bridge';
const RESOLVED_STYLE_BRIDGE = '\0' + VIRTUAL_STYLE_BRIDGE;

const NX_FILE_RE = /\.nx(\?.*)?$/;
const ACTION_ROUTE_RE = /^\/_nexus\/action\//;
const IMAGE_ROUTE_RE = /^\/_nexus\/image/;

/** Env vars with these prefixes are allowed in client bundles. */
const CLIENT_SAFE_PREFIXES = ['NEXUS_PUBLIC_'];

/**
 * Server-only module patterns (SvelteKit-style tainted module isolation).
 * Any client-side import that resolves to a path matching these patterns
 * is blocked with a hard error at build time.
 *
 * Matches:
 *   - *.server.ts / *.server.tsx / *.server.js
 *   - anything under /lib/server/ (or \lib\server\ on Windows)
 *   - anything under /src/server/
 */
const SERVER_ONLY_RE = /(?:[/\\]lib[/\\]server[/\\]|[/\\]src[/\\]server[/\\]|\.server\.[jt]sx?)(?:[?#]|$)/;

/**
 * Pattern matching bare `process.env.FOO` or `import.meta.env.FOO` accesses in
 * client JS/TS files where FOO is not in the CLIENT_SAFE_PREFIXES allowlist.
 * This is a heuristic — the authoritative filter is Vite's `envPrefix` option.
 */
const PRIVATE_ENV_RE = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g;

export function nexus(opts: NexusPluginOptions = {}): Plugin[] {
  const root = opts.root ?? process.cwd();
  const typeGen = opts.typeGen ?? true;
  const styleBridgeEnabled = opts.styleBridge !== false;

  // Compiled cache: filepath → { serverCode, clientCode, css, manifest }
  const compiledCache = new Map<string, ReturnType<typeof compile>>();

  // Set to false when Vite is running in build mode (vite build).
  // Used to pass the correct `dev` flag to the compiler so production code-paths
  // (JS-first $lib resolution, no cache-bust timestamps) are used during builds.
  let isDevMode = true;

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

  // ── Tainted-modules plugin: .server.ts / lib/server/ isolation ───────────
  // Inspired by SvelteKit's $lib/server isolation.
  // Prevents accidental leaking of server-only code (DB clients, secrets,
  // crypto operations) into client bundles by erroring at build time.
  //
  // Convention:
  //   src/lib/server/**   → server-only (never client)
  //   src/server/**       → server-only
  //   *.server.ts/js      → server-only
  //
  // In SSR mode (ssr: true transform option) all imports are allowed.
  const taintedModulesPlugin: Plugin = {
    name: 'nexus:tainted-modules',
    enforce: 'pre',

    resolveId(source, importer, options) {
      // Only guard client-side bundles
      if (options?.ssr) return undefined;
      if (!importer) return undefined;
      // Skip virtual modules and node_modules
      if (source.startsWith('\0') || source.includes('/node_modules/')) return undefined;

      // Check if the raw import specifier already looks server-only
      if (SERVER_ONLY_RE.test(source)) {
        const tip = source.endsWith('.server.ts') || source.endsWith('.server.tsx')
          ? `Move the logic to a Server Action (createAction) or the "---" server frontmatter block.`
          : `Move the import to a Server Action or the "---" server frontmatter block.`;
        this.error(
          `[Nexus] Server-only module "${source}" was imported from a client bundle.\n` +
          `  Importer: ${importer}\n` +
          `  ${tip}\n` +
          `  Files in "lib/server/", "src/server/", or with ".server.ts" extension\n` +
          `  are server-only and must never reach the browser.`,
        );
      }
      return undefined;
    },

    // Second pass: check resolved absolute paths so aliased imports are also caught.
    load(id, options) {
      if (options?.ssr) return undefined;
      if (id.startsWith('\0') || id.includes('/node_modules/')) return undefined;
      if (SERVER_ONLY_RE.test(id)) {
        // Return an empty stub so Rollup keeps going (the resolveId error above
        // already fired; this is a safety net for edge cases where resolveId ran in SSR pass).
        return `throw new Error("[Nexus] Attempted to load server-only module at runtime: ${id.replace(/\\/g, '/')}");`;
      }
      return undefined;
    },
  };

  // ── Env-guard plugin: NEXUS_PUBLIC_ prefix ────────────────────────────────
  // Tells Vite which env vars to expose to the browser bundle and warns when
  // client-side code tries to reference a private variable at build time.
  const envGuardPlugin: Plugin = {
    name: 'nexus:env-guard',
    enforce: 'pre',

    config(config) {
      // Set envPrefix so only NEXUS_PUBLIC_* vars appear in import.meta.env.*
      // Merge with any existing prefix the user already configured.
      const existing = config.envPrefix;
      const merged: string[] = CLIENT_SAFE_PREFIXES.slice();
      if (Array.isArray(existing)) {
        for (const p of existing) {
          if (!merged.includes(p)) merged.push(p);
        }
      } else if (typeof existing === 'string' && !merged.includes(existing)) {
        merged.push(existing);
      }
      return { envPrefix: merged };
    },

    transform(code, id, transformOpts) {
      // Only scan client-side modules (not SSR/server bundles, not node_modules)
      if (transformOpts?.ssr) return null;
      if (id.includes('/node_modules/')) return null;
      if (!/\.[jt]sx?$/.test(id) && !NX_FILE_RE.test(id)) return null;

      PRIVATE_ENV_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PRIVATE_ENV_RE.exec(code)) !== null) {
        const varName = match[1] ?? '';
        const isAllowed = CLIENT_SAFE_PREFIXES.some((prefix) => varName.startsWith(prefix));
        if (!isAllowed) {
          this.warn(
            `[Nexus] "${match[0]}" references a private environment variable in a client bundle. ` +
            `Only variables prefixed with ${CLIENT_SAFE_PREFIXES.map((p) => `"${p}"`).join(' or ')} ` +
            `are safe to expose to the browser. ` +
            `Rename it to NEXUS_PUBLIC_${varName} if it is intentionally public, ` +
            `or move it to a server module (behind "---" frontmatter or a Server Action).`,
          );
        }
      }
      return null; // never mutate — just warn
    },
  };

  // ── Main transform plugin ──────────────────────────────────────────────────
  const transformPlugin: Plugin = {
    name: 'nexus:transform',
    enforce: 'pre',

    configResolved(config) {
      // `config.command` is 'serve' for dev server, 'build' for vite build.
      isDevMode = config.command === 'serve';
      if (opts.debug) {
        console.log('[vite-plugin-nexus] Root:', root, 'SSR:', opts.ssr ?? config.build.ssr, 'dev:', isDevMode);
      }
    },

    configureServer(server) {
      devServer = server;

      // Intercept /_nexus/* routes in dev
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';

        // Server Actions endpoint
        if (ACTION_ROUTE_RE.test(url)) {
          const { handleActionRequest } = await import('@nexus_js/server/actions' as string);
          const webReq = nodeToWebRequest(req);
          const webRes = await handleActionRequest(webReq);
          await pipeResponse(webRes, res);
          return;
        }

        // Image optimizer endpoint
        if (IMAGE_ROUTE_RE.test(url)) {
          const { handleImageRequest } = await import('@nexus_js/assets/image' as string);
          const webReq = nodeToWebRequest(req);
          const publicDir = join(root, 'public');
          const webRes = await handleImageRequest(webReq, { publicDir });
          if (req.method === 'HEAD') {
            res.statusCode = webRes.status;
            webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
            res.end();
            return;
          }
          await pipeResponse(webRes, res);
          return;
        }

        next();
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_STYLE_BRIDGE) return RESOLVED_STYLE_BRIDGE;
      if (id.startsWith(VIRTUAL_SERVER)) return RESOLVED_SERVER + id.slice(VIRTUAL_SERVER.length);
      if (id.startsWith(VIRTUAL_CLIENT)) return RESOLVED_CLIENT + id.slice(VIRTUAL_CLIENT.length);
      return undefined;
    },

    async load(id) {
      if (id === RESOLVED_STYLE_BRIDGE) {
        return styleBridgeClientCode();
      }
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
          dev: isDevMode,
          ssr: isSSR,
          emitIslandManifest: true,
          target: isSSR ? 'node' : 'browser',
        });

        compiledCache.set(filepath, result);

        if (result.warnings?.length) {
          for (const w of result.warnings) {
            console.warn(`[nexus] ${w.message}`);
          }
        }

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

    // ── HMR — scoped CSS stream & inject (matches [data-nx="<hash>"] from compiler) ──
    async handleHotUpdate({ file, server, modules }) {
      if (!NX_FILE_RE.test(file)) return;

      console.log(`  \x1b[33m[nexus HMR]\x1b[0m ${file.split('/').pop()}`);

      let source: string;
      try {
        source = await readFile(file, 'utf-8');
      } catch {
        return;
      }

      let hotResult: ReturnType<typeof compile>;
      try {
        hotResult = compile(source, file, {
          mode:       'server',
          dev:        true,
          ssr:        true,
          emitIslandManifest: false,
          target:     'node',
        });
      } catch (err) {
        server.ws.send({
          type:    'custom',
          event:   'nexus:compile-error',
          data:    {
            file,
            message: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }

      if (hotResult.css) {
        server.ws.send({
          type:  'custom',
          event: 'nexus:style-update',
          data:  {
            hash:     componentHash(file),
            css:      hotResult.css,
            filepath: file,
          },
        });
      }

      compiledCache.delete(file);
      scheduleTypeGen();

      const affected = new Set<ModuleNode>();
      for (const mod of modules) {
        affected.add(mod);
        for (const importer of mod.importers) {
          affected.add(importer);
        }
      }

      server.ws.send({
        type:  'custom',
        event: 'nexus:hmr',
        data:  {
          file,
          islandUpdate: true,
          timestamp:    Date.now(),
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

  const styleBridgeHtmlPlugin: Plugin = {
    name:   'nexus:style-bridge-html',
    apply:  'serve',
    transformIndexHtml(html) {
      if (!styleBridgeEnabled) return html;
      if (!html.includes('</head>')) return html;
      if (html.includes('virtual:nexus-style-bridge') || html.includes('__x00__virtual:nexus-style-bridge')) {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag:      'script',
            attrs:    { type: 'module', src: '/@id/__x00__virtual:nexus-style-bridge' },
            injectTo: 'head',
          },
        ],
      };
    },
  };

  return [taintedModulesPlugin, envGuardPlugin, transformPlugin, cssPlugin, typesPlugin, manifestPlugin, styleBridgeHtmlPlugin];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dev-only client: listens for `nexus:style-update` and patches `<style data-nx-style-scope>`.
 * Hash matches `componentHash(filepath)` → same as `data-nx` on scoped templates.
 */
function styleBridgeClientCode(): string {
  return `/* nexus style bridge — hot-patch scoped .nx CSS (hash = componentHash(filepath)) */
if (import.meta.hot) {
  import.meta.hot.on('nexus:style-update', (payload) => {
    const o = payload && typeof payload === 'object' ? payload : {};
    const h = 'hash' in o && o.hash != null ? String(o.hash) : '';
    const css = 'css' in o && o.css != null ? String(o.css) : '';
    if (!h || !css) return;
    const sel = 'style[data-nx-style-scope="' + h + '"]';
    let el = document.querySelector(sel);
    if (el) {
      el.textContent = css;
    } else {
      el = document.createElement('style');
      el.setAttribute('data-nx-style-scope', h);
      el.textContent = css;
      document.head.appendChild(el);
    }
  });
  import.meta.hot.on('nexus:compile-error', (payload) => {
    console.error('[nexus] .nx compile error:', payload);
  });
}
`;
}

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
  const body = Buffer.from(await webRes.arrayBuffer());
  res.end(body);
}

// Re-export security plugin
export { nexusSecurity } from './security.js';
export type { NexusSecurityPluginOptions } from './security.js';

/**
 * Convenience: creates a full Vite config for a Nexus project.
 */
export function defineNexusConfig(config: Record<string, unknown> = {}) {
  return {
    plugins: [nexus()],
    optimizeDeps: {
      include: ['@nexus_js/runtime'],
    },
    build: {
      rollupOptions: {
        external: ['node:fs', 'node:path', 'node:http', 'node:crypto'],
      },
    },
    ...config,
  };
}

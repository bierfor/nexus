/** A parsed block extracted from a .nx file */
export interface NexusBlock {
  type: 'server' | 'script' | 'template' | 'style';
  content: string;
  start: number;
  end: number;
}

/** Parsed representation of a .nx component file */
export interface ParsedComponent {
  /** Raw source code */
  source: string;
  /** Path of the file */
  filepath: string;
  /** Frontmatter block (server-only, runs at request time) */
  frontmatter: NexusBlock | null;
  /**
   * Optional `// nexus:pretext` … `// nexus:server` region — compiled to `export async function nxPretext(ctx)`.
   * Executed in parallel with parent layouts before `render()`, merged onto `ctx.pretext`.
   */
  pretext: string | null;
  /** Reactive script block (client island code using Runes) */
  script: NexusBlock | null;
  /** HTML template block */
  template: NexusBlock | null;
  /** Style block */
  style: NexusBlock | null;
  /** Detected island directives e.g. client:visible, client:idle */
  islandDirectives: IslandDirective[];
  /** Detected server actions ("use server" functions) */
  serverActions: ServerAction[];
}

export type IslandHydration =
  | 'client:load'     // Hydrate immediately on page load
  | 'client:idle'     // Hydrate when browser is idle
  | 'client:visible'  // Hydrate when component enters viewport
  | 'client:media'    // Hydrate when media query matches
  | 'server:only';    // Never hydrate (pure server render)

export interface IslandDirective {
  directive: IslandHydration;
  componentName: string;
  /** For client:media — the query string */
  mediaQuery?: string;
}

export interface ServerAction {
  name: string;
  params: string[];
  body: string;
  /** Inferred TypeScript return type */
  returnType: string;
  /**
   * If set, emitted as `registerAction(name, createAction(...), { csrf: false })` instead of a raw
   * async handler (from `const x = createAction(...)` in the .nx script).
   */
  createActionSource?: string;
}

export interface CompileOptions {
  mode: 'server' | 'client' | 'static';
  dev: boolean;
  ssr: boolean;
  /** Whether to emit island manifests for the runtime */
  emitIslandManifest: boolean;
  target: 'node' | 'edge' | 'browser';
  /** App root — used for stable /_nexus/islands/client.mjs?path=… query strings */
  appRoot?: string;
  /**
   * Route URL pattern from the manifest (e.g. `/dashboard`). When `dev` is false, the actions
   * sidecar imports the server bundle via `./${segment}.js` matching `nexus build` output.
   */
  routePattern?: string;
  /**
   * Dev only: max mtime of `src/lib/**` — appended as `?t=` on emitted `$lib` imports so Node ESM
   * reloads when shared modules change without restarting the dev server.
   */
  libDepsMtime?: number;
  /**
   * Production only: content-hash manifest produced by `bundleIslandLib`.
   * Maps canonical lib rel paths (`utils/date.js`) to hashed filenames
   * (`utils/date.a1b2c3d4.js`). When present, `rewriteDollarLibImportsForClient`
   * emits `/_nexus/lib/<hashed>` URLs directly.
   */
  libManifest?: ReadonlyMap<string, string>;
}

export interface CompileResult {
  /** Server-side module code (runs on every request) */
  serverCode: string;
  /** Client-side island code (only sent to browser when needed) */
  clientCode: string | null;
  /** CSS output */
  css: string | null;
  /** Island manifest for runtime hydration */
  islandManifest: IslandManifest | null;
  /** Server Actions extracted to separate module */
  actionsModule: string | null;
  /** Source maps */
  map: string | null;
  warnings: CompileWarning[];
}

export interface IslandManifest {
  islands: IslandEntry[];
}

export interface IslandEntry {
  id: string;
  componentPath: string;
  directive: IslandHydration;
  props: string[];
  mediaQuery?: string;
}

export interface CompileWarning {
  message: string;
  start?: number;
  end?: number;
}

export interface RouteManifest {
  routes: RouteEntry[];
}

export interface RouteEntry {
  pattern: string;
  filepath: string;
  params: string[];
  isDynamic: boolean;
  isLayout: boolean;
  parentLayout?: string;
  serverActions: string[];
}

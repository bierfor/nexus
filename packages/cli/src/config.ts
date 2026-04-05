import type { AllowVulnerableConfig } from '@nexus_js/audit';

/** Security & audit (v0.5+ Hardened Mode, v0.6+ dependency / supply-chain guard). */
export interface NexusSecurityConfig {
  /** When true, responses include CSP-adjacent hardening, XFO, nosniff, referrer-policy (server). */
  hardened?: boolean;
  /**
   * When `true` together with `hardened: true`, `nexus build` fails if the compiler reports
   * any `[security]` finding (e.g. `process.env` in an island script, inline `on*="..."`).
   */
  failOnIslandSecurity?: boolean;
  /** Time-limited CVE exceptions — see @nexus_js/audit override policy. */
  allowVulnerable?: AllowVulnerableConfig;
  audit?: {
    /** Severities that count toward blocking when blockBuild is on (reserved for future granularity). */
    failOn?: ('critical' | 'high' | 'medium')[];
    /**
     * If true, `nexus build` runs OSV + supply-chain scan and exits non-zero on unmitigated critical/high CVEs.
     */
    blockBuild?: boolean;
  };
  /**
   * When true, unknown server action names are rejected with 403 (Shield-lite) using the build manifest + registry.
   * `nexus build` writes `.nexus/output/shield-manifest.json`.
   */
  shieldLite?: boolean;
}

/** DevRadar / Studio telemetry (see `packages/server/src/devradar.ts`). */
export interface NexusObservabilityConfig {
  /** When false, DevRadar does not register the Studio sink (default: true in dev). */
  enabled?: boolean;
  /** Future: forward $state churn to Studio (requires client bridge). */
  traceRunes?: boolean;
  /** Server Actions + pretext events are always emitted when the sink is registered. */
  traceActions?: boolean;
  /** Reserved for ANSI tables in the terminal. */
  terminalOutput?: 'plain' | 'fancy';
}

export interface NexusConfig {
  /** Default island hydration strategy */
  defaultHydration?: 'client:load' | 'client:idle' | 'client:visible';

  /** Image optimization settings */
  images?: {
    formats?: ('avif' | 'webp' | 'png' | 'jpg')[];
    sizes?: number[];
    quality?: number;
  };

  /** Server configuration */
  server?: {
    port?: number;
    host?: string;
    /** Run on edge runtime (Cloudflare Workers / Deno Deploy compatible) */
    edge?: boolean;
    /**
     * Flush HTML shell before `nxPretext` finishes (chunked SSR). Best when Pretext hits DB/API.
     * Use fragment layouts only (no root `&lt;html&gt;` from routes).
     */
    streamingPretext?: boolean;
  };

  /** Build configuration */
  build?: {
    outDir?: string;
    sourcemap?: boolean;
    minify?: boolean;
    /** Target adapters */
    adapter?: 'node' | 'cloudflare' | 'vercel' | 'fly' | 'deno';
  };

  /** Internationalization */
  i18n?: {
    defaultLocale: string;
    locales: string[];
    /** Path to translation files */
    translationsDir?: string;
  };

  /** Plugins */
  plugins?: NexusPlugin[];

  /** Security headers, build-time audit, overrides (see changelog v0.5 / v0.6). */
  security?: NexusSecurityConfig;

  /** Introspection: DevRadar → Nexus Studio WebSocket (development). */
  observability?: NexusObservabilityConfig;

  /**
   * Browser-only hooks merged into the HTML shell (import map for island `import()` specifiers, etc.).
   */
  browser?: {
    /**
     * Merged with Nexus defaults in `<script type="importmap">`. Use for packages your islands
     * `import()` that are not native ESM in `node_modules` (map to `https://esm.sh/...` or a self-hosted URL).
     */
    importMap?: Record<string, string>;
  };
}

export interface NexusPlugin {
  name: string;
  transform?: (source: string, filepath: string) => string | Promise<string>;
  buildStart?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
}

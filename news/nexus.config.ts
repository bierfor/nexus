import type { NexusConfig } from '@nexus_js/cli';

export default {
  /**
   * Subdomains (e.g. `admin.tudominio.com` → same app): point DNS/host to this Nexus
   * server and add the host in dev (`/etc/hosts` → `127.0.0.1 admin.localhost`).
   * Routing is path-based (`/admin`); no extra config required here.
   */
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'pt'],
  },

  // Islands hydration strategy defaults
  defaultHydration: 'client:visible',

  // Image optimization
  images: {
    formats: ['avif', 'webp'],
    sizes: [640, 1280, 1920],
  },

  // Server options
  server: {
    port: 3011,
  },

  // Build output
  build: {
    outDir: '.nexus/output',
    sourcemap: false,
  },

  /**
   * Hardened mode + optional supply-chain scan on `nexus build`.
   * - `failOnIslandSecurity`: build fails if the compiler reports `[security]` in island scripts/templates.
   * - Studio Security Report reads `.nexus/last-build-security.json` after a successful build (dev shows snapshot).
   */
  security: {
    hardened:             true,
    failOnIslandSecurity: true,
    audit: {
      failOn:     ['critical', 'high'],
      blockBuild: false,
    },
  },

  /** DevRadar + Nexus Studio (security report, etc.); default is on in dev when unset. */
  observability: {
    enabled: true,
  },
} satisfies NexusConfig;

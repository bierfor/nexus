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
} satisfies NexusConfig;

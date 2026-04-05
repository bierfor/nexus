import type { NexusConfig } from '@nexus_js/cli';

/**
 * Fin.sh — aligned with Nexus 0.7.x defaults (hardened headers, DevRadar, Shield-lite off for local GraphQL).
 */
export default {
  defaultHydration: 'client:visible',

  server: {
    port: 3050,
  },

  images: {
    formats: ['avif', 'webp'],
    sizes: [640, 1280],
    quality: 80,
  },

  build: {
    outDir: '.nexus/output',
    sourcemap: true,
  },

  security: {
    hardened: true,
    failOnIslandSecurity: false,
    shieldLite: false,
  },

  observability: {
    enabled: true,
  },

  /** Island `import('qr-code-styling')` — package is UMD in npm; map to ESM for the browser. */
  browser: {
    importMap: {
      'qr-code-styling': 'https://esm.sh/qr-code-styling@1.9.2?target=es2022',
    },
  },
} satisfies NexusConfig;

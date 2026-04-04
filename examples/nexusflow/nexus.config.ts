import type { NexusConfig } from '@nexus/cli';

/**
 * NexusFlow — consumed by CLI / Guard; `server.port` matches `nexus dev --port` in package.json.
 */
export default {
  defaultHydration: 'client:visible',
  server: {
    port: 3010,
  },
  build: {
    outDir: '.nexus/output',
    sourcemap: true,
  },
  security: {
    hardened: true,
    audit: {
      failOn: ['critical', 'high'],
      blockBuild: true,
    },
  },
} as NexusConfig & {
  security: {
    hardened: boolean;
    audit: { failOn: string[]; blockBuild: boolean };
  };
};

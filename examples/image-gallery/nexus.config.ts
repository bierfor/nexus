import type { NexusConfig } from '@nexus_js/cli';

export default {
  defaultHydration: 'client:load',
  server: { port: 3040 },
  build: { outDir: '.nexus/output', sourcemap: false },
} satisfies NexusConfig;

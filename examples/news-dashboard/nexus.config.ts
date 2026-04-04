import type { NexusConfig } from '@nexus_js/cli';

export default {
  defaultHydration: 'client:load',
  server: { port: 3030 },
  build: { outDir: '.nexus/output', sourcemap: false },
} satisfies NexusConfig;

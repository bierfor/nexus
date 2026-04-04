import type { NexusConfig } from '@nexus/cli';

export default {
  defaultHydration: 'client:load',
  server: { port: 3020 },
  build: { outDir: '.nexus/output', sourcemap: false },
} satisfies NexusConfig;

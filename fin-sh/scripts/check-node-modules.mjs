import { access } from 'node:fs/promises';
import { join } from 'node:path';

const marker = join(process.cwd(), 'node_modules/@nexus_js/cli/package.json');
try {
  await access(marker);
} catch {
  console.error(
    '\n  Dependencies are missing. From this folder run:  pnpm install  or  npm install\n' +
      '  (Nexus packages @nexus_js/* come from the npm registry). In the full monorepo, you can also run pnpm install from the repo root.\n',
  );
  process.exit(1);
}

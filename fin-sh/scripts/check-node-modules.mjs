import { access } from 'node:fs/promises';
import { join } from 'node:path';

const marker = join(process.cwd(), 'node_modules/@nexus_js/cli/package.json');
try {
  await access(marker);
} catch {
  console.error(
    '\n  Dependencies are missing. Run pnpm install from the monorepo root, then try again.\n',
  );
  process.exit(1);
}

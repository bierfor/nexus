#!/usr/bin/env node
/**
 * Lightweight smoke checks for the News app (run with API + news dev servers, or adjust URLs).
 * Usage: node scripts/smoke.mjs [--url=http://127.0.0.1:3011]
 */

const base =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6)?.trim() || 'http://127.0.0.1:3011';

async function main() {
  console.log(`\n◆ Nexus News smoke — base ${base}\n`);

  const paths = ['/', '/dev', '/flash', '/tags'];
  for (const p of paths) {
    const url = new URL(p, base).href;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const tag = r.ok ? '✔' : '✖';
      console.log(`  ${tag}  ${r.status}  ${p}`);
    } catch (e) {
      console.log(`  ✖  FAIL  ${p}  ${e instanceof Error ? e.message : e}`);
    }
  }

  // /dev returns 404 in production — OK if 404 when running prod build
  console.log('\n  Tip: run `pnpm dev` in news and `npm run dev` in mongo/backend, then open /dev in the browser.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

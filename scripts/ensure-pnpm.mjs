#!/usr/bin/env node
/**
 * Root preinstall: this monorepo is meant to be installed with pnpm only.
 * npm/yarn do not honor pnpm-workspace.yaml the same way and break workspace:^ links.
 */
const ua = process.env.npm_config_user_agent || '';
if (/\bpnpm\//i.test(ua)) process.exit(0);

console.error(`
This repository must be installed with pnpm (not npm or yarn at the repo root).

  corepack enable
  corepack prepare pnpm@9.14.0 --activate
  pnpm install

See package.json "packageManager" and README prerequisites.
`);
process.exit(1);

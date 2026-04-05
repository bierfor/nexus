#!/usr/bin/env node
/**
 * Root preinstall: Node 22+ (see package.json engines and .nvmrc), and pnpm only at repo root.
 */
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (nodeMajor < 22) {
  console.error(`
Node.js 22 or newer is required (you are on ${process.version}).

  nvm install 22 && nvm use    # or: fnm use / mise use
  See .nvmrc and package.json "engines".
`);
  process.exit(1);
}

/**
 * This monorepo is meant to be installed with pnpm only.
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

#!/usr/bin/env node
/**
 * Set the same semver on the workspace root and every package under packages/*.
 * Usage: pnpm version:framework -- 0.7.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm may pass: node script.mjs -- 0.7.0  →  argv includes "--"
const args = process.argv.slice(2).filter((a) => a !== '--');
const ver = args[0];
if (!ver || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(ver)) {
  console.error('Usage: pnpm version:framework -- <semver>');
  console.error('Example: pnpm version:framework -- 0.7.0');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');

for (const name of fs.readdirSync(packagesDir)) {
  const pkgPath = path.join(packagesDir, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const j = JSON.parse(raw);
  j.version = ver;
  // npm does not understand workspace:* — keep @nexus_js/cli as semver so npm/pnpm/yarn all resolve.
  if (j.name === '@nexus_js/create-nexus' && j.dependencies?.['@nexus_js/cli']) {
    j.dependencies['@nexus_js/cli'] = `^${ver}`;
  }
  if (j.name === 'nexus_js' && j.dependencies?.['@nexus_js/cli']) {
    j.dependencies['@nexus_js/cli'] = `^${ver}`;
  }
  if (j.name === 'nexus-js' && j.dependencies?.['@nexus_js/cli']) {
    j.dependencies['@nexus_js/cli'] = `^${ver}`;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n');
  console.log(`${j.name} → ${ver}`);
}

const rootPkgPath = path.join(root, 'package.json');
const rj = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
rj.version = ver;
fs.writeFileSync(rootPkgPath, JSON.stringify(rj, null, 2) + '\n');
console.log(`nexus-workspace (root) → ${ver}`);

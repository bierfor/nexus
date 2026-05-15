#!/usr/bin/env node
/**
 * Safe per-package release flow for the Nexus monorepo.
 *
 * Usage:
 *   pnpm release:package -- @nexus_js/cli patch
 *   pnpm release:package -- @nexus_js/compiler 1.0.0
 *   pnpm release:package -- @nexus_js/cli patch --no-push
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const packageName = args[0];
const bumpArg = args[1];
const noPush = args.includes('--no-push');
const tagIndex = args.indexOf('--tag');
const distTag = tagIndex >= 0 ? args[tagIndex + 1] : 'latest';

if (!packageName || !bumpArg) {
  console.error('Usage: pnpm release:package -- <package-name> <patch|minor|major|version> [--no-push] [--tag latest]');
  process.exit(1);
}

if (!distTag) {
  console.error('Missing value for --tag');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..');
const packagesDir = path.join(repoRoot, 'packages');

function run(cmd, cmdArgs, description) {
  console.log(`\n> ${description}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getStdout(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v);
}

function bumpVersion(current, kind) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!m) {
    throw new Error(`Current version is not valid semver: ${current}`);
  }
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);

  if (kind === 'patch') patch += 1;
  else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new Error(`Invalid bump type: ${kind}`);
  }

  return `${major}.${minor}.${patch}`;
}

function findPackageJsonPathByName(name) {
  const dirs = fs.readdirSync(packagesDir, { withFileTypes: true });
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, dirent.name, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (parsed.name === name) return pkgJsonPath;
  }
  return null;
}

const pkgJsonPath = findPackageJsonPathByName(packageName);
if (!pkgJsonPath) {
  console.error(`Package not found under packages/*: ${packageName}`);
  process.exit(1);
}

const pkgRelativePath = path.relative(repoRoot, pkgJsonPath);
const gitDirty = getStdout('git', ['status', '--porcelain']);
if (gitDirty) {
  console.error('Working tree must be clean before releasing. Commit/stash your changes first.');
  process.exit(1);
}

const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const currentVersion = String(pkgJson.version || '');
const nextVersion = isSemver(bumpArg) ? bumpArg : bumpVersion(currentVersion, bumpArg);

if (currentVersion === nextVersion) {
  console.error(`Version is already ${currentVersion}.`);
  process.exit(1);
}

console.log(`Releasing ${packageName}: ${currentVersion} -> ${nextVersion}`);

run('pnpm', ['--filter', `${packageName}...`, 'build'], `Build ${packageName} and local deps`);

pkgJson.version = nextVersion;
fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');
console.log(`Updated ${pkgRelativePath}`);

run(
  'pnpm',
  ['--filter', packageName, 'publish', '--access', 'public', '--tag', distTag, '--no-git-checks'],
  `Publish ${packageName}@${nextVersion} to npm (${distTag})`,
);

run(
  'npm',
  ['dist-tag', 'ls', packageName, '--registry=https://registry.npmjs.org/'],
  `Verify dist-tags for ${packageName}`,
);

const shortName = packageName.replace(/^@/, '').replace(/\//g, '-');
const gitTag = `${shortName}-v${nextVersion}`;
const commitMessage = `release(${packageName}): ${nextVersion}`;

run('git', ['add', pkgRelativePath], `Stage ${pkgRelativePath}`);
run('git', ['commit', '-m', commitMessage], 'Create release commit');
run('git', ['tag', gitTag], `Create git tag ${gitTag}`);

if (!noPush) {
  run('git', ['push', 'origin', 'HEAD'], 'Push commit to origin');
  run('git', ['push', 'origin', gitTag], `Push tag ${gitTag}`);
}

console.log('\nRelease complete.');
console.log(`- Package: ${packageName}`);
console.log(`- Version: ${nextVersion}`);
console.log(`- Tag: ${gitTag}`);
console.log(`- Pushed: ${noPush ? 'no (--no-push)' : 'yes'}`);

#!/usr/bin/env node
/**
 * Forwards to @nexus_js/cli so `npx nexus` works after `npm i -g nexus-js` (or `nexus_js`).
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = import.meta.resolve('@nexus_js/cli');
const main = fileURLToPath(url);
const root = dirname(dirname(main));
const cli = join(root, 'dist', 'bin.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));

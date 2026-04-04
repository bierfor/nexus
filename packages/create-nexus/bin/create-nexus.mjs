#!/usr/bin/env node
/**
 * Thin entry so `npm create @nexus_js/nexus` / `npx @nexus_js/create-nexus` resolves the
 * official scaffold from @nexus_js/cli (same as the create-nexus binary there).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const url = import.meta.resolve('@nexus_js/cli');
const main = fileURLToPath(url);
const root = dirname(dirname(main));
await import(pathToFileURL(join(root, 'dist', 'create.js')).href);

#!/usr/bin/env node
/**
 * Same scaffold as @nexus_js/create-nexus — loads @nexus_js/cli/dist/create.js.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const url = import.meta.resolve('@nexus_js/cli');
const main = fileURLToPath(url);
const root = dirname(dirname(main));
await import(pathToFileURL(join(root, 'dist', 'create.js')).href);

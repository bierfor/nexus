export { componentHash, NEXUS_LAYER_DECLARATION } from './css-scope.js';
export { scanIslandSecurity } from './client-security-scan.js';
export { parse } from './parser.js';
export { generate } from './codegen.js';
export { extractServerActionsFromSource } from './server-actions-extract.js';
export { splitPretext, transformPretextExport } from './pretext-extract.js';
export { compileLib } from './compile-lib.js';
export { bundleIslandLib, extractLibImports, applyLibManifestToClientCode } from './bundle-island-lib.js';
export type {
  ParsedComponent,
  CompileOptions,
  CompileResult,
  NexusBlock,
  IslandDirective,
  IslandHydration,
  ServerAction,
  IslandManifest,
  IslandEntry,
  RouteManifest,
  RouteEntry,
  CompileWarning,
} from './types.js';

import { parse } from './parser.js';
import { generate } from './codegen.js';
import type { CompileOptions, CompileResult } from './types.js';

/** High-level API: compile a .nx source string end-to-end */
export function compile(
  source: string,
  filepath: string,
  opts: Partial<CompileOptions> = {},
): CompileResult {
  const options: CompileOptions = {
    mode: opts.mode ?? 'server',
    dev: opts.dev ?? false,
    ssr: opts.ssr ?? true,
    emitIslandManifest: opts.emitIslandManifest ?? true,
    target: opts.target ?? 'node',
    ...(opts.appRoot !== undefined ? { appRoot: opts.appRoot } : {}),
    ...(opts.libDepsMtime !== undefined ? { libDepsMtime: opts.libDepsMtime } : {}),
    ...(opts.routePattern !== undefined ? { routePattern: opts.routePattern } : {}),
  };

  const parsed = parse(source, filepath);
  return generate(parsed, options);
}

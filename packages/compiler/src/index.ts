export { componentHash, NEXUS_LAYER_DECLARATION } from './css-scope.js';
export { scanIslandSecurity } from './client-security-scan.js';
export { parse, offsetToLineColumn } from './parser.js';
export { generate } from './codegen.js';
export { extractServerActionsFromSource } from './server-actions-extract.js';
export { splitPretext, transformPretextExport } from './pretext-extract.js';
export { compileLib } from './compile-lib.js';
export { bundleIslandLib, extractLibImports, applyLibManifestToClientCode } from './bundle-island-lib.js';
export { guard, formatGuardResult } from './guard.js';
export { formatCompileError, formatCompileWarning, formatWarnings, extractFrame } from './error-formatter.js';
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
  SourceLocation,
} from './types.js';
export { CompileError } from './types.js';

import { parse } from './parser.js';
import { generate } from './codegen.js';
import { guard } from './guard.js';
import type { CompileOptions, CompileResult, CompileWarning } from './types.js';

/** High-level API: compile a .nx source string end-to-end.
 *  Runs the security guard automatically and includes its findings in warnings.
 */
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

  // Run security guard and merge findings as structured warnings
  const guardResult = guard(source, filepath);
  const guardWarnings: CompileWarning[] = guardResult.leaks.map((leak) => ({
    code: `NX-GUARD-${leak.type.toUpperCase()}`,
    severity: leak.severity,
    message: leak.message,
    hint: leak.hint,
    loc: { line: leak.line, column: leak.column },
  }));

  const result = generate(parsed, options);

  // Merge parser warnings + guard warnings, deduplicate by message+line
  const seen = new Set<string>();
  const allWarnings = [...parsed.warnings, ...guardWarnings, ...result.warnings].filter((w) => {
    const key = `${w.message}:${w.loc?.line ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ...result, warnings: allWarnings };
}

import type { CompileError, CompileWarning, SourceLocation } from './types.js';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/** Extract a source snippet around a given line for framing. */
export function extractFrame(source: string, loc: SourceLocation, padding = 2): string {
  const lines = source.split('\n');
  const start = Math.max(0, loc.line - 1 - padding);
  const end = Math.min(lines.length, loc.line + padding);
  const out: string[] = [];
  const gutterWidth = String(end).length;

  for (let i = start; i < end; i++) {
    const lineNum = i + 1;
    const isTarget = lineNum === loc.line;
    const gutter = `${isTarget ? c.red : c.gray}${String(lineNum).padStart(gutterWidth)}${c.reset}`;
    out.push(`  ${gutter} ${c.dim}|${c.reset} ${lines[i] ?? ''}`);
    if (isTarget) {
      const caret = ' '.repeat(loc.column) + c.red + '^' + c.reset;
      out.push(`  ${' '.repeat(gutterWidth)} ${c.dim}|${c.reset} ${caret}`);
    }
  }
  return out.join('\n');
}

/** Pretty-print a CompileError for terminal output. */
export function formatCompileError(err: CompileError, source?: string): string {
  const lines: string[] = [
    `  ${c.red}${c.bold}✖ ${err.code}${c.reset}  ${err.message}`,
    `  ${c.gray}${err.file}${err.loc ? `:${err.loc.line}:${err.loc.column}` : ''}${c.reset}`,
  ];

  if (err.frame) {
    lines.push('', err.frame);
  } else if (source && err.loc) {
    lines.push('', extractFrame(source, err.loc));
  }

  if (err.hint) {
    lines.push('', `  ${c.cyan}Hint: ${err.hint}${c.reset}`);
  }

  return lines.join('\n');
}

/** Pretty-print a CompileWarning for terminal output. */
export function formatCompileWarning(warn: CompileWarning, file: string, source?: string): string {
  const isError = warn.severity === 'error';
  const color = isError ? c.red : c.yellow;
  const prefix = isError ? '✖' : '⚠';
  const lines: string[] = [
    `  ${color}${prefix} ${warn.code ?? 'NX-WARN'}${c.reset}  ${warn.message}`,
    `  ${c.gray}${file}${warn.loc ? `:${warn.loc.line}:${warn.loc.column}` : ''}${c.reset}`,
  ];

  if (source && warn.loc) {
    lines.push('', extractFrame(source, warn.loc, 1));
  }

  if (warn.hint) {
    lines.push(`  ${c.cyan}Hint: ${warn.hint}${c.reset}`);
  }

  return lines.join('\n');
}

/** Format an array of warnings into a single string. */
export function formatWarnings(warnings: CompileWarning[], file: string, source?: string): string {
  return warnings.map((w) => formatCompileWarning(w, file, source)).join('\n\n');
}

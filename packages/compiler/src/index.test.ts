import { describe, it, expect } from 'vitest';
import { compile, formatCompileError, formatCompileWarning, extractFrame, offsetToLineColumn } from './index.js';
import { CompileError } from './types.js';

describe('compile() integration', () => {
  it('returns compiled result for valid .nx', () => {
    const source = `---\nconst title = 'Hello';\n---\n<h1>{title}</h1>`;
    const result = compile(source, 'src/routes/+page.nx');
    expect(result.serverCode).toContain('export async function render(ctx)');
    expect(result.css).toBeNull();
  });

  it('includes parser warnings with line:col locations', () => {
    const source = `---\nconst x = createAction(async () => {})\n---\n<p>hi</p>`;
    const result = compile(source, 'src/routes/+page.nx');
    const warn = result.warnings.find((w) => w.code === 'NX-001');
    expect(warn).toBeDefined();
    expect(warn!.message).toContain('use server');
    expect(warn!.loc).toBeDefined();
    expect(warn!.loc!.line).toBeGreaterThanOrEqual(1);
  });

  it('includes guard warnings for secrets in client scripts', () => {
    const source = `<script>\n  const key = process.env.API_KEY;\n</script>\n<p>hi</p>`;
    const result = compile(source, 'src/routes/+page.nx');
    const guardWarn = result.warnings.find((w) => w.code?.startsWith('NX-GUARD'));
    expect(guardWarn).toBeDefined();
    expect(guardWarn!.severity).toBe('error');
    expect(guardWarn!.loc).toBeDefined();
  });

  it('deduplicates overlapping warnings', () => {
    const source = `<script>\n  const key = process.env.API_KEY;\n</script>\n<p>hi</p>`;
    const result = compile(source, 'src/routes/+page.nx');
    const codes = result.warnings.map((w) => `${w.code}:${w.loc?.line ?? 0}`);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('throws CompileError for unclosed {#if}', () => {
    const source = `{#if true}\n  <p>hello</p>`;
    expect(() => compile(source, 'src/routes/+page.nx')).toThrow(CompileError);
    try {
      compile(source, 'src/routes/+page.nx');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError);
      expect((err as CompileError).code).toBe('NX-101');
      expect((err as CompileError).file).toBe('src/routes/+page.nx');
      expect((err as CompileError).loc).toBeDefined();
      expect((err as CompileError).hint).toContain('matching');
    }
  });

  it('throws CompileError for unclosed {#each}', () => {
    const source = `{#each items as item}\n  <p>{item}</p>`;
    expect(() => compile(source, 'src/routes/+page.nx')).toThrow(CompileError);
    try {
      compile(source, 'src/routes/+page.nx');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError);
      expect((err as CompileError).code).toBe('NX-104');
    }
  });

  it('throws CompileError for malformed {#each} syntax', () => {
    const source = `{#each items}\n  <p>no alias</p>\n{/each}`;
    expect(() => compile(source, 'src/routes/+page.nx')).toThrow(CompileError);
    try {
      compile(source, 'src/routes/+page.nx');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError);
      expect((err as CompileError).code).toBe('NX-103');
      expect((err as CompileError).hint).toContain('as item');
    }
  });
});

describe('offsetToLineColumn', () => {
  it('returns line 1 col 0 for offset 0', () => {
    expect(offsetToLineColumn('abc', 0)).toEqual({ line: 1, column: 0 });
  });

  it('counts newlines correctly', () => {
    const source = 'line1\nline2\nline3';
    expect(offsetToLineColumn(source, 6)).toEqual({ line: 2, column: 0 });
    expect(offsetToLineColumn(source, 12)).toEqual({ line: 3, column: 0 });
  });

  it('handles empty string', () => {
    expect(offsetToLineColumn('', 0)).toEqual({ line: 1, column: 0 });
  });
});

describe('extractFrame', () => {
  it('shows source snippet with caret', () => {
    const source = 'line1\nline2\nline3';
    const frame = extractFrame(source, { line: 2, column: 1 }, 1);
    expect(frame).toContain('line2');
    expect(frame).toContain('^');
  });
});

describe('formatCompileError', () => {
  it('includes code, message, file, and hint', () => {
    const err = new CompileError({
      code: 'NX-999',
      message: 'Something broke',
      file: 'src/routes/+page.nx',
      loc: { line: 5, column: 10 },
      hint: 'Try fixing it',
    });
    const formatted = formatCompileError(err);
    expect(formatted).toContain('NX-999');
    expect(formatted).toContain('Something broke');
    expect(formatted).toContain('src/routes/+page.nx:5:10');
    expect(formatted).toContain('Try fixing it');
    // ANSI colors for DX
    expect(formatted).toMatch(/\x1b\[[0-9;]*m/);
  });
});

describe('compile() with external islands', () => {
  it('preserves external island markup and emits correct data-nexus-component', () => {
    const source = `<nexus-island client:load src="$lib/islands/menu.ts"><button>Menu</button></nexus-island>`;
    const result = compile(source, 'src/routes/+page.nx', { appRoot: '/app' });
    expect(result.serverCode).toContain('data-nexus-component="/_nexus/external-island?path=src%2Flib%2Fislands%2Fmenu.ts"');
    expect(result.serverCode).toContain('<button>Menu</button>');
    expect(result.serverCode).not.toMatch(/<nexus-island[^>]*\sclient:load/);
  });
});

describe('formatCompileWarning', () => {
  it('formats warnings with source frame', () => {
    const warn = {
      code: 'NX-WARN',
      severity: 'warning' as const,
      message: 'Deprecated pattern',
      loc: { line: 2, column: 0 },
      hint: 'Use new syntax',
    };
    const source = 'line1\nold\nline3';
    const formatted = formatCompileWarning(warn, 'src/routes/+page.nx', source);
    expect(formatted).toContain('Deprecated pattern');
    expect(formatted).toContain('Use new syntax');
    expect(formatted).toContain('old');
    // ANSI colors
    expect(formatted).toMatch(/\x1b\[[0-9;]*m/);
  });
});

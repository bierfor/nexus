import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadContent } from './load-content.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

describe('loadContent', () => {
  const testDir = join(cwd(), 'src/content/test-fixtures-loadcontent');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'hello.md'),
      '---\ntitle: Hello\n---\n\n# Hello World\n\nThis is a test.'
    );
    writeFileSync(
      join(testDir, 'hello.es.md'),
      '---\ntitle: Hola\n---\n\n# Hola Mundo\n\nEsto es una prueba.'
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('loads default markdown file', () => {
    const entry = loadContent('test-fixtures-loadcontent/hello', { contentDir: 'src/content' });
    expect(entry.html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(entry.meta.title).toBe('Hello');
    expect(entry.locale).toBe('en');
  });

  it('loads localized markdown file', () => {
    const entry = loadContent('test-fixtures-loadcontent/hello', { locale: 'es', contentDir: 'src/content' });
    expect(entry.html).toContain('<h1 id="hola-mundo">Hola Mundo</h1>');
    expect(entry.meta.title).toBe('Hola');
    expect(entry.locale).toBe('es');
  });

  it('falls back to default when locale missing', () => {
    const entry = loadContent('test-fixtures-loadcontent/hello', { locale: 'pt', contentDir: 'src/content' });
    expect(entry.html).toContain('Hello World');
    expect(entry.locale).toBe('pt');
  });

  it('returns not-found placeholder for missing file', () => {
    const entry = loadContent('test-fixtures-loadcontent/missing', { contentDir: 'src/content' });
    expect(entry.html).toContain('Content not found');
  });

  it('includes raw when requested', () => {
    const entry = loadContent('test-fixtures-loadcontent/hello', { contentDir: 'src/content', includeRaw: true });
    expect(entry.raw).toContain('---');
    expect(entry.raw).toContain('Hello World');
  });

  it('extracts headings', () => {
    const entry = loadContent('test-fixtures-loadcontent/hello', { contentDir: 'src/content' });
    expect(entry.headings).toEqual([{ level: 1, text: 'Hello World', id: 'hello-world' }]);
  });
});

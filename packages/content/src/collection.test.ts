import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { defineCollection } from './collection.js';

describe('defineCollection', () => {
  const testDir = 'src/content/test-collection';
  const testPath = join(cwd(), testDir);

  beforeAll(() => {
    mkdirSync(testPath, { recursive: true });
    writeFileSync(
      join(testPath, 'first.md'),
      '---\ntitle: First\norder: 2\n---\n\n# First Post'
    );
    writeFileSync(
      join(testPath, 'second.md'),
      '---\ntitle: Second\norder: 1\n---\n\n# Second Post'
    );
    writeFileSync(
      join(testPath, 'second.es.md'),
      '---\ntitle: Segundo\norder: 1\n---\n\n# Segundo Post'
    );
    writeFileSync(
      join(testPath, 'draft.md'),
      '---\ntitle: Draft\norder: 3\ndraft: true\n---\n\n# Draft'
    );
  });

  afterAll(() => {
    rmSync(testPath, { recursive: true, force: true });
  });

  const posts = defineCollection({
    name: 'posts',
    dir: testDir,
    defaultLocale: 'en',
    locales: ['en', 'es'],
  });

  it('get() loads a single item', () => {
    const item = posts.get('first');
    expect(item.slug).toBe('first');
    expect(item.html).toContain('<h1 id="first-post">First Post</h1>');
    expect(item.meta.title).toBe('First');
  });

  it('list() discovers all base slugs (excluding locale suffixes)', () => {
    const items = posts.list();
    const slugs = items.map((i) => i.slug);
    expect(slugs).toEqual(['draft', 'first', 'second']);
  });

  it('list() supports locale', () => {
    const items = posts.list({ locale: 'es' });
    const second = items.find((i) => i.slug === 'second');
    expect(second?.html).toContain('Segundo');
    expect(second?.meta.title).toBe('Segundo');
  });

  it('list() supports filter', () => {
    const items = posts.list({ filter: (i) => !i.meta.draft });
    const slugs = items.map((i) => i.slug);
    expect(slugs).toEqual(['first', 'second']);
    expect(slugs).not.toContain('draft');
  });

  it('list() supports sortBy (numeric)', () => {
    const items = posts.list({ sortBy: 'order' });
    const slugs = items.map((i) => i.slug);
    expect(slugs).toEqual(['second', 'first', 'draft']);
  });

  it('list() supports sortDesc', () => {
    const items = posts.list({ sortBy: 'order', sortDesc: true });
    const slugs = items.map((i) => i.slug);
    expect(slugs).toEqual(['draft', 'first', 'second']);
  });
});

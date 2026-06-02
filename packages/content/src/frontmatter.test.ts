import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter', () => {
    const md = `---\ntitle: Hello\norder: 3\ndraft: true\n---\n\nBody here`;
    const { meta, body } = parseFrontmatter(md);
    expect(meta).toEqual({ title: 'Hello', order: 3, draft: true });
    expect(body).toBe('Body here');
  });

  it('returns empty meta when no frontmatter', () => {
    const md = 'Just body';
    const { meta, body } = parseFrontmatter(md);
    expect(meta).toEqual({});
    expect(body).toBe('Just body');
  });

  it('parses quoted strings', () => {
    const md = `---\ntitle: "Hello World"\n---\n\nBody`;
    const { meta } = parseFrontmatter(md);
    expect(meta.title).toBe('Hello World');
  });

  it('parses arrays', () => {
    const md = `---\ntags: [a, b, c]\n---\n\nBody`;
    const { meta } = parseFrontmatter(md);
    expect(meta.tags).toEqual(['a', 'b', 'c']);
  });
});

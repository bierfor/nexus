import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render.js';

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', () => {
    const { html } = renderMarkdown('# Hello\n\nWorld');
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).toContain('<p>World</p>');
  });

  it('extracts headings for TOC', () => {
    const { headings } = renderMarkdown('## First\n\n### Second\n\n## Third');
    expect(headings).toEqual([
      { level: 2, text: 'First', id: 'first' },
      { level: 3, text: 'Second', id: 'second' },
      { level: 2, text: 'Third', id: 'third' },
    ]);
  });

  it('renders code blocks with language class', () => {
    const { html } = renderMarkdown('```ts\nconst x = 1;\n```');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const x = 1;');
  });

  it('renders inline code', () => {
    const { html } = renderMarkdown('Use `npm install`');
    expect(html).toContain('<code>npm install</code>');
  });

  it('renders links', () => {
    const { html } = renderMarkdown('[Nexus](https://nexusjs.dev)');
    expect(html).toContain('<a href="https://nexusjs.dev">Nexus</a>');
  });

  it('renders images', () => {
    const { html } = renderMarkdown('![Alt text](/img.png)');
    expect(html).toContain('<img src="/img.png" alt="Alt text" />');
  });

  it('sanitizes scripts by default', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('respects sanitize: false', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>', { sanitize: false });
    expect(html).toContain('<script>');
  });
});

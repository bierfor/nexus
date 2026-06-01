import { describe, expect, it } from 'vitest';
import { scopeCSS, scopeTemplate, componentHash } from './css-scope.js';

describe('componentHash', () => {
  it('produces a stable 6-char hex hash', () => {
    const h1 = componentHash('/src/routes/+layout.nx');
    const h2 = componentHash('/src/routes/+layout.nx');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe('scopeCSS', () => {
  it('scopes regular class selectors', () => {
    const result = scopeCSS('.card { color: red; }', '/src/test.nx');
    expect(result.css).toContain(`[data-nx="${result.hash}"] .card, [data-nx="${result.hash}"].card`);
    expect(result.css).toContain('color: red');
    expect(result.css).toContain('@layer nexus.scoped');
    expect(result.classes.has('card')).toBe(true);
  });

  it('does not scope :root', () => {
    const result = scopeCSS(':root { --x: 1; }', '/src/test.nx');
    expect(result.css).toContain(':root { --x: 1; }');
    expect(result.css).not.toContain(`[data-nx="${result.hash}"]:root`);
  });

  it('does not scope html, body, or *', () => {
    const result = scopeCSS('html { font-size: 16px; }\nbody { margin: 0; }\n* { box-sizing: border-box; }', '/src/test.nx');
    expect(result.css).toContain('html { font-size: 16px; }');
    expect(result.css).toContain('body { margin: 0; }');
    expect(result.css).toContain('* { box-sizing: border-box; }');
    expect(result.css).not.toContain(`[data-nx="${result.hash}"] html`);
    expect(result.css).not.toContain(`[data-nx="${result.hash}"] body`);
    expect(result.css).not.toContain(`[data-nx="${result.hash}"] *`);
  });

  it('passes through @import rules', () => {
    const result = scopeCSS("@import url('fonts.css');\n.card { color: red; }", '/src/test.nx');
    expect(result.css).toContain("@import url('fonts.css');");
    expect(result.css).toContain(`[data-nx="${result.hash}"] .card, [data-nx="${result.hash}"].card`);
  });

  it('passes through @charset and @namespace', () => {
    const result = scopeCSS('@charset "UTF-8";\n@namespace svg url(http://www.w3.org/2000/svg);\n.card {}', '/src/test.nx');
    expect(result.css).toContain('@charset "UTF-8";');
    expect(result.css).toContain('@namespace svg url(http://www.w3.org/2000/svg);');
  });

  it('unwraps full :global(...) selectors without scoping', () => {
    const result = scopeCSS(':global(.external) { color: blue; }', '/src/test.nx');
    expect(result.css).toContain('.external { color: blue; }');
    expect(result.css).not.toContain('[data-nx=');
  });

  it('unwraps partial :global(...) while scoping the rest', () => {
    const result = scopeCSS('.card :global(.external) { color: blue; }', '/src/test.nx');
    expect(result.css).toContain(`[data-nx="${result.hash}"] .card .external, [data-nx="${result.hash}"].card .external`);
    expect(result.css).not.toContain(':global(');
  });

  it('does not scope @keyframes', () => {
    const result = scopeCSS('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }', '/src/test.nx');
    expect(result.css).toContain('@keyframes fade {');
    expect(result.css).not.toContain('[data-nx=');
  });

  it('scopes inside @media', () => {
    const result = scopeCSS('@media (max-width: 600px) { .card { color: red; } }', '/src/test.nx');
    expect(result.css).toContain('@media (max-width: 600px) {');
    expect(result.css).toContain(`[data-nx="${result.hash}"] .card`);
  });
});

describe('scopeTemplate', () => {
  it('injects data-nx into root elements', () => {
    const html = '<div class="card">Hello</div>';
    const out = scopeTemplate(html, 'a1b2c3');
    expect(out).toContain('data-nx="a1b2c3"');
  });

  it('skips html, head, body but scopes inner elements', () => {
    const html = '<html><head></head><body><div>Hello</div></body></html>';
    const out = scopeTemplate(html, 'a1b2c3');
    expect(out).not.toContain('<html data-nx=');
    expect(out).not.toContain('<body data-nx=');
    expect(out).toContain('<div data-nx="a1b2c3">Hello</div>');
  });

  it('handles self-closing tags', () => {
    const html = '<img src="x.jpg" />';
    const out = scopeTemplate(html, 'a1b2c3');
    expect(out).toContain('data-nx="a1b2c3"');
  });
});

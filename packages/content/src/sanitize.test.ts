import { describe, it, expect } from 'vitest';
import { sanitizeHTML } from './sanitize.js';

describe('sanitizeHTML', () => {
  it('strips script tags', () => {
    const input = '<p>Hello</p><script>alert(1)</script>';
    expect(sanitizeHTML(input)).toBe('<p>Hello</p>');
  });

  it('strips self-closing script tags', () => {
    const input = '<script src="evil.js" />';
    expect(sanitizeHTML(input)).toBe('');
  });

  it('strips event handlers', () => {
    const input = '<a href="/" onclick="alert(1)">Link</a>';
    const out = sanitizeHTML(input);
    expect(out).toContain('<a href="/">');
    expect(out).not.toContain('onclick');
  });

  it('strips javascript: URLs', () => {
    const input = '<a href="javascript:alert(1)">Click</a>';
    const out = sanitizeHTML(input);
    expect(out).not.toContain('javascript:');
  });

  it('strips data: URLs in src', () => {
    const input = '<img src="data:text/html,<script>alert(1)</script>" />';
    const out = sanitizeHTML(input);
    expect(out).not.toContain('data:');
  });

  it('allows safe tags in strict mode', () => {
    const input = '<h1 id="title">Title</h1><p>Text</p>';
    expect(sanitizeHTML(input)).toBe('<h1 id="title">Title</h1><p>Text</p>');
  });

  it('removes disallowed tags in strict mode', () => {
    const input = '<iframe src="evil.com"></iframe>';
    expect(sanitizeHTML(input)).toBe('');
  });

  it('injects CSP nonce into style tags', () => {
    const input = '<style>.red{color:red}</style>';
    const out = sanitizeHTML(input, { cspNonce: 'abc123' });
    expect(out).toContain('nonce="abc123"');
  });

  it('resolves relative URLs with baseUrl', () => {
    const input = '<a href="/docs">Docs</a>';
    const out = sanitizeHTML(input, { baseUrl: 'https://nexusjs.dev' });
    expect(out).toContain('href="https://nexusjs.dev/docs"');
  });

  it('does not alter absolute URLs', () => {
    const input = '<a href="https://example.com">Link</a>';
    expect(sanitizeHTML(input)).toContain('href="https://example.com"');
  });
});

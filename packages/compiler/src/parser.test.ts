import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';

describe('parse', () => {
  it('parses a basic .nx file', () => {
    const source = `---
const x = 1;
---

<script>
let count = 0;
</script>

<h1>Hello</h1>

<style>
h1 { color: red; }
</style>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.frontmatter?.content).toContain('const x = 1;');
    expect(result.script?.content).toContain('let count = 0;');
    expect(result.style?.content).toContain('h1 { color: red; }');
    expect(result.template!.content).toContain('<h1>Hello</h1>');
    expect(result.template!.content).not.toContain('<script>');
    expect(result.template!.content).not.toContain('<style>');
  });

  it('parses multiple <script> blocks', () => {
    const source = `<script>
let a = 1;
</script>

<div>A</div>

<script>
let b = 2;
</script>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.script?.content).toContain('let a = 1;');
    expect(result.script?.content).toContain('let b = 2;');
  });

  it('parses multiple <style> blocks', () => {
    const source = `<style>
.a { color: red; }
</style>

<div>A</div>

<style>
.b { color: blue; }
</style>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.style?.content).toContain('.a { color: red; }');
    expect(result.style?.content).toContain('.b { color: blue; }');
  });

  it('parses <style> without a leading newline', () => {
    const source = `<style>.x { color: red; }</style>
<div>Hello</div>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.style?.content).toContain('.x { color: red; }');
  });

  it('parses <script> without a leading newline', () => {
    const source = `<script>let x = 1;</script>
<div>Hello</div>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.script?.content).toContain('let x = 1;');
  });

  it('removes all script and style blocks from template', () => {
    const source = `<script>let a = 1;</script>
<div>A</div>
<style>.a {}</style>
<script>let b = 2;</script>
<div>B</div>
<style>.b {}</style>
`;
    const result = parse(source, '/src/test.nx');
    expect(result.template!.content).toContain('<div>A</div>');
    expect(result.template!.content).toContain('<div>B</div>');
    expect(result.template!.content).not.toContain('<script>');
    expect(result.template!.content).not.toContain('<style>');
  });
});

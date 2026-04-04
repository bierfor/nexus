import { describe, expect, it } from 'vitest';
import { compile } from './index.js';

/** Minimal .nx with client:visible island + runes — regression guard for island client bundle shape. */
const FIXTURE = `---
const title = "t";
---
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>
<div class="wrap" client:visible>
  <button id="c-btn" type="button" onclick={() => count++}>+</button>
  <span class="v">{count}</span>
  <span class="d">×2 = {doubled}</span>
</div>
`;

describe('client island codegen', () => {
  it('server renderTemplate exposes pretext and $pretext for SSR parity with client', () => {
    const r = compile(
      `---
const x = 1;
---
<p>{x}</p>`,
      '/app/src/routes/+page.nx',
      {
        mode: 'server',
        dev: true,
        ssr: true,
        emitIslandManifest: false,
        target: 'node',
        appRoot: '/app',
      },
    );
    expect(r.serverCode).toContain('const pretext = ctx.pretext ?? {}');
    expect(r.serverCode).toContain('const $pretext = () => (ctx.pretext ?? {});');
  });

  it('emits processedTemplate placeholders, expr fns with .value, and delegated click', () => {
    const r = compile(FIXTURE, '/app/src/routes/+page.nx', {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: '/app',
    });
    expect(r.clientCode).toBeTruthy();
    const c = r.clientCode!;
    expect(c).toContain("$pretext } from '/_nexus/rt/island.js'");
    expect(c).toContain('processedTemplate');
    expect(c).toContain('__NX_0__');
    expect(c).toContain('__NX_1__');
    expect(c).toContain('() => (count.value)');
    expect(c).toContain('() => (doubled.value)');
    expect(c).toContain('$derived(() => (count.value * 2))');
    expect(c).toContain('delegatedClickSelector');
    expect(c).toContain('#c-btn');
    expect(c).toContain('count.value++');
  });
});

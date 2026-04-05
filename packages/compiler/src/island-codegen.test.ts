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

  it('emits delegated submit on island root when form has data-nexus-submit', () => {
    const src = `---
---
<script>
  async function submitRegister() {}
</script>
<div client:load>
  <form id="fin-auth-register-form" data-nexus-submit="submitRegister">
    <button type="submit">Go</button>
  </form>
</div>
`;
    const r = compile(src, '/app/src/routes/register/+page.nx', {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: '/app',
    });
    expect(r.clientCode).toBeTruthy();
    const c = r.clientCode!;
    expect(c).toContain('__nxDelegatedSubmit');
    expect(c).toContain('delegatedSubmitFormId');
    expect(c).toContain('fin-auth-register-form');
    expect(c).toContain('void submitRegister()');
  });

  it('rewrites $state assignments in handlers to .value (const-safe)', () => {
    const src = `---
---
<script>
  let err = $state('');
  async function submitRegister() {
    err = '';
    err = 'x';
  }
</script>
<div client:load><form id="f" data-nexus-submit="submitRegister"><button type="submit">x</button></form></div>
`;
    const r = compile(src, '/app/src/routes/register/+page.nx', {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: '/app',
    });
    expect(r.clientCode).toBeTruthy();
    const c = r.clientCode!;
    expect(c).toContain('err.value =');
    expect(c).not.toMatch(/[^.]err = ''/); // not plain `err = ''` (would reassign const)
  });

  it('warns when client:* island fragment uses {#if} or bind:', () => {
    const bad = `---
---
<script>
  let x = $state(0);
</script>
<div client:load>
  {#if x}
    <p>y</p>
  {/if}
  <input bind:value={x} />
</div>
`;
    const r = compile(bad, '/app/src/routes/bad/+page.nx', {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: '/app',
    });
    const msgs = r.warnings.map((w) => w.message).join(' ');
    expect(msgs).toMatch(/\{#if\} inside client/);
    expect(msgs).toMatch(/bind: inside client/);
  });

  it('extracts createAction from nexus:pretext and emits static /_nexus/action/ form URL', () => {
    const src = `---
import { createAction } from '@nexus_js/server';
// nexus:pretext
export async function load(ctx) {
  return {};
}
const myAction = createAction(async () => ({}), { csrf: false });
---
<template>
  <form action={myAction} method="post">
    <button type="submit">Go</button>
  </form>
</template>
`;
    const r = compile(src, '/app/src/routes/p/+page.nx', {
      mode: 'server',
      dev: true,
      ssr: true,
      emitIslandManifest: false,
      target: 'node',
      appRoot: '/app',
    });
    expect(r.serverCode).toContain('/_nexus/action/myAction');
    expect(r.serverCode).not.toContain('__ssrAttr(myAction)');
  });
});

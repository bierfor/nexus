import { describe, it, expect } from 'vitest';
import { createStreamingResponse, createSuspenseBoundary } from './streaming.js';

async function responseText(res: Response): Promise<string> {
  return new Response(res.body).text();
}

describe('createStreamingResponse', () => {
  it('injects stream bootstrap in head and streams deferred fill + complete', async () => {
    const res = createStreamingResponse(async (ctrl) => {
      ctrl.writeShell(
        '<!DOCTYPE html><html><head><title>t</title></head><body><div id="nx-hole-abc">wait</div></body></html>',
      );
      ctrl.defer({
        id: 'abc',
        promise: Promise.resolve('<main>ready</main>'),
      });
    });

    const text = await responseText(res);
    expect(text).toContain('__nx_stream_boot__');
    expect(text).toContain('__nx_fill');
    expect(text).toContain('nx-fill-abc');
    expect(text).toContain('<main>ready</main>');
    expect(text).toContain('nexus:stream-chunk');
    expect(text).toContain('__nx_stream_complete');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('emits pretext update script before fill when payload has pretextWire', async () => {
    const wire = '{"__t":"Undef"}';
    const res = createStreamingResponse(async (ctrl) => {
      ctrl.writeShell(
        '<html><head><script type="application/json" id="__NEXUS_PRETEXT__">{}</script></head><body><div id="nx-hole-z"></div></body></html>',
      );
      ctrl.defer({
        id: 'z',
        promise: Promise.resolve({ html: '<p>x</p>', pretextWire: wire }),
      });
    });
    const text = await responseText(res);
    expect(text).toContain('__NEXUS_PRETEXT__');
    expect(text).toContain('el.textContent=');
    expect(text).toContain('nx-fill-z');
  });

  it('writes error fill when deferred promise rejects', async () => {
    const res = createStreamingResponse(async (ctrl) => {
      ctrl.writeShell('<html><head></head><body><div id="nx-hole-e"></div></body></html>');
      ctrl.defer({
        id: 'e',
        promise: Promise.reject(new Error('boundary failed')),
      });
    });
    const text = await responseText(res);
    expect(text).toContain('boundary failed');
    expect(text).toContain('__nx_fill("e")');
  });
});

describe('createSuspenseBoundary', () => {
  it('returns placeholder template and resolves render output', async () => {
    const { placeholder, boundary } = createSuspenseBoundary(Promise.resolve({ n: 42 }), {
      render: (v) => `<span>${v.n}</span>`,
    });
    expect(placeholder).toContain('nx-hole-');
    expect(placeholder).toContain('<template id="nx-hole-');
    const html = await boundary.promise;
    expect(html).toBe('<span>42</span>');
  });
});

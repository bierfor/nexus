/**
 * Rich HTML error pages for `dev` mode (stack, Error.cause chain, non-Error serialization).
 */

const DOCTYPE = '<!DOCTYPE html>';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Message, stack, optional cause chain, and JSON for plain objects. */
export function collectErrorDetails(err: unknown): {
  message: string;
  stack: string;
  causes: string[];
  plain: string;
} {
  const causes: string[] = [];
  let stack = '';
  let message = '';

  if (err instanceof Error) {
    message = err.message;
    stack = err.stack ?? '';
    let cur: unknown = (err as Error & { cause?: unknown }).cause;
    let depth = 0;
    while (cur != null && depth < 10) {
      if (cur instanceof Error) {
        causes.push(`${cur.name}: ${cur.message}`);
        cur = (cur as Error & { cause?: unknown }).cause;
      } else {
        causes.push(String(cur));
        break;
      }
      depth++;
    }
  } else if (err !== null && typeof err === 'object') {
    try {
      message = JSON.stringify(err);
    } catch {
      message = String(err);
    }
  } else {
    message = String(err);
  }

  let plain = '';
  if (err !== null && typeof err === 'object' && !(err instanceof Error)) {
    try {
      plain = JSON.stringify(err, null, 2);
    } catch {
      plain = String(err);
    }
  }

  return { message, stack, causes, plain };
}

/**
 * Full diagnostic page in dev; minimal safe page when `dev` is false.
 */
export function devErrorHtmlPage(opts: { context: string; err: unknown; dev: boolean }): string {
  if (!opts.dev) {
    const msg = opts.err instanceof Error ? opts.err.message : String(opts.err);
    return (
      `${DOCTYPE}<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
      `<body style="font-family:system-ui,sans-serif;padding:2rem;background:#fafafa;color:#111">` +
      `<h1 style="font-size:1.25rem">Something went wrong</h1>` +
      `<p>${escapeHtml(msg)}</p>` +
      `</body></html>`
    );
  }

  const d = collectErrorDetails(opts.err);

  const causeBlock =
    d.causes.length > 0
      ? `<section style="margin:0 0 1rem">
    <h2 style="font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 0.5rem">Cause chain</h2>
    <ol style="margin:0;padding-left:1.2rem;color:#cbd5e1;font-size:0.85rem">${d.causes.map((c) => `<li style="margin:0.25rem 0">${escapeHtml(c)}</li>`).join('')}</ol>
  </section>`
      : '';

  const stackBlock = d.stack
    ? `<details open style="margin:0 0 1rem">
    <summary style="cursor:pointer;color:#64748b;font-size:0.85rem;font-weight:600">Stack trace</summary>
    <pre style="font-size:0.72rem;color:#94a3b8;overflow:auto;max-height:min(52vh,28rem);white-space:pre-wrap;line-height:1.4;margin:0.5rem 0 0;padding:0.75rem;background:#0d0d1a;border-radius:8px;border:1px solid #1e293b">${escapeHtml(d.stack)}</pre>
  </details>`
    : '';

  const plainBlock = d.plain
    ? `<details style="margin:0 0 1rem">
    <summary style="cursor:pointer;color:#64748b;font-size:0.85rem;font-weight:600">Serialized value</summary>
    <pre style="font-size:0.72rem;color:#94a3b8;overflow:auto;max-height:min(28vh,16rem);white-space:pre-wrap;margin:0.5rem 0 0;padding:0.75rem;background:#0d0d1a;border-radius:8px;border:1px solid #1e293b">${escapeHtml(d.plain)}</pre>
  </details>`
    : '';

  return `${DOCTYPE}<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexus — ${escapeHtml(opts.context)}</title>
</head>
<body style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;padding:1.25rem 1.5rem;max-width:56rem;margin:0 auto;background:#0a0a0f;color:#e8e8f0;line-height:1.45">
  <h1 style="margin:0 0 0.5rem;font-size:1.05rem;font-weight:600;color:#f87171">◆ Nexus — ${escapeHtml(opts.context)}</h1>
  <p style="color:#fca5a5;font-size:0.92rem;margin:0 0 1rem;white-space:pre-wrap;border-left:3px solid #f43f5e;padding-left:0.75rem">${escapeHtml(d.message)}</p>
  ${causeBlock}
  ${stackBlock}
  ${plainBlock}
  <p style="margin-top:1rem;font-size:0.72rem;color:#475569">Development mode: full diagnostics. Production responses omit stack traces.</p>
</body></html>`;
}

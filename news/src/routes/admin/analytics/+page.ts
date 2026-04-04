import type { NexusContext } from '@nexus_js/server/context';
import { adminCopy } from '../../../lib/admin-copy.ts';
import type { VisitEvent } from '../../../lib/visit-log.ts';
import { getRecentVisits } from '../../../lib/visit-log.ts';
import { getLocaleFromCtx } from '../../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  const t = adminCopy(getLocaleFromCtx(ctx));
  const initial = getRecentVisits(120);
  const rowsHtml = initial.map((r) => trFromEvent(r)).join('');

  const html = `
  <section class="pf-admin-page pf-admin-analytics">
    <header class="pf-admin-analytics-head">
      <div>
        <h1 class="pf-admin-h1">${escapeHtml(t.analyticsTitle)}</h1>
        <p class="pf-admin-lead">${escapeHtml(t.analyticsLead)}</p>
      </div>
      <span class="pf-admin-live" id="pf-live-badge">${escapeHtml(t.liveBadge)}</span>
    </header>
    <div class="pf-table-scroll">
      <table class="pf-admin-table" aria-label="${escapeAttr(t.analyticsTitle)}">
        <thead>
          <tr>
            <th>${escapeHtml(t.colTime)}</th>
            <th>${escapeHtml(t.colPath)}</th>
            <th>${escapeHtml(t.colHost)}</th>
            <th>${escapeHtml(t.colRef)}</th>
            <th>${escapeHtml(t.colUa)}</th>
            <th>${escapeHtml(t.colIp)}</th>
          </tr>
        </thead>
        <tbody id="pf-vi-body">${rowsHtml || emptyRow(t.emptyVisits)}</tbody>
      </table>
    </div>
  </section>
  <script>
  (function () {
    var tbody = document.getElementById('pf-vi-body');
    if (!tbody || typeof EventSource === 'undefined') return;
    var es = new EventSource('/_nexus/connect/pf-visits');
    es.addEventListener('message', function (ev) {
      try {
        var r = JSON.parse(ev.data);
        var empty = tbody.querySelector('.pf-empty');
        if (empty) empty.remove();
        tbody.insertAdjacentHTML('afterbegin', rowHtml(r));
        var max = 200;
        while (tbody.rows.length > max) tbody.deleteRow(tbody.rows.length - 1);
      } catch (e) {}
    });
    function rowHtml(r) {
      var ip = r.ip != null && r.ip !== '' ? esc(r.ip) : '—';
      return (
        '<tr><td class="pf-mono">' + timeFmt(r.ts) + '</td><td class="pf-path">' + esc(r.path) + '</td><td>' + esc(r.host) + '</td><td class="pf-muted">' + esc(r.referrer) + '</td><td class="pf-muted pf-ua">' + esc(r.ua) + '</td><td class="pf-mono">' + ip + '</td></tr>'
      );
    }
    function timeFmt(ts) {
      try { return new Date(ts).toLocaleString(undefined, { hour12: false }); } catch (e) { return String(ts); }
    }
    function esc(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  })();
  </script>
  <style>
    .pf-admin-analytics { max-width: 100%; }
    .pf-admin-analytics-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .pf-admin-h1 {
      margin: 0 0 0.35rem;
      font-family: var(--nx-display, 'Outfit', system-ui, sans-serif);
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.03em;
    }
    .pf-admin-lead {
      margin: 0;
      color: var(--nx-muted, #64748b);
      font-size: 0.95rem;
      max-width: 40rem;
    }
    .pf-admin-live {
      flex-shrink: 0;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.35rem 0.6rem;
      border-radius: 999px;
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }
    .pf-table-scroll {
      overflow: auto;
      max-height: min(70vh, 560px);
      border: 1px solid var(--nx-border, #e8ecf0);
      border-radius: 10px;
      background: var(--nx-surface, #fff);
    }
    .pf-admin-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .pf-admin-table th,
    .pf-admin-table td {
      padding: 0.45rem 0.65rem;
      text-align: left;
      border-bottom: 1px solid var(--nx-border, #e8ecf0);
      vertical-align: top;
    }
    .pf-admin-table th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      z-index: 1;
      font-weight: 600;
      color: var(--nx-muted, #64748b);
    }
    .pf-mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pf-path { word-break: break-all; max-width: 14rem; }
    .pf-muted { color: var(--nx-muted, #64748b); }
    .pf-ua { max-width: 12rem; word-break: break-all; }
    .pf-empty td { color: var(--nx-muted, #64748b); font-style: italic; }
  </style>`;

  return { html };
}

function trFromEvent(r: VisitEvent): string {
  const ip = r.ip && r.ip !== '' ? escapeHtml(r.ip) : '—';
  return `<tr>
    <td class="pf-mono">${escapeHtml(timeFmt(r.ts))}</td>
    <td class="pf-path">${escapeHtml(r.path)}</td>
    <td>${escapeHtml(r.host)}</td>
    <td class="pf-muted">${escapeHtml(r.referrer)}</td>
    <td class="pf-muted pf-ua">${escapeHtml(r.ua)}</td>
    <td class="pf-mono">${ip}</td>
  </tr>`;
}

function emptyRow(msg: string): string {
  return `<tr class="pf-empty"><td colspan="6">${escapeHtml(msg)}</td></tr>`;
}

function timeFmt(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { hour12: false });
  } catch {
    return String(ts);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

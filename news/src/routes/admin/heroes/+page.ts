import type { NexusContext } from '@nexus_js/server/context';
import { adminCopy } from '../../../lib/admin-copy.ts';
import { fetchHeroesAdminList } from '../../../lib/admin-gql.ts';
import { requireAdmin } from '../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../lib/i18n.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const t = adminCopy(getLocaleFromCtx(ctx));
  const rows = (await fetchHeroesAdminList(ctx)) ?? [];
  const newHref = pathWithLang(ctx, '/admin/heroes/new');

  const tableRows = rows
    .map((r) => {
      const editHref = pathWithLang(ctx, '/admin/heroes/' + encodeURIComponent(r.slug));
      const status = r.published ? t.heroStatusPub : t.heroStatusDraft;
      const updated = esc(
        new Date(r.updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      );
      return `<tr>
        <td><code>${esc(r.slug)}</code></td>
        <td><a href="${esc(editHref)}">${esc(r.headline)}</a></td>
        <td>${esc(status)}</td>
        <td>${updated}</td>
      </tr>`;
    })
    .join('');

  const empty = rows.length === 0 ? `<p class="pf-admin-muted">${esc(t.heroEmpty)}</p>` : '';

  const html = `
  <section class="pf-admin-page pf-admin-hero-list">
    <header class="pf-admin-head pf-admin-head--row">
      <h1 class="pf-admin-h1">${esc(t.heroListTitle)}</h1>
      <a class="pf-admin-btn" href="${esc(newHref)}">${esc(t.heroNew)}</a>
    </header>
    ${empty}
    ${
      rows.length > 0
        ? `<table class="pf-admin-table">
      <thead>
        <tr>
          <th>${esc(t.heroColSlug)}</th>
          <th>${esc(t.heroColHeadline)}</th>
          <th>${esc(t.heroColStatus)}</th>
          <th>${esc(t.heroColUpdated)}</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`
        : ''
    }
  </section>
  <style>
    .pf-admin-hero-list .pf-admin-head--row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .pf-admin-btn {
      display: inline-flex;
      align-items: center;
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      background: var(--nx-accent, #0f172a);
      color: #fff;
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .pf-admin-btn:hover { opacity: 0.92; }
    .pf-admin-muted { color: var(--nx-muted, #64748b); margin: 0 0 1rem; }
    .pf-admin-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .pf-admin-table th,
    .pf-admin-table td {
      text-align: left;
      padding: 0.5rem 0.65rem;
      border-bottom: 1px solid var(--nx-border, #e8ecf0);
    }
    .pf-admin-table th { color: var(--nx-muted, #64748b); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .pf-admin-table a { color: var(--nx-accent-soft, #2563eb); text-decoration: none; }
    .pf-admin-table a:hover { text-decoration: underline; }
    .pf-admin-table code { font-size: 0.8rem; }
  </style>`;

  return { html };
}

import type { NexusContext } from '@nexus_js/server/context';
import { adminCopy } from '../../lib/admin-copy.ts';
import {
  fetchAdminDashboardStats,
  fetchArticlesAdminList,
  fetchAuthorsTagsForAdmin,
  fetchFlashNewsAdminList,
  fetchHeroesAdminList,
} from '../../lib/admin-gql.ts';
import { jsonScriptPayload } from '../../lib/admin-article-ssr.ts';
import { getLocaleFromCtx, pathWithLang } from '../../lib/i18n.ts';
import type { AdminAuthorOption, AdminTagOption } from '../../lib/admin-gql.ts';

/** HTML-escape; tolerates null/undefined from CMS or i18n gaps (never throws). */
function esc(s: string | number | undefined | null): string {
  const t = s == null ? '' : String(s);
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateErr(s: string | undefined | null, max = 480): string {
  if (s == null || typeof s !== 'string') return '';
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export async function render(ctx: NexusContext) {
  const loc = getLocaleFromCtx(ctx);
  const t = adminCopy(loc);

  const [dashLoad, articles, flashes, heroes, metaBundle] = await Promise.all([
    fetchAdminDashboardStats(ctx),
    fetchArticlesAdminList(ctx),
    fetchFlashNewsAdminList(ctx),
    fetchHeroesAdminList(ctx),
    fetchAuthorsTagsForAdmin(ctx),
  ]);

  const stats = dashLoad.stats;
  const dashError = dashLoad.error;

  const a = articles ?? [];
  const f = flashes ?? [];
  const h = heroes ?? [];
  const tagList: AdminTagOption[] = metaBundle
    ? [...metaBundle.tags].sort((x, y) => x.name.localeCompare(y.name))
    : [];
  const authorList: AdminAuthorOption[] = metaBundle
    ? [...metaBundle.authors].sort((x, y) => x.name.localeCompare(y.name))
    : [];

  const cards = stats
    ? `
    <ul class="pf-admin-kpis">
      <li class="pf-admin-kpi"><span class="pf-admin-kpi__v">${stats.articlesPublished}</span><span class="pf-admin-kpi__l">${esc(t.kpiArticlesPub)}</span><span class="pf-admin-kpi__s"> / ${stats.articlesTotal} ${esc(t.kpiTotal)}</span></li>
      <li class="pf-admin-kpi"><span class="pf-admin-kpi__v">${stats.flashPublished}</span><span class="pf-admin-kpi__l">${esc(t.kpiFlashPub)}</span><span class="pf-admin-kpi__s"> / ${stats.flashTotal} ${esc(t.kpiTotal)}</span></li>
      <li class="pf-admin-kpi"><span class="pf-admin-kpi__v">${stats.heroes}</span><span class="pf-admin-kpi__l">${esc(t.kpiHeroes)}</span></li>
      <li class="pf-admin-kpi"><span class="pf-admin-kpi__v">${stats.tags}</span><span class="pf-admin-kpi__l">${esc(t.kpiTags)}</span></li>
      <li class="pf-admin-kpi"><span class="pf-admin-kpi__v">${stats.authors}</span><span class="pf-admin-kpi__l">${esc(t.kpiAuthors)}</span></li>
    </ul>`
    : `<div class="pf-admin-warn-wrap">
    <p class="pf-admin-warn">${esc(t.dashUnavailable)}</p>
    ${
      dashError
        ? `<p class="pf-admin-err-meta">${esc(t.dashUnavailableErrorLabel)}</p><pre class="pf-admin-err-pre" role="status">${esc(truncateErr(dashError))}</pre>`
        : ''
    }
    <p class="pf-admin-steps-title">${esc(t.dashUnavailableStepsTitle)}</p>
    <ul class="pf-admin-steps">
      <li>${esc(t.dashStepSecret)}</li>
      <li>${esc(t.dashStepBackend)}</li>
      <li>${esc(t.dashStepUrl)}</li>
    </ul>
  </div>`;

  const leadHtml = stats ? `<p class="pf-admin-lead">${esc(t.dashLeadOk)}</p>` : '';

  const hrefArticles = pathWithLang(ctx, '/admin/articles');
  const hrefFlashes = pathWithLang(ctx, '/admin/flashes');
  const hrefHeroes = pathWithLang(ctx, '/admin/heroes');
  const hrefArticleNew = pathWithLang(ctx, '/admin/articles/new');
  const hrefFlashNew = pathWithLang(ctx, '/admin/flashes/new');
  const hrefHeroNew = pathWithLang(ctx, '/admin/heroes/new');

  const fmtDate = (iso: string | undefined | null) => {
    if (iso == null || String(iso).trim() === '') return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return esc(
      d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    );
  };

  const articleRows = a
    .map((r) => {
      const editHref = pathWithLang(ctx, '/admin/articles/' + encodeURIComponent(r.id));
      const status = r.published ? t.articleStatusPub : t.articleStatusDraft;
      return `<tr>
        <td><a href="${esc(editHref)}">${esc(r.title)}</a></td>
        <td><code>${esc(r.slug)}</code></td>
        <td>${esc(status)}</td>
        <td>${fmtDate(r.updatedAt)}</td>
        <td class="pf-admin-dash-actions">
          <a class="pf-admin-dash-edit" href="${esc(editHref)}">${esc(t.dashEdit)}</a>
          <button type="button" class="pf-admin-btn pf-admin-btn--sm pf-admin-btn--danger" data-pf-dash-del="article" data-id="${esc(r.id)}">${esc(t.dashDelete)}</button>
        </td>
      </tr>`;
    })
    .join('');

  const flashRows = f
    .map((r) => {
      const editHref = pathWithLang(ctx, '/admin/flashes/' + encodeURIComponent(r.id));
      const status = r.published ? t.flashStatusPub : t.flashStatusDraft;
      return `<tr>
        <td><a href="${esc(editHref)}">${esc(r.title)}</a></td>
        <td><code>${esc(r.slug)}</code></td>
        <td>${esc(status)}</td>
        <td>${fmtDate(r.updatedAt)}</td>
        <td class="pf-admin-dash-actions">
          <a class="pf-admin-dash-edit" href="${esc(editHref)}">${esc(t.dashEdit)}</a>
          <button type="button" class="pf-admin-btn pf-admin-btn--sm pf-admin-btn--danger" data-pf-dash-del="flash" data-id="${esc(r.id)}">${esc(t.dashDelete)}</button>
        </td>
      </tr>`;
    })
    .join('');

  const heroRows = h
    .map((r) => {
      const editHref = pathWithLang(ctx, '/admin/heroes/' + encodeURIComponent(r.slug));
      const status = r.published ? t.heroStatusPub : t.heroStatusDraft;
      return `<tr>
        <td><code>${esc(r.slug)}</code></td>
        <td><a href="${esc(editHref)}">${esc(r.headline)}</a></td>
        <td>${esc(status)}</td>
        <td>${fmtDate(r.updatedAt)}</td>
        <td class="pf-admin-dash-actions">
          <a class="pf-admin-dash-edit" href="${esc(editHref)}">${esc(t.dashEdit)}</a>
          <button type="button" class="pf-admin-btn pf-admin-btn--sm pf-admin-btn--danger" data-pf-dash-del="hero" data-slug="${esc(r.slug)}">${esc(t.dashDelete)}</button>
        </td>
      </tr>`;
    })
    .join('');

  const tagRows = tagList
    .map((r: AdminTagOption) => {
      const publicHref = pathWithLang(ctx, '/tag/' + encodeURIComponent(r.slug));
      return `<tr>
        <td><a href="${esc(publicHref)}">${esc(r.name)}</a></td>
        <td><code>${esc(r.slug)}</code></td>
      </tr>`;
    })
    .join('');

  const authorRows = authorList
    .map((r: AdminAuthorOption) => {
      const publicHref = pathWithLang(ctx, '/author/' + encodeURIComponent(r.id));
      return `<tr>
        <td><a href="${esc(publicHref)}">${esc(r.name)}</a></td>
        <td><code>${esc(r.id)}</code></td>
      </tr>`;
    })
    .join('');

  const bootstrap = jsonScriptPayload({
    confirmArticle: t.articleFormDeleteConfirm,
    confirmFlash: t.flashFormDeleteConfirm,
    confirmHero: t.heroFormDeleteConfirm,
    errDelete: t.dashDeleteFail,
  });

  const ISLAND = `<nexus-island
  data-nexus-island="pf_admin_dash_delete"
  data-nexus-island-index="0"
  data-nexus-component="/_nexus/islands/client.mjs?path=src%2Fcomponents%2FAdminDashboardDelete.nx"
  data-nexus-strategy="client:load"
><span aria-hidden="true"></span></nexus-island>`;

  const tableHeadArticle = `<thead><tr>
    <th>${esc(t.articleColTitle)}</th>
    <th>${esc(t.articleColSlug)}</th>
    <th>${esc(t.articleColStatus)}</th>
    <th>${esc(t.articleColUpdated)}</th>
    <th>${esc(t.dashColActions)}</th>
  </tr></thead>`;

  const tableHeadFlash = `<thead><tr>
    <th>${esc(t.flashColTitle)}</th>
    <th>${esc(t.flashColSlug)}</th>
    <th>${esc(t.flashColStatus)}</th>
    <th>${esc(t.flashColUpdated)}</th>
    <th>${esc(t.dashColActions)}</th>
  </tr></thead>`;

  const tableHeadHero = `<thead><tr>
    <th>${esc(t.heroColSlug)}</th>
    <th>${esc(t.heroColHeadline)}</th>
    <th>${esc(t.heroColStatus)}</th>
    <th>${esc(t.heroColUpdated)}</th>
    <th>${esc(t.dashColActions)}</th>
  </tr></thead>`;

  const tableHeadTag = `<thead><tr>
    <th>${esc(t.tagColName)}</th>
    <th>${esc(t.tagColSlug)}</th>
  </tr></thead>`;

  const tableHeadAuthor = `<thead><tr>
    <th>${esc(t.authorColName)}</th>
    <th>${esc(t.authorColId)}</th>
  </tr></thead>`;

  const emptyArticle =
    articles === null
      ? `<p class="pf-admin-warn">${esc(t.dashListLoadFailed)}</p>`
      : a.length === 0
        ? `<p class="pf-admin-muted">${esc(t.articleEmpty)}</p>`
        : '';
  const emptyFlash =
    flashes === null
      ? `<p class="pf-admin-warn">${esc(t.dashListLoadFailed)}</p>`
      : f.length === 0
        ? `<p class="pf-admin-muted">${esc(t.flashEmpty)}</p>`
        : '';
  const emptyHero =
    heroes === null
      ? `<p class="pf-admin-warn">${esc(t.dashListLoadFailed)}</p>`
      : h.length === 0
        ? `<p class="pf-admin-muted">${esc(t.heroEmpty)}</p>`
        : '';

  const metaLoadFailed = metaBundle === null;
  const emptyTagBlock =
    !metaLoadFailed && tagList.length === 0
      ? `<p class="pf-admin-muted">${esc(t.tagEmpty)}</p>`
      : '';
  const emptyAuthorBlock =
    !metaLoadFailed && authorList.length === 0
      ? `<p class="pf-admin-muted">${esc(t.authorEmpty)}</p>`
      : '';

  const metaSectionBody = metaLoadFailed
    ? `<p class="pf-admin-warn">${esc(t.dashListLoadFailed)}</p>`
    : `<h3 class="pf-admin-dash-h3">${esc(t.kpiTags)}</h3>
      ${emptyTagBlock}
      ${
        tagList.length > 0
          ? `<div class="pf-admin-table-wrap"><table class="pf-admin-table pf-admin-table--compact">${tableHeadTag}<tbody>${tagRows}</tbody></table></div>`
          : ''
      }
      <h3 class="pf-admin-dash-h3">${esc(t.kpiAuthors)}</h3>
      ${emptyAuthorBlock}
      ${
        authorList.length > 0
          ? `<div class="pf-admin-table-wrap"><table class="pf-admin-table pf-admin-table--compact">${tableHeadAuthor}<tbody>${authorRows}</tbody></table></div>`
          : ''
      }`;

  const html = `
  <div id="pf-admin-dash-root" class="pf-admin-dash">
    <script type="application/json" id="pf-admin-dash-bootstrap">${bootstrap}</script>
    <section class="pf-admin-page">
      <header class="pf-admin-head">
        <h1 class="pf-admin-h1">${esc(t.dashTitle)}</h1>
        ${leadHtml}
        <p class="pf-admin-lead pf-admin-dash-intro">${esc(t.dashInventoryIntro)}</p>
      </header>
      ${cards}
    </section>

    <section class="pf-admin-dash-section">
      <div class="pf-admin-dash-section__head">
        <h2 class="pf-admin-h2">${esc(t.dashSectionNews)}</h2>
        <div class="pf-admin-dash-section__links">
          <a class="pf-admin-dash-more" href="${esc(hrefArticles)}">${esc(t.dashViewAll)}</a>
          <a class="pf-admin-btn pf-admin-btn--sm" href="${esc(hrefArticleNew)}">${esc(t.articleNew)}</a>
        </div>
      </div>
      ${emptyArticle}
      ${articles !== null && a.length > 0
        ? `<div class="pf-admin-table-wrap"><table class="pf-admin-table">${tableHeadArticle}<tbody>${articleRows}</tbody></table></div>`
        : ''}
    </section>

    <section class="pf-admin-dash-section">
      <div class="pf-admin-dash-section__head">
        <h2 class="pf-admin-h2">${esc(t.dashSectionFlash)}</h2>
        <div class="pf-admin-dash-section__links">
          <a class="pf-admin-dash-more" href="${esc(hrefFlashes)}">${esc(t.dashViewAll)}</a>
          <a class="pf-admin-btn pf-admin-btn--sm" href="${esc(hrefFlashNew)}">${esc(t.flashNew)}</a>
        </div>
      </div>
      ${emptyFlash}
      ${flashes !== null && f.length > 0
        ? `<div class="pf-admin-table-wrap"><table class="pf-admin-table">${tableHeadFlash}<tbody>${flashRows}</tbody></table></div>`
        : ''}
    </section>

    <section class="pf-admin-dash-section">
      <div class="pf-admin-dash-section__head">
        <h2 class="pf-admin-h2">${esc(t.dashSectionHero)}</h2>
        <div class="pf-admin-dash-section__links">
          <a class="pf-admin-dash-more" href="${esc(hrefHeroes)}">${esc(t.dashViewAll)}</a>
          <a class="pf-admin-btn pf-admin-btn--sm" href="${esc(hrefHeroNew)}">${esc(t.heroNew)}</a>
        </div>
      </div>
      ${emptyHero}
      ${heroes !== null && h.length > 0
        ? `<div class="pf-admin-table-wrap"><table class="pf-admin-table">${tableHeadHero}<tbody>${heroRows}</tbody></table></div>`
        : ''}
    </section>

    <section class="pf-admin-dash-section pf-admin-dash-section--meta">
      <div class="pf-admin-dash-section__head">
        <h2 class="pf-admin-h2">${esc(t.dashSectionMeta)}</h2>
      </div>
      <p class="pf-admin-meta-hint">${esc(t.dashMetaReadOnly)}</p>
      ${metaSectionBody}
    </section>
    ${ISLAND}
  </div>
  <style>
    .pf-admin-dash { max-width: 56rem; }
    .pf-admin-page { margin-bottom: 1.5rem; }
    .pf-admin-dash-intro { margin-top: 0.75rem; }
    .pf-admin-head { margin-bottom: 1.25rem; }
    .pf-admin-h1 {
      margin: 0 0 0.35rem;
      font-family: var(--nx-display, 'Outfit', system-ui, sans-serif);
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.03em;
    }
    .pf-admin-h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .pf-admin-lead {
      margin: 0;
      color: var(--nx-muted, #64748b);
      font-size: 0.95rem;
    }
    .pf-admin-warn-wrap { margin-bottom: 0.5rem; }
    .pf-admin-warn {
      margin: 0 0 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      font-size: 0.9rem;
    }
    .pf-admin-err-meta {
      margin: 0 0 0.35rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--nx-muted, #64748b);
    }
    .pf-admin-err-pre {
      margin: 0 0 1rem;
      padding: 0.65rem 0.75rem;
      max-height: 10rem;
      overflow: auto;
      font-size: 0.78rem;
      line-height: 1.45;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid var(--nx-border, #e8ecf0);
      color: #0f172a;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .pf-admin-steps-title {
      margin: 0 0 0.4rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--nx-text, #0f172a);
    }
    .pf-admin-steps {
      margin: 0;
      padding-left: 1.15rem;
      font-size: 0.88rem;
      color: var(--nx-muted, #64748b);
      line-height: 1.5;
    }
    .pf-admin-steps li { margin-bottom: 0.35rem; }
    .pf-admin-kpis {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: 0.75rem;
    }
    .pf-admin-kpi {
      margin: 0;
      padding: 1rem 1rem 0.85rem;
      border: 1px solid var(--nx-border, #e8ecf0);
      border-radius: 10px;
      background: var(--nx-surface, #fff);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .pf-admin-kpi__v {
      display: block;
      font-size: 1.65rem;
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.2;
    }
    .pf-admin-kpi__l { font-size: 0.82rem; color: var(--nx-muted, #64748b); }
    .pf-admin-kpi__s { font-size: 0.75rem; color: var(--nx-muted, #64748b); }
    .pf-admin-dash-section { margin-bottom: 2rem; }
    .pf-admin-meta-hint {
      margin: 0 0 0.75rem;
      font-size: 0.88rem;
      color: var(--nx-muted, #64748b);
      line-height: 1.55;
    }
    .pf-admin-dash-h3 {
      margin: 1.15rem 0 0.45rem;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--nx-text, #0f172a);
    }
    .pf-admin-dash-section--meta .pf-admin-meta-hint + .pf-admin-dash-h3 { margin-top: 0.5rem; }
    .pf-admin-table--compact { min-width: 18rem; }
    .pf-admin-dash-section__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .pf-admin-dash-section__links {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
    }
    .pf-admin-dash-more {
      font-size: 0.9rem;
      color: var(--nx-accent-soft, #2563eb);
      text-decoration: none;
    }
    .pf-admin-dash-more:hover { text-decoration: underline; }
    .pf-admin-muted { color: var(--nx-muted, #64748b); margin: 0 0 0.75rem; font-size: 0.9rem; }
    .pf-admin-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .pf-admin-table {
      width: 100%;
      min-width: 36rem;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .pf-admin-table th,
    .pf-admin-table td {
      text-align: left;
      padding: 0.5rem 0.65rem;
      border-bottom: 1px solid var(--nx-border, #e8ecf0);
      vertical-align: top;
    }
    .pf-admin-table th { color: var(--nx-muted, #64748b); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .pf-admin-table a { color: var(--nx-accent-soft, #2563eb); text-decoration: none; }
    .pf-admin-table a:hover { text-decoration: underline; }
    .pf-admin-table code { font-size: 0.8rem; }
    .pf-admin-dash-actions {
      white-space: nowrap;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .pf-admin-dash-edit {
      font-size: 0.85rem;
      color: var(--nx-accent-soft, #2563eb);
      text-decoration: none;
    }
    .pf-admin-dash-edit:hover { text-decoration: underline; }
    .pf-admin-btn {
      display: inline-flex;
      align-items: center;
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      background: var(--nx-accent, #0f172a);
      color: #fff;
      font-size: 0.875rem;
      font-weight: 600;
      text-decoration: none;
    }
    .pf-admin-btn:hover { opacity: 0.92; }
    .pf-admin-btn--sm { padding: 0.3rem 0.65rem; font-size: 0.8rem; }
    .pf-admin-btn--danger { background: #b91c1c; }
    .pf-admin-btn--danger:hover { opacity: 0.9; }
  </style>`;

  return { html };
}

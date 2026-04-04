import type { NexusContext } from '@nexus_js/server/context';
import { adminCopy } from '../../lib/admin-copy.ts';
import { requireAdmin } from '../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const loc = getLocaleFromCtx(ctx);
  const t = adminCopy(loc);
  const dash = pathWithLang(ctx, '/admin');
  const articles = pathWithLang(ctx, '/admin/articles');
  const flashes = pathWithLang(ctx, '/admin/flashes');
  const heroes = pathWithLang(ctx, '/admin/heroes');
  const analytics = pathWithLang(ctx, '/admin/analytics');
  const path = ctx.url.pathname;
  const dashActive = path === '/admin' || path.endsWith('/admin/') ? ' pf-admin-nav__a--on' : '';
  const artActive = path.includes('/admin/articles') ? ' pf-admin-nav__a--on' : '';
  const flashActive = path.includes('/admin/flashes') ? ' pf-admin-nav__a--on' : '';
  const heroActive = path.includes('/admin/heroes') ? ' pf-admin-nav__a--on' : '';
  const anaActive = path.includes('/admin/analytics') ? ' pf-admin-nav__a--on' : '';

  const html = `
  <div class="pf-admin">
    <aside class="pf-admin-aside" aria-label="${escapeAttr(t.shellAsideAria)}">
      <p class="pf-admin-brand">${escapeHtml(t.shellTitle)}</p>
      <nav class="pf-admin-nav">
        <a class="pf-admin-nav__a${dashActive}" href="${dash}">${escapeHtml(t.navDashboard)}</a>
        <a class="pf-admin-nav__a${artActive}" href="${articles}">${escapeHtml(t.navArticles)}</a>
        <a class="pf-admin-nav__a${flashActive}" href="${flashes}">${escapeHtml(t.navFlashes)}</a>
        <a class="pf-admin-nav__a${heroActive}" href="${heroes}">${escapeHtml(t.navHeroes)}</a>
        <a class="pf-admin-nav__a${anaActive}" href="${analytics}">${escapeHtml(t.navAnalytics)}</a>
      </nav>
      <a class="pf-admin-back" href="${pathWithLang(ctx, '/')}">${escapeHtml(t.backSite)}</a>
    </aside>
    <div class="pf-admin-main">
      <!--nexus:slot-->
    </div>
  </div>
  <style>
    .pf-admin {
      display: grid;
      grid-template-columns: minmax(11rem, 14rem) 1fr;
      gap: 0;
      min-height: min(70vh, 720px);
      margin: 0 -0.5rem;
      padding: 0 0.5rem 2rem;
    }
    @media (max-width: 720px) {
      .pf-admin {
        grid-template-columns: 1fr;
      }
      .pf-admin-aside {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--nx-border, #e8ecf0);
        margin-bottom: 1rem;
      }
      .pf-admin-nav {
        flex: 1;
        justify-content: flex-start;
      }
    }
    .pf-admin-aside {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem 1rem 1rem 0;
      border-right: 1px solid var(--nx-border, #e8ecf0);
    }
    .pf-admin-brand {
      margin: 0;
      font-family: var(--nx-display, 'Outfit', system-ui, sans-serif);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--nx-muted, #64748b);
    }
    .pf-admin-nav {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .pf-admin-nav__a {
      font-size: 0.95rem;
      color: var(--nx-text, #0f172a);
      text-decoration: none;
      padding: 0.35rem 0;
      border-radius: 4px;
    }
    .pf-admin-nav__a:hover {
      color: var(--nx-accent-soft, #2563eb);
    }
    .pf-admin-nav__a--on {
      font-weight: 600;
      color: var(--nx-accent-soft, #2563eb);
    }
    .pf-admin-back {
      margin-top: auto;
      font-size: 0.85rem;
      color: var(--nx-muted, #64748b);
      text-decoration: none;
    }
    .pf-admin-back:hover {
      color: var(--nx-text, #0f172a);
    }
    .pf-admin-main {
      padding: 1rem 0 1rem 1.25rem;
      min-width: 0;
    }
  </style>`;

  return { html };
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

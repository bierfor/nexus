import type { NexusContext } from '@nexus_js/server/context';
import { hasAdminSession } from './admin-auth.ts';
import { layoutStr, pathWithLang } from './i18n.ts';

/** Safe for HTML attributes (data-* hrefs in layout). */
export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * SSR-only auth strip for the main layout: no islands, no body classes.
 * After login, the next full navigation shows “Sign out”; use GET /logout to clear the cookie.
 */
export async function renderAuthNavHtml(ctx: NexusContext): Promise<string> {
  const ok = await hasAdminSession(ctx);
  if (ok) {
    const href = escAttr(pathWithLang(ctx, '/logout'));
    const label = escHtml(layoutStr(ctx, 'navLogout'));
    return `<a class="nx-auth-out" href="${href}" data-nx-prefetch="false">${label}</a>`;
  }
  const loginHref = escAttr(pathWithLang(ctx, '/login'));
  const regHref = escAttr(pathWithLang(ctx, '/register'));
  const loginLabel = escHtml(layoutStr(ctx, 'navLogin'));
  const regLabel = escHtml(layoutStr(ctx, 'navRegister'));
  return (
    `<a class="nx-auth-in" href="${loginHref}" data-nx-prefetch="false">${loginLabel}</a>` +
    `<a class="nx-auth-up" href="${regHref}" data-nx-prefetch="false">${regLabel}</a>`
  );
}

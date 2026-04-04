import type { NexusContext } from '@nexus_js/server/context';
import { clearAdminSessionCookie } from '../../lib/admin-auth.ts';
import { pathWithLang } from '../../lib/i18n.ts';

/** Clears the admin session cookie and returns to the home page. */
export async function render(ctx: NexusContext) {
  clearAdminSessionCookie(ctx);
  ctx.redirect(pathWithLang(ctx, '/'), 302);
}

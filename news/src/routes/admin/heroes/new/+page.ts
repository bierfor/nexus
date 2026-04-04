import type { NexusContext } from '@nexus_js/server/context';
import { buildAdminHeroFormHtml, heroFormLabels } from '../../../../lib/admin-hero-ssr.ts';
import { requireAdmin } from '../../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const t = heroFormLabels(getLocaleFromCtx(ctx));
  const listPath = pathWithLang(ctx, '/admin/heroes');

  const html = buildAdminHeroFormHtml({
    mode: 'new',
    hero: null,
    t,
    listPath,
  });

  return { html };
}

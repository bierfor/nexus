import type { NexusContext } from '@nexus_js/server/context';
import { fetchHeroAdminBySlug } from '../../../../lib/admin-gql.ts';
import { buildAdminHeroFormHtml, heroFormLabels } from '../../../../lib/admin-hero-ssr.ts';
import { requireAdmin } from '../../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const raw = ctx.params.slug ?? '';
  const slug = decodeURIComponent(raw);
  const hero = await fetchHeroAdminBySlug(slug, ctx);
  if (!hero) {
    ctx.notFound();
  }

  const t = heroFormLabels(getLocaleFromCtx(ctx));
  const listPath = pathWithLang(ctx, '/admin/heroes');

  const html = buildAdminHeroFormHtml({
    mode: 'edit',
    hero,
    t,
    listPath,
  });

  return { html };
}

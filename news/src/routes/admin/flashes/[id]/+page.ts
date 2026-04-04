import type { NexusContext } from '@nexus_js/server/context';
import { fetchFlashAdminById } from '../../../../lib/admin-gql.ts';
import { buildAdminFlashFormHtml, flashFormLabels } from '../../../../lib/admin-flash-ssr.ts';
import { requireAdmin } from '../../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const id = ctx.params.id ?? '';
  const flash = await fetchFlashAdminById(id, ctx);
  if (!flash) {
    ctx.notFound();
  }

  const t = flashFormLabels(getLocaleFromCtx(ctx));
  const listPath = pathWithLang(ctx, '/admin/flashes');

  const html = buildAdminFlashFormHtml({
    mode: 'edit',
    flash,
    t,
    listPath,
  });

  return { html };
}

import type { NexusContext } from '@nexus_js/server/context';
import { buildAdminFlashFormHtml, flashFormLabels } from '../../../../lib/admin-flash-ssr.ts';
import { requireAdmin } from '../../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../../lib/i18n.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const t = flashFormLabels(getLocaleFromCtx(ctx));
  const listPath = pathWithLang(ctx, '/admin/flashes');

  const html = buildAdminFlashFormHtml({
    mode: 'new',
    flash: null,
    t,
    listPath,
  });

  return { html };
}

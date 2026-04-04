import type { NexusContext } from '@nexus_js/server/context';
import { fetchAuthorsTagsForAdmin } from '../../../../lib/admin-gql.ts';
import { requireAdmin } from '../../../../lib/admin-auth.ts';
import { getLocaleFromCtx, pathWithLang } from '../../../../lib/i18n.ts';
import { articleFormLabels, buildAdminArticleFormHtml } from '../../../../lib/admin-article-ssr.ts';

export async function render(ctx: NexusContext) {
  await requireAdmin(ctx);
  const t = articleFormLabels(getLocaleFromCtx(ctx));
  const bundle = await fetchAuthorsTagsForAdmin(ctx);
  const authors = bundle?.authors ?? [];
  const tags = bundle?.tags ?? [];
  const listPath = pathWithLang(ctx, '/admin/articles');

  const html = buildAdminArticleFormHtml({
    mode: 'new',
    article: null,
    authors,
    tags,
    t,
    listPath,
  });

  return { html };
}

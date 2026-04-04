import type { NexusContext } from '@nexus_js/server/context';
import { pathWithLang } from '../../lib/i18n.ts';

/** Canonical home is `/`; keep `/news` as a permanent redirect for bookmarks. */
export async function render(ctx: NexusContext) {
  return ctx.redirect(pathWithLang(ctx, '/'), 308);
}

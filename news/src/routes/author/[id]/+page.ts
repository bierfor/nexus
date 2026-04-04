import type { NexusContext } from '@nexus_js/server/context';
import { renderAuthorPage } from '../../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderAuthorPage(ctx);
}

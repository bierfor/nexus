import type { NexusContext } from '@nexus_js/server/context';
import { renderTagPage } from '../../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderTagPage(ctx);
}

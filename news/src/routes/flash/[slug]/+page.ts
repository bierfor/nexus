import type { NexusContext } from '@nexus_js/server/context';
import { renderFlashDetail } from '../../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderFlashDetail(ctx);
}

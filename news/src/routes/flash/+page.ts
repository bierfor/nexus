import type { NexusContext } from '@nexus_js/server/context';
import { renderFlashIndex } from '../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderFlashIndex(ctx);
}

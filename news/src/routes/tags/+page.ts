import type { NexusContext } from '@nexus_js/server/context';
import { renderTagsIndex } from '../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderTagsIndex(ctx);
}

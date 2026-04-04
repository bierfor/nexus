import type { NexusContext } from '@nexus_js/server/context';
import { renderAuthorsIndex } from '../../lib/render-explorer.ts';

export async function render(ctx: NexusContext) {
  return renderAuthorsIndex(ctx);
}

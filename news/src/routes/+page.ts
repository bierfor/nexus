import type { NexusContext } from '@nexus_js/server/context';
import { renderNewsIndex } from '../lib/render-news-index.ts';

export async function render(ctx: NexusContext) {
  return renderNewsIndex(ctx);
}

/**
 * Server-only helpers for admin flash (wire) server actions (GraphQL via admin-gql).
 */

import type { NexusContext } from '@nexus_js/server/context';
import { gqlCreateFlashNews, gqlDeleteFlashNews, gqlUpdateFlashNews } from './admin-gql.ts';

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export async function runAdminFlashSave(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true; id: string }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = str(o.id);
  const title = str(o.title);
  const summary = str(o.summary);

  if (!title) throw new Error('Title is required');
  if (!summary) throw new Error('Summary is required');

  const slugRaw = str(o.slug);
  const sourceLabel = strOrNull(o.sourceLabel);
  const sourceUrl = strOrNull(o.sourceUrl);
  const hack = strOrNull(o.hack);
  const published = asBool(o.published);

  if (id) {
    const updated = await gqlUpdateFlashNews(
      id,
      {
        title,
        slug: slugRaw || undefined,
        summary,
        sourceLabel,
        sourceUrl,
        hack,
        published,
      },
      ctx,
    );
    return { ok: true, id: updated.id };
  }

  const created = await gqlCreateFlashNews(
    {
      title,
      summary,
      slug: slugRaw || null,
      sourceLabel,
      sourceUrl,
      hack,
      published,
    },
    ctx,
  );
  return { ok: true, id: created.id };
}

export async function runAdminFlashDelete(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = str(o.id);
  if (!id) throw new Error('Missing flash id');
  await gqlDeleteFlashNews(id, ctx);
  return { ok: true };
}

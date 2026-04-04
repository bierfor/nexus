/**
 * Server-only helpers for admin article server actions (GraphQL via admin-gql).
 * Input is untyped JSON from the client — validate here.
 */

import type { NexusContext } from '@nexus_js/server/context';
import {
  gqlCreateArticle,
  gqlDeleteArticle,
  gqlPublishArticle,
  gqlUnpublishArticle,
  gqlUpdateArticle,
} from './admin-gql.ts';

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Empty string → null (clear optional / author). */
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s;
}

function optInt(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function asTagSlugs(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => str(x)).filter(Boolean);
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function runAdminArticleSave(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true; id: string }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = str(o.id);
  const title = str(o.title);
  const slug = str(o.slug);
  const content = str(o.content);

  if (!title) throw new Error('Title is required');
  if (!slug) throw new Error('Slug is required');
  if (!content) throw new Error('Content is required');

  const excerpt = strOrNull(o.excerpt);
  const coverImage = strOrNull(o.coverImage);
  const coverImageAlt = strOrNull(o.coverImageAlt);
  const readRaw = o.readTimeMinutes;
  const readTimeMinutes =
    readRaw === '' || readRaw === null || readRaw === undefined
      ? null
      : (optInt(readRaw) ?? null);
  const authorId = strOrNull(o.authorId);
  const tagSlugs = asTagSlugs(o.tagSlugs);
  const published = asBool(o.published);

  if (id) {
    const updated = await gqlUpdateArticle(
      id,
      {
        title,
        slug,
        excerpt,
        content,
        coverImage,
        coverImageAlt,
        readTimeMinutes,
        authorId,
        tagSlugs,
        published,
      },
      ctx,
    );
    return { ok: true, id: updated.id };
  }

  const created = await gqlCreateArticle(
    {
      title,
      slug,
      excerpt,
      content,
      coverImage,
      coverImageAlt,
      readTimeMinutes,
      authorId,
      tagSlugs,
      published,
    },
    ctx,
  );
  return { ok: true, id: created.id };
}

export async function runAdminArticleDelete(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = str(o.id);
  if (!id) throw new Error('Missing article id');
  await gqlDeleteArticle(id, ctx);
  return { ok: true };
}

export async function runAdminArticleSetPublished(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = str(o.id);
  if (!id) throw new Error('Missing article id');
  const published = asBool(o.published);
  if (published) {
    await gqlPublishArticle(id, ctx);
  } else {
    await gqlUnpublishArticle(id, ctx);
  }
  return { ok: true };
}

/**
 * Server-only helpers for admin hero banner server actions (GraphQL via admin-gql).
 */

import type { NexusContext } from '@nexus_js/server/context';
import { gqlDeleteHero, gqlUpsertHero } from './admin-gql.ts';

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

export async function runAdminHeroSave(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true; slug: string }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const slug = str(o.slug);
  const headline = str(o.headline);
  const body = str(o.body);

  if (!slug) throw new Error('Slug is required');
  if (!headline) throw new Error('Headline is required');
  if (!body) throw new Error('Body is required');

  const out = await gqlUpsertHero(
    {
      slug,
      kicker: strOrNull(o.kicker),
      headline,
      subheadline: strOrNull(o.subheadline),
      body,
      bodySecondary: strOrNull(o.bodySecondary),
      imageUrl: strOrNull(o.imageUrl),
      footerCtaLabel: strOrNull(o.footerCtaLabel),
      footerCtaHref: strOrNull(o.footerCtaHref),
      published: asBool(o.published),
    },
    ctx,
  );
  return { ok: true, slug: out.slug };
}

export async function runAdminHeroDelete(
  input: unknown,
  ctx?: NexusContext,
): Promise<{ ok: true }> {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const slug = str(o.slug);
  if (!slug) throw new Error('Missing hero slug');
  await gqlDeleteHero(slug, ctx);
  return { ok: true };
}

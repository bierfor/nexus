import type { PrismaClient } from "@prisma/client";
import type { FlashNews } from "@prisma/client";
import { ensureUniqueFlashSlug, flashSlugFromTitle } from "./flash-slug.js";
import { normalizeTagSlugInput } from "./tag-slug.js";

function optStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function isPrismaUniqueError(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002");
}

/** Alias que suelen devolver LLMs mal configurados. */
function sourceLabelFromInput(input: Record<string, unknown>): string | null {
  return (
    optStr(input.sourceLabel as string | undefined) ??
    optStr(input.source as string | undefined) ??
    optStr(input.fuente as string | undefined)
  );
}

function sourceUrlFromInput(input: Record<string, unknown>): string | null {
  return (
    optStr(input.sourceUrl as string | undefined) ??
    optStr(input.url as string | undefined) ??
    optStr(input.link as string | undefined)
  );
}

export type CreateFlashNewsResult =
  | { ok: true; flash: FlashNews }
  | { ok: false; status: 400 | 409; message: string };

/** Crea una noticia relámpago; misma reglas que la mutación GraphQL `createFlashNews`. */
export async function createFlashNewsFromBody(
  prisma: PrismaClient,
  raw: unknown,
): Promise<CreateFlashNewsResult> {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = String(input.title ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  if (!title || !summary) {
    return { ok: false, status: 400, message: "title y summary son obligatorios" };
  }

  const slugRaw = String(input.slug ?? "").trim();
  let slug: string;
  if (!slugRaw) {
    slug = await ensureUniqueFlashSlug(prisma, flashSlugFromTitle(title));
  } else {
    const normalized = normalizeTagSlugInput(slugRaw);
    if (!normalized) {
      slug = await ensureUniqueFlashSlug(prisma, flashSlugFromTitle(title));
    } else {
      slug = await ensureUniqueFlashSlug(prisma, normalized);
    }
  }

  const published = (input.published as boolean | undefined) ?? false;
  try {
    const flash = await prisma.flashNews.create({
      data: {
        title,
        slug,
        summary,
        sourceLabel: sourceLabelFromInput(input),
        sourceUrl: sourceUrlFromInput(input),
        hack: optStr(input.hack as string | undefined),
        published,
        publishedAt: published ? new Date() : null,
      },
    });
    return { ok: true, flash };
  } catch (e: unknown) {
    if (isPrismaUniqueError(e)) {
      return { ok: false, status: 409, message: "Ya existe una flash con ese slug" };
    }
    throw e;
  }
}

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeTagSlugInput } from "./tag-slug.js";

const MAX_BASE_LEN = 72;

/** Slug URL seguro a partir del título (minúsculas, guiones, sin acentos). */
export function flashSlugFromTitle(title: string): string {
  let base = normalizeTagSlugInput(title);
  if (base.length > MAX_BASE_LEN) {
    base = base.slice(0, MAX_BASE_LEN).replace(/-+$/g, "");
  }
  return base || "flash";
}

/** Garantiza un slug único en `FlashNews` (añade sufijo aleatorio si hace falta). */
export async function ensureUniqueFlashSlug(
  prisma: PrismaClient,
  base: string,
): Promise<string> {
  const normalized = normalizeTagSlugInput(base) || "flash";
  let candidate = normalized;
  for (let i = 0; i < 10; i++) {
    const exists = await prisma.flashNews.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${normalized}-${randomBytes(3).toString("hex")}`;
  }
  return `${normalized}-${randomBytes(4).toString("hex")}`;
}

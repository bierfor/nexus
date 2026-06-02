import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { cwd } from 'node:process';
import type {
  CollectionItem,
  CollectionOptions,
  LoadContentOptions,
} from './types.js';
import { loadContent } from './load-content.js';

/**
 * List all Markdown files in a content directory.
 * Returns unique base slugs (excluding locale suffixes like .es.md).
 */
function listSlugs(dir: string, locales: string[]): string[] {
  try {
    const fullDir = join(cwd(), dir);
    const entries = readdirSync(fullDir);

    const slugs = new Set<string>();
    const localeSet = new Set(locales.map((l) => `.${l}`));

    for (const entry of entries) {
      const fullPath = join(fullDir, entry);
      const st = statSync(fullPath);
      if (!st.isFile()) continue;

      const ext = extname(entry);
      if (ext !== '.md') continue;

      const nameWithoutExt = basename(entry, '.md');

      // Check if it ends with a locale suffix (e.g. "article.es")
      const lastDot = nameWithoutExt.lastIndexOf('.');
      if (lastDot > 0) {
        const suffix = nameWithoutExt.slice(lastDot);
        if (localeSet.has(suffix)) {
          // It's a localized file: use the base name as slug
          const baseSlug = nameWithoutExt.slice(0, lastDot);
          slugs.add(baseSlug);
          continue;
        }
      }

      // It's a base file
      slugs.add(nameWithoutExt);
    }

    return Array.from(slugs).sort();
  } catch {
    return [];
  }
}

/**
 * Define a typed content collection with auto-discovery.
 *
 * Example:
 *   const docs = defineCollection({ name: 'docs', dir: 'src/content/docs' });
 *   const page = docs.get('getting-started', { locale: 'es' });
 *   const all = docs.list({ locale: 'en' });
 *   const published = docs.list({ filter: (item) => !item.meta.draft });
 */
export function defineCollection<TMeta = Record<string, unknown>>(
  opts: CollectionOptions<TMeta>
): {
  name: string;
  get: (
    slug: string,
    options?: Pick<LoadContentOptions, 'locale' | 'defaultLocale' | 'contentDir'>
  ) => CollectionItem<TMeta>;
  list: (
    options?: Pick<LoadContentOptions, 'locale' | 'defaultLocale' | 'contentDir'> & {
      filter?: (item: CollectionItem<TMeta>) => boolean;
      sortBy?: keyof TMeta | string;
      sortDesc?: boolean;
    }
  ) => CollectionItem<TMeta>[];
} {
  const { name, dir, defaultLocale = 'en', locales = [] } = opts;

  return {
    name,

    get(slug, options = {}): CollectionItem<TMeta> {
      const contentDir = options.contentDir ?? dir;
      const entry = loadContent(slug, {
        locale: options.locale,
        defaultLocale: defaultLocale,
        contentDir,
        extractHeadings: true,
      });

      return {
        slug,
        html: entry.html,
        meta: entry.meta as TMeta,
        headings: entry.headings,
        locale: entry.locale,
        filePath: entry.filePath,
      };
    },

    list(options = {}): CollectionItem<TMeta>[] {
      const contentDir = options.contentDir ?? dir;
      const resolvedLocale = options.locale;
      const localeOrDefault = resolvedLocale ?? defaultLocale;

      const slugs = listSlugs(contentDir, locales.length > 0 ? locales : [defaultLocale]);

      let items = slugs.map((slug) => {
        const entry = loadContent(slug, {
          locale: resolvedLocale,
          defaultLocale: defaultLocale,
          contentDir,
          extractHeadings: true,
        });
        return {
          slug,
          html: entry.html,
          meta: entry.meta as TMeta,
          headings: entry.headings,
          locale: entry.locale,
          filePath: entry.filePath,
        };
      });

      if (options.filter) {
        items = items.filter(options.filter);
      }

      if (options.sortBy) {
        const key = options.sortBy as string;
        items.sort((a, b) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const aVal = (a.meta as Record<string, any>)[key];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bVal = (b.meta as Record<string, any>)[key];
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return options.sortDesc ? bVal - aVal : aVal - bVal;
          }
          const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
          return options.sortDesc ? -cmp : cmp;
        });
      }

      return items;
    },
  };
}

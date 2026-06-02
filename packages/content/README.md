# @nexus_js/content

First-class Markdown and rich content collections for Nexus apps.

Designed for the pattern that worked in production: external `.md` files, `load()` with server-side rendering, and safe HTML interpolation in `.nx` templates.

## Install

```bash
npm install @nexus_js/content
# optional peers
npm install shiki      # syntax highlighting
npm install chokidar   # reliable file watching in dev
```

## Quick Start

```ts
// src/routes/docs/[slug]/+page.ts
import { loadContent } from '@nexus_js/content';

export function load({ params }) {
  const entry = loadContent(`docs/${params.slug}`, {
    locale: 'es',
    contentDir: 'src/content',
  });

  return {
    pretext: {
      title: entry.meta.title,
      html: entry.html,
      headings: entry.headings,
    },
  };
}
```

```nx
<!-- src/routes/docs/[slug]/+page.nx -->
<article class="prose">
  <h1>{pretext.title}</h1>
  {pretext.html}
</article>
```

## Collections (auto-discovery)

```ts
import { defineCollection } from '@nexus_js/content';

const blog = defineCollection({
  name: 'blog',
  dir: 'src/content/blog',
  locales: ['en', 'es'],
  defaultLocale: 'en',
});

// All posts
const posts = blog.list({
  locale: 'es',
  sortBy: 'date',
  sortDesc: true,
  filter: (item) => !item.meta.draft,
});

// Single post
const post = blog.get('hello-world', { locale: 'es' });
```

## i18n with ICU plurals

```ts
import { defineI18n } from '@nexus_js/content';

const i18n = defineI18n({
  locales: ['en', 'es', 'pt'],
  defaultLocale: 'en',
  messages: {
    en: {
      hello: 'Hello {name}',
      items: '{count, plural, one {One item} other {{count} items}}',
    },
    es: {
      hello: 'Hola {name}',
      items: '{count, plural, one {Un elemento} other {{count} elementos}}',
    },
  },
});

const t = i18n.tFn('es');
t('hello', { name: 'Nexus' });        // → 'Hola Nexus'
t('items', { count: 5 });             // → '5 elementos'
t('items', { count: 1 });             // → 'Un elemento'
```

Locale resolution (querystring → cookie → Accept-Language header):

```ts
const locale = i18n.resolveLocale({
  url: request.url,
  getCookie: (name) => cookies.get(name),
});
```

## Async rendering with Shiki

```ts
import { renderMarkdownAsync } from '@nexus_js/content';

const { html, headings } = await renderMarkdownAsync(rawMarkdown, {
  highlight: true,      // requires shiki
  sanitize: 'strict',
  cspNonce: nonce,
});
```

## Dates

```ts
import { formatDate, formatRelative } from '@nexus_js/content';

formatDate(new Date(), { locale: 'es', format: 'long' });
// → '3 de julio de 2026'

formatRelative(new Date(Date.now() - 1000 * 60 * 5), 'es');
// → 'hace 5 mins'
```

## Watch (dev mode)

```ts
import { watchContent, stopAllWatchers } from '@nexus_js/content';

if (import.meta.env?.DEV) {
  watchContent({
    contentDir: 'src/content/blog',
    onChange: (event, filename) => {
      console.log(`[content] ${event}: ${filename}`);
      // trigger your own reload logic
    },
  });
}
```

Prefers `chokidar` when installed; falls back to `node:fs/watch`.

## Security

`sanitizeHTML` is security-first by default:

- Strips `<script>` tags
- Removes event handlers (`onclick`, `onerror`, ...)
- Blocks `javascript:` and `data:` URLs
- Whitelists tags/attributes in strict mode
- Injects CSP nonce into `<style>` tags

```ts
import { sanitizeHTML } from '@nexus_js/content';

const clean = sanitizeHTML(untrustedHtml, {
  sanitize: 'strict',
  cspNonce: 'nonce-abc123',
});
```

## API

### `loadContent(path, opts?)`
Load a single Markdown file with i18n fallback.

### `defineCollection(opts)`
Auto-discovering content collection with `get()` and `list()`.

### `renderMarkdown(md, opts?)` / `renderMarkdownAsync(md, opts?)`
Render Markdown to sanitized HTML (sync without highlighting, async with optional Shiki).

### `defineI18n(opts)`
Minimal type-safe i18n with locale resolution and ICU plurals.

### `interpolate(template, vars)`
Standalone ICU-style plural + variable interpolation.

### `formatDate(input, opts?)` / `formatRelative(date, locale)`
Localized date formatting and timeago.

### `sanitizeHTML(html, opts?)`
Semi-trusted HTML sanitizer (for your own Markdown, not raw user HTML).

### `watchContent(opts)` / `stopAllWatchers()`
File watching for hot-reload in development.

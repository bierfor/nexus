# @nexus_js/head

Nexus Head — reactive SEO metadata manager for Islands Architecture.

## Why

In an islands architecture most of your page is static HTML. Interactive pieces are isolated "islands". But SEO metadata (`<title>`, `og:image`, `description`, canonical, JSON-LD...) still lives in `<head>`.

Nexus Head gives you two clean ways to manage it:

- **Server (SSR)**: `defineHead()` called from `load()` is automatically collected and injected into the final HTML by the renderer. Perfect for crawlers and zero-JS pages.
- **Client (islands)**: `useHead()` inside a `<script>` reactively updates the head when your Svelte runes change.

## New recommended pattern (auto-injection)

In any `load()` (page or layout) simply return a `head` object. The renderer will pick it up, call `defineHead` for you, and inject the tags (replacing `<!--nexus:head-->` or injecting before `</head>`).

```ts
// src/routes/+page.nx or +layout.nx
export async function load(ctx) {
  return {
    head: {
      title: 'My Page',
      description: 'Best page ever',
      canonical: 'https://example.com/page',
      og: { image: 'https://example.com/og.png', type: 'website' },
      twitter: { card: 'summary_large_image' },
    },
    // ... other pretext data
  };
}
```

No need to touch the layout template for per-page metadata.

Layouts + pages are merged (child wins).

### Layout inheritance

Return partial `head` objects from layouts and let pages override specific keys:

```ts
// +layout.nx
export async function load(ctx) {
  return {
    head: {
      titleTemplate: '%s | My Site',
      og: { siteName: 'My Site', type: 'website' },
      twitter: { site: '@mysite' },
    },
  };
}
```

```ts
// +page.nx
export async function load(ctx) {
  return {
    head: {
      title: 'Blog Post',
      description: 'A great read',
      og: { type: 'article', image: 'https://example.com/cover.png' },
    },
  };
}
```

Merged result: `title` becomes `"Blog Post | My Site"`, `og:type` is `"article"` (page wins), `og:siteName` is preserved from the layout.

## Manual usage (still supported)

For advanced cases or inside server-only blocks:

```ts
---
import { defineHead } from '@nexus_js/head';

defineHead({
  title: 'Product',
  og: { image: product.image },
});
---
```

When passing `ctx` you get request-scoped isolation (safe for concurrent streaming):

```ts
defineHead({ title: '...' }, ctx);
```

## Client-side reactive updates

Inside islands that hydrate on the client:

```html
<div client:load>
  <script>
    let count = $state(0);
    useHead(() => ({
      title: `Counter: ${count.value}`,
    }));
  </script>
  ...
</div>
```

`useHead` cleans up previously injected elements on every re-run, so you never leak old `<meta>` tags.

## Full HeadMeta API

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Page `<title>`. Also sets `og:title` and `twitter:title` automatically. |
| `titleTemplate` | `string` | Template with `%s` placeholder: `"%s | My Site"`. |
| `description` | `string` | `<meta name="description">`. Mirrored to `og:description` and `twitter:description`. |
| `canonical` | `string` | `<link rel="canonical">`. Also sets `og:url`. |
| `robots` | `string \| RobotsDirective` | Index/follow directives. |
| `viewport` | `string` | Viewport meta (usually set once in the root layout). |
| `og` | `OpenGraphMeta` | `title`, `description`, `image`, `imageAlt`, `imageWidth`, `imageHeight`, `url`, `type`, `siteName`, `locale`. |
| `twitter` | `TwitterMeta` | `card`, `site`, `creator`, `title`, `description`, `image`, `imageAlt`. |
| `jsonLd` | `object \| object[]` | JSON-LD structured data injected as `<script type="application/ld+json">`. |
| `links` | `LinkTag[]` | Arbitrary `<link>` tags. |
| `metas` | `MetaTag[]` | Arbitrary `<meta>` tags. |
| `scripts` | `ScriptTag[]` | `<script>` tags to inject into `<head>`. |
| `themeColor` | `string` | `<meta name="theme-color">`. |
| `favicon` | `string` | `<link rel="icon">` href. |

All string values are HTML-escaped automatically (`<`, `>`, `&`, `"`).

## Programmatic API

- `defineHead(meta: HeadMeta, ctx?)` — server only. Push metadata to the stack.
- `flushHead(ctx?)` — returns and clears collected metas.
- `renderHeadToString(metas)` — turns metas into a safe HTML string.
- `useHead(() => meta)` — client reactive.

All are re-exported from `@nexus_js/server` for convenience.

## Migration from `defineMetadata`

The old `defineMetadata` (from `@nexus_js/server`) is deprecated. Replace it with either:

1. `head` return value from `load()` (recommended).
2. Explicit `defineHead()` if you need imperative control.

## Links

- **Docs & examples:** https://nexusjs.dev/docs/seo
- **Website:** https://nexusjs.dev
- **Repo:** https://github.com/bierfor/nexus

## License

MIT © Nexus contributors

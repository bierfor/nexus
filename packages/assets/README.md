# @nexus_js/assets

Nexus asset pipeline — image optimization (AVIF/WebP), responsive srcsets, blur placeholders, and font preloading.

## Image Optimization

The fastest way to serve optimized images in Nexus.

### Basic usage

In any `.nx` template, import `Image` and interpolate it directly:

```nx
---
import { Image } from '@nexus_js/assets';
---

{Image({ src: '/hero.jpg', alt: 'Hero', width: 1200, height: 600 })}
```

This generates a `<picture>` element with:
- AVIF source for modern browsers
- WebP fallback
- Original format fallback (`<img>`)
- Responsive `srcset` for breakpoints `[320, 640, 960, 1280, 1920]`
- Lazy loading by default
- Intrinsic `width` / `height` to prevent CLS

### Fill mode (hero / background images)

When the image should fill its container:

```nx
---
import { Image } from '@nexus_js/assets';
---

<div style="position:relative;width:100%;height:60vh;">
  {Image({ src: '/hero.jpg', alt: 'Hero', fill: true, objectFit: 'cover', priority: true })}
</div>
```

`fill` removes `width`/`height` attributes and applies `position:absolute;inset:0` styles. The parent **must** have `position:relative`.

### Priority (above-the-fold)

For images that appear immediately on load:

```nx
{Image({ src: '/hero.jpg', alt: 'Hero', width: 1200, height: 600, priority: true })}
```

This sets `loading="eager"`, `decoding="sync"`, and `fetchpriority="high"`.

To also preload the image in `<head>`, return a `link` from your `load()`:

```ts
import { renderImagePreloadLink } from '@nexus_js/assets';

export async function load(ctx) {
  return {
    head: {
      links: [
        { rel: 'preload', as: 'image', href: '/_nexus/image?src=%2Fhero.jpg&w=1200&q=80' },
      ],
    },
  };
}
```

### Blur placeholder

For a smooth loading experience, generate a low-quality placeholder in `load()`:

```ts
import { Image, getBlurDataURL } from '@nexus_js/assets';
import { resolve } from 'node:path';

export async function load(ctx) {
  const publicDir = resolve(process.cwd(), 'public');
  const blurDataURL = await getBlurDataURL('/hero.jpg', publicDir);
  return {
    hero: { src: '/hero.jpg', alt: 'Hero', width: 1200, height: 600, blurDataURL },
  };
}
```

```nx
{Image(pretext.hero)}
```

### Unoptimized mode

Bypass the optimizer for SVGs, GIFs, or when you need the original file:

```nx
{Image({ src: '/logo.svg', alt: 'Logo', width: 200, height: 200, unoptimized: true })}
```

### Automatic dimensions

If you don't know the image size ahead of time, read it at runtime:

```ts
import { getImageDimensions } from '@nexus_js/assets';
import { resolve } from 'node:path';

export async function load(ctx) {
  const publicDir = resolve(process.cwd(), 'public');
  const dims = await getImageDimensions('/photo.jpg', publicDir);
  return { photo: { src: '/photo.jpg', alt: 'Photo', ...dims } };
}
```

### Remote images

External URLs are proxied safely through the optimizer:

```nx
{Image({ src: 'https://example.com/photo.jpg', alt: 'Remote', width: 800, height: 600 })}
```

Security checks block private IPs, localhost, and non-HTTP(S) protocols automatically.

## Full Image Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | **required** | Local path (`/hero.jpg`) or remote URL |
| `alt` | `string` | **required** | Accessible description |
| `width` | `number` | — | Intrinsic width (prevents CLS) |
| `height` | `number` | — | Intrinsic height (prevents CLS) |
| `size` | `number` | — | Square shorthand (sets both width and height) |
| `sizes` | `string` | auto | `sizes` attribute for responsive images |
| `priority` | `boolean` | `false` | Eager loading + high fetchpriority |
| `round` | `boolean` | `false` | `border-radius: 50%` |
| `class` | `string` | — | Custom CSS class |
| `quality` | `number` | `80` | 1–100 compression quality |
| `formats` | `ImageFormat[]` | `['avif','webp','original']` | Output format priority |
| `placeholder` | `'blur' \| 'empty' \| 'none'` | `'blur'` | Loading placeholder strategy |
| `blurDataURL` | `string` | — | Inline base64 LQIP |
| `fetchpriority` | `'high' \| 'low' \| 'auto'` | auto | Browser fetch priority hint |
| `fill` | `boolean` | `false` | Fill parent container |
| `objectFit` | `string` | `'cover'` | CSS object-fit (fill mode) |
| `objectPosition` | `string` | `'center'` | CSS object-position (fill mode) |
| `unoptimized` | `boolean` | `false` | Bypass optimization |
| `style` | `string` | — | Additional inline styles |

## API Reference

- `Image(props)` / `renderImage(props)` — generate optimized `<picture>` HTML
- `imageUrl(src, width, format, quality)` — build `/_nexus/image?...` URL
- `getImageDimensions(src, publicDir)` — read width/height via sharp
- `getBlurDataURL(src, publicDir)` — generate base64 LQIP
- `renderImagePreloadLink(props)` — generate `<link rel="preload">` tag
- `generateBlurDataURL(buffer)` — generate LQIP from a Buffer
- `blurFromFile(absolutePath)` — generate LQIP from disk
- `handleImageRequest(request, { publicDir })` — HTTP handler for `/_nexus/image`

## Font Optimization

See `@nexus_js/assets/fonts` for Google Font inlining, preloading, and self-hosted font optimization.

## Links

- **Docs:** https://nexusjs.dev/docs/assets
- **Website:** https://nexusjs.dev
- **Repo:** https://github.com/bierfor/nexus

## License

MIT © Nexus contributors

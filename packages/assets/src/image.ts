/**
 * Nexus Image — Server-side optimization + client lazy loading.
 *
 * On the server (build/SSR):
 *   - Generates <picture> with AVIF + WebP + original fallback sources
 *   - Computes intrinsic width/height to prevent CLS
 *   - Emits responsive srcset for each configured breakpoint
 *   - Blur placeholder hook (data-nx-blur) for perceived performance
 *
 * On the client:
 *   - Native `loading="lazy"` + `decoding="async"`
 *   - IntersectionObserver for below-the-fold images (optional island)
 *
 * Usage in .nx templates:
 *   import { renderImage } from '@nexus_js/assets';
 *   renderImage({ src: "/hero.jpg", alt: "Hero", width: 1280, height: 720, priority: true })
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';

export interface ImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Square shorthand: sets both width and height */
  size?: number;
  /** Render sizes attribute for responsive images */
  sizes?: string;
  /** Skip lazy loading (above-the-fold images) */
  priority?: boolean;
  /** Round crop (avatars, icons) */
  round?: boolean;
  /** Custom CSS class */
  class?: string;
  /** Quality 1-100 (default: 80) */
  quality?: number;
  /** Output formats in priority order */
  formats?: ImageFormat[];
  /**
   * Placeholder strategy.
   * - 'blur':  Show a real LQIP inline base64 thumbnail until the image loads.
   *            Pass a precomputed `blurDataURL` (from `generateBlurDataURL`) for best results;
   *            otherwise falls back to a solid gray background.
   * - 'empty': Transparent placeholder, no background fill.
   * - 'none':  No placeholder at all.
   */
  placeholder?: 'blur' | 'empty' | 'none';
  /**
   * Pre-computed base64 LQIP data URI (e.g. from `generateBlurDataURL`).
   * When provided alongside `placeholder="blur"`, this is inlined as the
   * `background-image` so the user sees a blurred preview immediately.
   */
  blurDataURL?: string;
  /** Fetch priority hint */
  fetchpriority?: 'high' | 'low' | 'auto';
}

export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpg' | 'original';

export interface OptimizedImageSrc {
  url: string;
  width: number;
  format: ImageFormat;
}

/** Options for {@link handleImageRequest} (Node / Vite dev server). */
export interface ImageHandlerOptions {
  /**
   * Directory used to resolve local `src` paths (e.g. `/photo.jpg` → `<publicDir>/photo.jpg`).
   * When omitted, local files fall back to passthrough behavior.
   */
  publicDir?: string;
}

/** Default responsive breakpoints (px) */
const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920];

/** Default format priority (most efficient first) */
const DEFAULT_FORMATS: ImageFormat[] = ['avif', 'webp', 'original'];

/**
 * Generates optimized `<picture>` HTML for a given image.
 * This runs on the SERVER at build or request time.
 */
export function renderImage(props: ImageProps): string {
  const {
    src,
    alt,
    priority = false,
    round = false,
    quality = 80,
    formats = DEFAULT_FORMATS,
    placeholder = 'blur',
    blurDataURL,
    fetchpriority,
  } = props;

  const w = props.size ?? props.width;
  const h = props.size ?? props.height;

  const loading = priority ? 'eager' : 'lazy';
  const decoding = priority ? 'sync' : 'async';
  const fp = fetchpriority ?? (priority ? 'high' : 'auto');

  const widths = w ? getResponsiveWidths(w) : DEFAULT_WIDTHS;
  const sizesAttr = props.sizes ?? defaultSizes(widths);

  const roundStyle = round ? 'border-radius:50%;' : '';
  const aspectStyle = w && h ? `aspect-ratio:${w}/${h};` : '';
  const classAttr = props.class ? ` class="${props.class}"` : '';

  // Build <source> elements for modern formats
  const sources = formats
    .filter((f): f is Exclude<ImageFormat, 'original'> => f !== 'original')
    .map((format) => {
      const srcset = widths
        .map((width) => `${imageUrl(src, width, format, quality)} ${width}w`)
        .join(', ');
      return `<source type="image/${format}" srcset="${srcset}" sizes="${sizesAttr}">`;
    })
    .join('\n    ');

  // Fallback <img>
  const fallbackSrcset = widths
    .map((width) => `${imageUrl(src, width, 'original', quality)} ${width}w`)
    .join(', ');

  const dimensionAttrs = [
    w ? `width="${w}"` : '',
    h ? `height="${h}"` : '',
  ].filter(Boolean).join(' ');

  // ── Placeholder / blur strategy ──────────────────────────────────────────
  // The blur background sits on the <picture> container. The <img> starts at
  // opacity:0 so the LQIP shows through. When the real image fires `onload`
  // the handler fades the img in and removes the data-nx-blur attribute so
  // CSS can stop rendering the background (no extra repaints).
  let pictureExtraAttrs = '';
  let imgStyleAttr = '';
  let imgOnload = '';

  if (placeholder === 'blur') {
    const bgImage = blurDataURL
      ? `background-image:url("${blurDataURL}");background-size:cover;background-position:center;`
      : 'background:var(--nx-img-blur,#e8e8e8);';
    pictureExtraAttrs =
      ` data-nx-blur style="${aspectStyle}${roundStyle}overflow:hidden;${bgImage}"`;
    imgStyleAttr = ` style="opacity:0;transition:opacity 0.4s ease;"`;
    imgOnload = ` onload="this.style.opacity='1';this.parentElement.removeAttribute('data-nx-blur')"`;
  } else {
    pictureExtraAttrs = aspectStyle || roundStyle
      ? ` style="${aspectStyle}${roundStyle}"`
      : '';
  }

  return `<picture${classAttr}${pictureExtraAttrs}>
    ${sources}
    <img
      src="${imageUrl(src, w ?? 800, 'original', quality)}"
      srcset="${fallbackSrcset}"
      sizes="${sizesAttr}"
      alt="${escapeAttr(alt)}"
      ${dimensionAttrs}
      loading="${loading}"
      decoding="${decoding}"
      fetchpriority="${fp}"${imgStyleAttr}${imgOnload}
      data-nx-img
    >
  </picture>`;
}

/**
 * Transforms an image URL into an optimized variant URL.
 * In production, this calls the /_nexus/image endpoint which does real conversion.
 * In dev, it passes through with query params for the dev server to handle.
 */
export function imageUrl(
  src: string,
  width: number,
  format: ImageFormat | 'original',
  quality: number,
): string {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    // External URLs: proxy through the image optimizer
    return `/_nexus/image?url=${encodeURIComponent(src)}&w=${width}&f=${format}&q=${quality}`;
  }
  if (format === 'original') {
    return `/_nexus/image?src=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
  }
  return `/_nexus/image?src=${encodeURIComponent(src)}&w=${width}&f=${format}&q=${quality}`;
}

const REMOTE_MAX_BYTES = 12 * 1024 * 1024;

/** HTTP handler for the /_nexus/image endpoint */
export async function handleImageRequest(
  request: Request,
  options: ImageHandlerOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const src = url.searchParams.get('src') ?? '';
  const remoteUrl = url.searchParams.get('url') ?? '';
  const width = Math.min(Math.max(parseInt(url.searchParams.get('w') ?? '800', 10) || 800, 1), 8192);
  const hasExplicitFormat = url.searchParams.has('f');
  const formatParam = (url.searchParams.get('f') ?? 'original') as ImageFormat | 'original';
  const quality = Math.min(Math.max(parseInt(url.searchParams.get('q') ?? '80', 10) || 80, 1), 100);
  const isBlurRequest = url.searchParams.get('blur') === '1';

  // Only honor `f=` when present. Omitted `f` means "original" raster (JPEG/PNG), not Accept-based AVIF/WebP,
  // so <picture><source type=avif> and <img> fallback stay distinct.
  const outputFormat: ImageFormat | 'original' = hasExplicitFormat ? formatParam : 'original';

  const cacheHeaders = {
    'cache-control': 'public, max-age=31536000, immutable',
  } as const;

  try {
    let input: Buffer;
    let sourceLabel: string;

    if (remoteUrl) {
      if (!remoteUrl.startsWith('https://') && !remoteUrl.startsWith('http://')) {
        return new Response('Invalid URL', { status: 400 });
      }
      const fetched = await fetchRemoteImage(remoteUrl);
      if (!fetched) {
        return new Response('Failed to fetch image', { status: 502 });
      }
      input = fetched;
      sourceLabel = remoteUrl;
    } else if (src) {
      if (!options.publicDir) {
        return new Response('Local src requires publicDir (set in Nexus server / Vite plugin)', { status: 400 });
      }
      const path = safeResolvePublicPath(options.publicDir, src);
      if (!path) {
        return new Response('Invalid path', { status: 400 });
      }
      try {
        input = await readFile(path);
      } catch {
        return new Response('Not found', { status: 404 });
      }
      sourceLabel = src;
    } else {
      return new Response('Missing src or url', { status: 400 });
    }

    if (isBlurRequest) {
      // Return a tiny LQIP JPEG (10×10, blurred) for inline data URI use.
      const blurBuf = await sharp(input)
        .resize(10, 10, { fit: 'inside', withoutEnlargement: false })
        .blur(3)
        .jpeg({ quality: 20, mozjpeg: true })
        .toBuffer();
      return new Response(new Uint8Array(blurBuf), {
        status: 200,
        headers: {
          ...cacheHeaders,
          'content-type': 'image/jpeg',
          'x-nexus-image-source': encodeURIComponent(sourceLabel.slice(0, 200)),
        },
      });
    }

    const { body, contentType } = await encodeWithSharp(input, width, outputFormat, quality);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        ...cacheHeaders,
        'content-type': contentType,
        'x-nexus-image-source': encodeURIComponent(sourceLabel.slice(0, 200)),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Image optimization failed: ${message}`, { status: 500 });
  }
}

function safeResolvePublicPath(publicDir: string, src: string): string | null {
  const normalized = src.replace(/^\/+/, '');
  if (normalized.includes('..')) return null;
  const full = resolve(join(publicDir, normalized));
  const root = resolve(publicDir);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

async function fetchRemoteImage(remoteUrl: string): Promise<Buffer | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(remoteUrl, {
      signal: ac.signal,
      headers: { 'user-agent': 'NexusImage/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    if (len && Number(len) > REMOTE_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > REMOTE_MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function encodeWithSharp(
  input: Buffer,
  width: number,
  outputFormat: ImageFormat | 'original',
  quality: number,
): Promise<{ body: Uint8Array; contentType: string }> {
  let pipeline = sharp(input).rotate().resize({
    width,
    withoutEnlargement: true,
    fit: 'inside',
  });

  const meta = await sharp(input).metadata();

  if (outputFormat === 'avif') {
    const buf = await pipeline.avif({ quality }).toBuffer();
    return { body: buf, contentType: 'image/avif' };
  }
  if (outputFormat === 'webp') {
    const buf = await pipeline.webp({ quality }).toBuffer();
    return { body: buf, contentType: 'image/webp' };
  }
  if (outputFormat === 'png') {
    const buf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { body: buf, contentType: 'image/png' };
  }
  if (outputFormat === 'jpg') {
    const buf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    return { body: buf, contentType: 'image/jpeg' };
  }

  // original: resize only, preserve alpha when present
  if (meta.hasAlpha || meta.format === 'png') {
    const buf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { body: buf, contentType: 'image/png' };
  }
  const buf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  return { body: buf, contentType: 'image/jpeg' };
}

function getResponsiveWidths(maxWidth: number): number[] {
  return DEFAULT_WIDTHS.filter((w) => w <= maxWidth * 1.5);
}

function defaultSizes(widths: number[]): string {
  const max = widths[widths.length - 1];
  return max ? `(max-width: ${max}px) 100vw, ${max}px` : '100vw';
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── LQIP (Low Quality Image Placeholder) ───────────────────────────────────

/**
 * Generates a tiny 10×10 blurred JPEG encoded as a base64 data URI.
 * Inline this into `ImageProps.blurDataURL` so `renderImage` can embed it
 * directly in the HTML without a round-trip fetch.
 *
 * ```ts
 * // In a server load function or SSR route:
 * const blurDataURL = await generateBlurDataURL(imageBuffer);
 * return renderImage({ src: '/hero.jpg', alt: 'Hero', blurDataURL });
 * ```
 */
export async function generateBlurDataURL(input: Buffer): Promise<string> {
  const buf = await sharp(input)
    .resize(10, 10, { fit: 'inside', withoutEnlargement: false })
    .blur(3)
    .jpeg({ quality: 30, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/**
 * Generates a LQIP data URI from a local public-dir file path.
 * Convenience wrapper around `generateBlurDataURL`.
 *
 * ```ts
 * const blur = await blurFromFile('/absolute/path/to/public/hero.jpg');
 * ```
 */
export async function blurFromFile(absolutePath: string): Promise<string> {
  const input = await readFile(absolutePath);
  return generateBlurDataURL(input);
}

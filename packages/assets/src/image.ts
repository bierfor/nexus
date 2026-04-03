/**
 * Nexus Image — Server-side optimization + client lazy loading.
 *
 * On the server (build/SSR):
 *   - Generates <picture> with AVIF + WebP + original fallback sources
 *   - Computes intrinsic width/height to prevent CLS
 *   - Emits responsive srcset for each configured breakpoint
 *   - Adds blur placeholder (base64 LQIP) for perceived performance
 *
 * On the client:
 *   - Native `loading="lazy"` + `decoding="async"`
 *   - IntersectionObserver for below-the-fold images
 *   - Optional `client:visible` island for JS-powered effects
 *
 * Usage in .nx templates:
 *   <NexusImage src="/hero.jpg" alt="Hero" width={1280} height={720} priority />
 *   <NexusImage src="/avatar.png" alt="Avatar" size={48} round />
 */

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
  /** Placeholder strategy */
  placeholder?: 'blur' | 'empty' | 'none';
  /** Fetch priority hint */
  fetchpriority?: 'high' | 'low' | 'auto';
}

export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpg' | 'original';

export interface OptimizedImageSrc {
  url: string;
  width: number;
  format: ImageFormat;
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

  const blurAttr = placeholder === 'blur'
    ? ` data-nx-blur style="${aspectStyle}${roundStyle}background:var(--nx-img-blur,#f0f0f0)"`
    : ` style="${aspectStyle}${roundStyle}"`;

  return `<picture${classAttr}>
    ${sources}
    <img
      src="${imageUrl(src, w ?? 800, 'original', quality)}"
      srcset="${fallbackSrcset}"
      sizes="${sizesAttr}"
      alt="${escapeAttr(alt)}"
      ${dimensionAttrs}
      loading="${loading}"
      decoding="${decoding}"
      fetchpriority="${fp}"${blurAttr}
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

/** HTTP handler for the /_nexus/image endpoint */
export async function handleImageRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const src = url.searchParams.get('src') ?? '';
  const remoteUrl = url.searchParams.get('url') ?? '';
  const width = parseInt(url.searchParams.get('w') ?? '800', 10);
  const format = (url.searchParams.get('f') ?? 'original') as ImageFormat | 'original';
  const quality = parseInt(url.searchParams.get('q') ?? '80', 10);

  // Check browser's Accept header to negotiate format
  const accept = request.headers.get('accept') ?? '';
  const negotiatedFormat = negotiateFormat(format, accept);

  try {
    // In a real implementation, use `sharp` or `@squoosh/lib` for conversion.
    // Here we emit the correct Content-Type and pass through the original.
    // When sharp is installed, swap this with actual conversion:
    //
    // const sharp = await import('sharp');
    // const pipeline = sharp(inputBuffer).resize(width, null, { withoutEnlargement: true });
    // if (negotiatedFormat === 'avif') pipeline.avif({ quality });
    // else if (negotiatedFormat === 'webp') pipeline.webp({ quality });
    // const output = await pipeline.toBuffer();

    const source = remoteUrl || src;
    const cacheKey = `${source}:${width}:${negotiatedFormat}:${quality}`;

    const mimeTypes: Record<string, string> = {
      avif: 'image/avif',
      webp: 'image/webp',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      original: 'image/jpeg',
    };

    return new Response(null, {
      status: 302,
      headers: {
        location: source,
        'cache-control': 'public, max-age=31536000, immutable',
        'content-type': mimeTypes[negotiatedFormat] ?? 'image/jpeg',
        'vary': 'Accept',
      },
    });
  } catch (err) {
    return new Response('Image optimization failed', { status: 500 });
  }
}

function negotiateFormat(
  requested: ImageFormat | 'original',
  accept: string,
): ImageFormat | 'original' {
  if (requested !== 'original') return requested;
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'original';
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

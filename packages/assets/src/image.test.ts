import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  renderImage,
  Image,
  imageUrl,
  getImageDimensions,
  getBlurDataURL,
  renderImagePreloadLink,
} from './image.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const TMP_DIR = join(process.cwd(), 'tmp-test-assets');

async function createTestImage(filename: string, width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
  const path = join(TMP_DIR, filename);
  await writeFile(path, buf);
  return path;
}

describe('renderImage', () => {
  it('emits <picture> with AVIF and WebP sources', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720 });
    expect(html).toContain('<picture');
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('<img');
    expect(html).toContain('alt="Hero"');
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="720"');
  });

  it('omits width/height when fill is true', () => {
    const html = renderImage({ src: '/bg.jpg', alt: 'Background', fill: true });
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
    expect(html).toContain('position:absolute');
    expect(html).toContain('object-fit:cover');
  });

  it('supports custom objectFit and objectPosition in fill mode', () => {
    const html = renderImage({
      src: '/bg.jpg',
      alt: 'Background',
      fill: true,
      objectFit: 'contain',
      objectPosition: 'top left',
    });
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('object-position:top left');
  });

  it('emits plain <img> when unoptimized is true', () => {
    const html = renderImage({ src: '/logo.svg', alt: 'Logo', width: 200, height: 200, unoptimized: true });
    expect(html).not.toContain('<picture');
    expect(html).toContain('<img');
    expect(html).toContain('src="/logo.svg"');
    expect(html).not.toContain('/_nexus/image');
  });

  it('includes width/height on unoptimized when not fill', () => {
    const html = renderImage({ src: '/logo.svg', alt: 'Logo', width: 200, height: 200, unoptimized: true });
    expect(html).toContain('width="200"');
    expect(html).toContain('height="200"');
  });

  it('omits width/height on unoptimized when fill', () => {
    const html = renderImage({ src: '/logo.svg', alt: 'Logo', unoptimized: true, fill: true });
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
    expect(html).toContain('position:absolute');
  });

  it('sets eager loading and high fetchpriority when priority is true', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720, priority: true });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('decoding="sync"');
  });

  it('sets lazy loading by default', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720 });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('includes round style when round is true', () => {
    const html = renderImage({ src: '/avatar.jpg', alt: 'Avatar', size: 64, round: true });
    expect(html).toContain('border-radius:50%');
  });

  it('includes custom class attribute', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720, class: 'my-img' });
    expect(html).toContain('class="my-img"');
  });

  it('supports size shorthand', () => {
    const html = renderImage({ src: '/icon.jpg', alt: 'Icon', size: 64 });
    expect(html).toContain('width="64"');
    expect(html).toContain('height="64"');
  });

  it('escapes alt text with quotes', () => {
    const html = renderImage({ src: '/x.jpg', alt: 'A "great" photo', width: 100, height: 100 });
    expect(html).toContain('alt="A &quot;great&quot; photo"');
  });

  it('applies additional inline style', () => {
    const html = renderImage({ src: '/x.jpg', alt: 'X', width: 100, height: 100, style: 'border:1px solid red;' });
    expect(html).toContain('border:1px solid red;');
  });

  it('generates blur placeholder when blurDataURL is provided', () => {
    const html = renderImage({
      src: '/hero.jpg',
      alt: 'Hero',
      width: 1280,
      height: 720,
      blurDataURL: 'data:image/jpeg;base64,abc123',
    });
    expect(html).toContain('data-nx-blur');
    expect(html).toContain('background-image:url("data:image/jpeg;base64,abc123")');
    expect(html).toContain('opacity:0');
  });

  it('falls back to solid background when blurDataURL is missing', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720 });
    expect(html).toContain('data-nx-blur');
    expect(html).toContain('background:var(--nx-img-blur,#e8e8e8)');
  });

  it('can disable placeholder', () => {
    const html = renderImage({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720, placeholder: 'none' });
    expect(html).not.toContain('data-nx-blur');
  });
});

describe('Image alias', () => {
  it('is the same function as renderImage', () => {
    expect(Image).toBe(renderImage);
  });
});

describe('imageUrl', () => {
  it('builds local optimized URL with format', () => {
    const url = imageUrl('/photo.jpg', 800, 'webp', 85);
    expect(url).toBe('/_nexus/image?src=%2Fphoto.jpg&w=800&f=webp&q=85');
  });

  it('builds local original URL without format param', () => {
    const url = imageUrl('/photo.jpg', 800, 'original', 85);
    expect(url).toBe('/_nexus/image?src=%2Fphoto.jpg&w=800&q=85');
  });

  it('builds remote URL with url param', () => {
    const url = imageUrl('https://example.com/img.jpg', 640, 'avif', 80);
    expect(url).toBe('/_nexus/image?url=https%3A%2F%2Fexample.com%2Fimg.jpg&w=640&f=avif&q=80');
  });
});

describe('renderImagePreloadLink', () => {
  it('generates preload link for optimized image', () => {
    const link = renderImagePreloadLink({ src: '/hero.jpg', alt: 'Hero', width: 1280, height: 720, priority: true });
    expect(link).toContain('<link rel="preload" as="image"');
    expect(link).toContain('/_nexus/image');
  });

  it('generates preload link for unoptimized image', () => {
    const link = renderImagePreloadLink({ src: '/logo.svg', alt: 'Logo', unoptimized: true });
    expect(link).toBe('<link rel="preload" as="image" href="/logo.svg">');
  });
});

describe('getImageDimensions', () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await createTestImage('test-400x300.jpg', 400, 300);
  });

  afterAll(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it('reads width and height from a JPEG', async () => {
    const dims = await getImageDimensions('/test-400x300.jpg', TMP_DIR);
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(300);
  });

  it('throws on invalid path', async () => {
    await expect(getImageDimensions('/../escape.jpg', TMP_DIR)).rejects.toThrow('Invalid image path');
  });
});

describe('getBlurDataURL', () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await createTestImage('blur-test.jpg', 200, 200);
  });

  afterAll(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it('returns a base64 data URI', async () => {
    const uri = await getBlurDataURL('/blur-test.jpg', TMP_DIR);
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(uri.length).toBeGreaterThan(100);
  });

  it('throws on invalid path', async () => {
    await expect(getBlurDataURL('/../escape.jpg', TMP_DIR)).rejects.toThrow('Invalid image path');
  });
});

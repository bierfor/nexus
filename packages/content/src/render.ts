import { marked, type Tokens } from 'marked';
import type { RenderOptions, HeadingEntry } from './types.js';
import { sanitizeHTML } from './sanitize.js';
import { highlightCode } from './highlight.js';
import { escapeHtml, escapeAttr, slugify, unescapeHtml } from './utils.js';

interface RendererOptions {
  headings: HeadingEntry[];
  /** If true, code blocks are wrapped with data-lang for post-process highlighting */
  wrapForHighlight?: boolean;
}

function createRenderer(opts: RendererOptions): any {
  const { headings, wrapForHighlight } = opts;
  const renderer = new marked.Renderer();

  renderer.heading = (token: Tokens.Heading): string => {
    const text = typeof token.text === 'string' ? token.text : String(token.text ?? '');
    const id = slugify(text);
    headings.push({ level: token.depth, text, id });
    return `<h${token.depth} id="${escapeAttr(id)}">${text}</h${token.depth}>`;
  };

  renderer.code = (token: Tokens.Code): string => {
    const lang = token.lang || '';
    const code = escapeHtml(token.text);
    const langClass = lang ? ` class="language-${escapeAttr(lang)}"` : '';
    if (wrapForHighlight) {
      return `<pre data-lang="${escapeAttr(lang)}"><code${langClass}>${code}</code></pre>`;
    }
    return `<pre><code${langClass}>${code}</code></pre>`;
  };

  renderer.codespan = (token: Tokens.Codespan): string => {
    return `<code>${escapeHtml(token.text)}</code>`;
  };

  renderer.link = (token: Tokens.Link): string => {
    const href = escapeAttr(token.href);
    const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
    const text = typeof token.text === 'string' ? token.text : String(token.text ?? '');
    return `<a href="${href}"${title}>${text}</a>`;
  };

  renderer.image = (token: Tokens.Image): string => {
    const src = escapeAttr(token.href);
    const alt = escapeHtml(token.text ?? '');
    const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
    return `<img src="${src}" alt="${alt}"${title} />`;
  };

  return renderer;
}

/**
 * Render Markdown string to sanitized HTML (synchronous, no syntax highlighting).
 */
export function renderMarkdown(
  md: string,
  opts: RenderOptions & { extractHeadings?: boolean } = {}
): { html: string; headings: HeadingEntry[] } {
  const headings: HeadingEntry[] = [];
  const renderer = createRenderer({ headings, wrapForHighlight: false });

  const html = marked.parse(md, { renderer, gfm: true, async: false }) as string;
  const clean = opts.sanitize === false ? html : sanitizeHTML(html, opts);

  return {
    html: clean,
    headings: opts.extractHeadings !== false ? headings : [],
  };
}

/**
 * Render Markdown string to sanitized HTML with async syntax highlighting (shiki).
 * Falls back to plain code blocks if shiki is not installed.
 */
export async function renderMarkdownAsync(
  md: string,
  opts: RenderOptions & { extractHeadings?: boolean; highlight?: boolean } = {}
): Promise<{ html: string; headings: HeadingEntry[] }> {
  const headings: HeadingEntry[] = [];
  const useHighlight = opts.highlight === true;

  const renderer = createRenderer({ headings, wrapForHighlight: useHighlight });
  let html = await marked.parse(md, { renderer, gfm: true, async: true });

  if (useHighlight) {
    html = await highlightBlocks(html);
  }

  const clean = opts.sanitize === false ? html : sanitizeHTML(html, opts);

  return {
    html: clean,
    headings: opts.extractHeadings !== false ? headings : [],
  };
}

async function highlightBlocks(html: string): Promise<string> {
  const blockPattern = /<pre data-lang="([^"]*)\"><code(?: class="language-[^"]*")?>([\s\S]*?)<\/code><\/pre>/g;
  const promises: Promise<void>[] = [];
  const replacements: { start: number; end: number; html: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null) {
    const lang = match[1]!;
    const rawCode = unescapeHtml(match[2]!);
    const start = match.index;
    const end = start + match[0].length;

    promises.push(
      highlightCode(rawCode, lang).then((hl) => {
        replacements.push({ start, end, html: hl });
      })
    );
  }

  await Promise.all(promises);

  // Replace from end to start to preserve indices
  let result = html;
  replacements
    .sort((a, b) => b.start - a.start)
    .forEach((r) => {
      result = result.slice(0, r.start) + r.html + result.slice(r.end);
    });

  return result;
}

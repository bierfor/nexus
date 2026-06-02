// Core types for @nexus_js/content

export interface ContentEntry {
  /** Original raw content (Markdown) */
  raw: string;
  /** Rendered HTML */
  html: string;
  /** Parsed frontmatter */
  meta: Record<string, unknown>;
  /** Table of contents headings */
  headings: HeadingEntry[];
  /** Locale that was resolved, or default */
  locale: string;
  /** Resolved file path */
  filePath: string;
}

export interface HeadingEntry {
  level: number;
  text: string;
  id: string;
}

export interface RenderOptions {
  /** Sanitize HTML output. Default: 'strict' */
  sanitize?: 'strict' | 'permissive' | false;
  /** Strip <script> tags. Default: true */
  stripScripts?: boolean;
  /** Whitelist of allowed HTML tags (strict mode) */
  allowedTags?: string[];
  /** Map of allowed attributes per tag */
  allowedAttributes?: Record<string, string[]>;
  /** CSP nonce to inject into allowed <style> tags */
  cspNonce?: string;
  /** Base URL for resolving relative href/src */
  baseUrl?: string;
}

export interface LoadContentOptions extends RenderOptions {
  /** Locale preference for i18n fallback (e.g. 'es') */
  locale?: string | undefined;
  /** Default locale if requested not found. Default: 'en' */
  defaultLocale?: string;
  /** Base directory for content files. Default: 'src/content' */
  contentDir?: string;
  /** Extract headings for TOC. Default: true */
  extractHeadings?: boolean;
  /** Include raw markdown in result. Default: false */
  includeRaw?: boolean;
}

export interface CollectionItem<TMeta = Record<string, unknown>> {
  slug: string;
  html: string;
  meta: TMeta;
  headings: HeadingEntry[];
  locale: string;
  filePath: string;
}

export interface CollectionOptions<TMeta = Record<string, unknown>> {
  name: string;
  dir: string;
  defaultLocale?: string;
  locales?: string[];
  schema?: TMeta;
}

export interface I18nOptions {
  locales: readonly string[];
  defaultLocale: string;
  messages?: Record<string, Record<string, string>>;
  messagesDir?: string;
  strategy?: 'querystring' | 'cookie' | 'header' | 'pathname';
  cookieName?: string;
  queryParam?: string;
}

export interface ResolveLocaleContext {
  url?: string | URL;
  req?: { headers?: Record<string, string | string[]> };
  getCookie?: (name: string) => string | undefined;
}

export interface HlOptions {
  theme?: string;
  langs?: string[];
  className?: string;
}

export interface ContentWatcherOptions {
  contentDir: string;
  onChange: (event: 'change' | 'rename', filename: string) => void;
  debounceMs?: number;
}

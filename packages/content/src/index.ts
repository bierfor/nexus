// @nexus_js/content — first-class Markdown and rich content for Nexus

export { interpolate } from './interpolate.js';
export { loadContent } from './load-content.js';
export { renderMarkdown, renderMarkdownAsync } from './render.js';
export { sanitizeHTML } from './sanitize.js';
export { parseFrontmatter } from './frontmatter.js';
export { defineCollection } from './collection.js';
export { defineI18n } from './i18n.js';
export { highlightCode } from './highlight.js';
export { watchContent, stopAllWatchers } from './watch.js';
export { formatDate, formatRelative } from './format-date.js';

export type {
  ContentEntry,
  HeadingEntry,
  RenderOptions,
  LoadContentOptions,
  CollectionItem,
  CollectionOptions,
  I18nOptions,
  ResolveLocaleContext,
  HlOptions,
  ContentWatcherOptions,
} from './types.js';

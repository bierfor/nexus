import type { ResolveLocaleContext, I18nOptions } from './types.js';
import { interpolate } from './interpolate.js';

/**
 * Minimal type-safe i18n helper designed to integrate with Nexus load()/pretext.
 *
 * Supports:
 * - Locale resolution from querystring / cookie / Accept-Language header
 * - Simple variable interpolation: t('hello', { name: 'Nexus' })
 * - ICU-style plurals: t('items', { count: 3 })
 *   where message is: "{count, plural, one {One item} other {{count} items}}"
 *
 * Example:
 *   const i18n = defineI18n({
 *     locales: ['en', 'es', 'pt'],
 *     defaultLocale: 'en',
 *     messages: { en: { hello: 'Hi {name}', items: '{count} item(s)' }, ... }
 *   });
 */
export function defineI18n(opts: I18nOptions) {
  const {
    locales,
    defaultLocale,
    messages = {},
    strategy = 'querystring',
    cookieName = 'nx_lang',
    queryParam = 'lang',
  } = opts;

  const localeSet = new Set(locales);

  function resolveLocale(ctx: ResolveLocaleContext): string {
    if (strategy === 'querystring' || strategy === 'pathname') {
      try {
        const urlStr = ctx.url?.toString() || '';
        const url = new URL(urlStr, 'http://localhost');
        const param = url.searchParams.get(queryParam);
        if (param && localeSet.has(param)) return param;
      } catch { /* noop */ }
    }

    if (strategy === 'cookie' || strategy === 'querystring') {
      try {
        const cookieVal = ctx.getCookie?.(cookieName);
        if (cookieVal && localeSet.has(cookieVal)) return cookieVal;
      } catch { /* noop */ }
    }

    if (strategy === 'header' || strategy === 'querystring') {
      try {
        const accept = ctx.req?.headers?.['accept-language'];
        const raw = Array.isArray(accept) ? accept[0] : accept;
        if (raw) {
          const preferred = raw.split(',')[0]?.trim().slice(0, 2);
          if (preferred && localeSet.has(preferred)) return preferred;
        }
      } catch { /* noop */ }
    }

    return defaultLocale;
  }

  function t(
    locale: string,
    key: string,
    varsOrFallback?: Record<string, string | number> | string
  ): string {
    const dict = messages[locale] || {};
    const defaultDict = messages[defaultLocale] || {};
    const template = dict[key] ?? defaultDict[key] ?? key;

    if (typeof varsOrFallback === 'string') {
      // Back-compat: third arg was fallback string
      return template === key ? varsOrFallback : template;
    }

    return interpolate(template, varsOrFallback ?? {});
  }

  function tFn(
    locale: string
  ): (key: string, vars?: Record<string, string | number>) => string {
    return (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  }

  function langHref(urlStr: string, locale: string): string {
    try {
      const url = new URL(urlStr, 'http://localhost');
      url.searchParams.set(queryParam, locale);
      return url.pathname + url.search;
    } catch {
      return urlStr;
    }
  }

  return {
    locales,
    defaultLocale,
    resolveLocale,
    t,
    tFn,
    langHref,
  };
}

import { describe, it, expect } from 'vitest';
import { defineI18n } from './i18n.js';

describe('defineI18n', () => {
  const i18n = defineI18n({
    locales: ['en', 'es', 'pt'],
    defaultLocale: 'en',
    messages: {
      en: {
        hello: 'Hello {name}',
        items: '{count, plural, one {One item} other {{count} items}}',
        world: 'World',
      },
      es: {
        hello: 'Hola {name}',
        items: '{count, plural, one {Un elemento} other {{count} elementos}}',
      },
    },
  });

  it('resolves locale from querystring', () => {
    const ctx = { url: 'http://localhost/?lang=es' };
    expect(i18n.resolveLocale(ctx)).toBe('es');
  });

  it('resolves locale from cookie', () => {
    const ctx = { getCookie: (name: string) => name === 'nx_lang' ? 'pt' : undefined };
    expect(i18n.resolveLocale(ctx)).toBe('pt');
  });

  it('resolves locale from Accept-Language header', () => {
    const ctx = { req: { headers: { 'accept-language': 'es-ES,es;q=0.9' } } };
    expect(i18n.resolveLocale(ctx)).toBe('es');
  });

  it('falls back to defaultLocale', () => {
    const ctx = { url: 'http://localhost/' };
    expect(i18n.resolveLocale(ctx)).toBe('en');
  });

  it('translates with variable interpolation', () => {
    expect(i18n.t('en', 'hello', { name: 'Nexus' })).toBe('Hello Nexus');
    expect(i18n.t('es', 'hello', { name: 'Nexus' })).toBe('Hola Nexus');
  });

  it('falls back to default locale when key missing', () => {
    expect(i18n.t('pt', 'world')).toBe('World');
  });

  it('supports fallback string (back-compat)', () => {
    expect(i18n.t('pt', 'missingKey', 'Fallback')).toBe('Fallback');
  });

  it('supports ICU plural one', () => {
    expect(i18n.t('en', 'items', { count: 1 })).toBe('One item');
    expect(i18n.t('es', 'items', { count: 1 })).toBe('Un elemento');
  });

  it('supports ICU plural other', () => {
    expect(i18n.t('en', 'items', { count: 5 })).toBe('5 items');
    expect(i18n.t('es', 'items', { count: 5 })).toBe('5 elementos');
  });

  it('tFn returns a bound translator', () => {
    const t = i18n.tFn('es');
    expect(t('hello', { name: 'Mundo' })).toBe('Hola Mundo');
  });

  it('langHref appends query param', () => {
    expect(i18n.langHref('/docs', 'es')).toBe('/docs?lang=es');
  });
});

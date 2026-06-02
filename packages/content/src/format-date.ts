/**
 * Format dates with locale support and relative display.
 *
 * Designed to work alongside defineI18n — pass the resolved locale
 * to get localized month names, timeago, etc.
 */

const LOCALE_MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June',
       'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
       'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
       'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
};

const RELATIVE_UNITS: Record<string, { en: string[]; es: string[]; pt: string[] }> = {
  year:   { en: ['year', 'years'],   es: ['año', 'años'],     pt: ['ano', 'anos'] },
  month:  { en: ['month', 'months'], es: ['mes', 'meses'],    pt: ['mês', 'meses'] },
  day:    { en: ['day', 'days'],     es: ['día', 'días'],     pt: ['dia', 'dias'] },
  hour:   { en: ['hour', 'hours'],   es: ['hora', 'horas'],   pt: ['hora', 'horas'] },
  minute: { en: ['min', 'mins'],     es: ['min', 'mins'],     pt: ['min', 'mins'] },
  second: { en: ['sec', 'secs'],     es: ['seg', 'segs'],     pt: ['seg', 'segs'] },
};

export interface FormatDateOptions {
  locale?: string;
  /** 'long' = "1 de enero de 2026", 'short' = "01/01/2026", 'iso' = "2026-01-01" */
  format?: 'long' | 'short' | 'iso';
  /** Show relative time: "hace 5 minutos" / "5 minutes ago" */
  relative?: boolean;
  /** Custom fallback string when date is invalid */
  fallback?: string;
}

/**
 * Format a date string or Date object according to locale and options.
 *
 * Example:
 *   formatDate(new Date(), { locale: 'es', format: 'long' })
 *   → "3 de julio de 2026"
 *
 *   formatDate('2026-07-03T12:00:00Z', { locale: 'en', relative: true })
 *   → "a few seconds ago"
 */
export function formatDate(
  input: string | number | Date,
  opts: FormatDateOptions = {}
): string {
  const { locale = 'en', format = 'long', relative = false, fallback = '' } = opts;
  const date = input instanceof Date ? input : new Date(input);

  if (isNaN(date.getTime())) return fallback;

  if (relative) {
    return formatRelative(date, locale);
  }

  if (format === 'iso') {
    return date.toISOString().slice(0, 10);
  }

  if (format === 'short') {
    return date.toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  // long format with localized month
  const day = date.getDate();
  const year = date.getFullYear();
  const monthList = LOCALE_MONTHS[locale] || LOCALE_MONTHS.en;
  if (!monthList) return fallback;
  const monthName = monthList[date.getMonth()] ?? '';

  if (locale === 'es' || locale === 'pt') {
    return `${day} de ${monthName} de ${year}`;
  }

  return `${monthName} ${day}, ${year}`;
}

/**
 * Format relative time (timeago) with locale.
 *
 * Example:
 *   formatRelative(new Date(Date.now() - 1000 * 60 * 5), 'es')
 *   → "hace 5 mins"
 */
export function formatRelative(date: Date, locale: string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 0) {
    // Future
    return formatRelativeFuture(Math.abs(diffSec), locale);
  }

  // Past
  return formatRelativePast(diffSec, locale);
}

function formatRelativePast(seconds: number, locale: string): string {
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000,  'month'],
    [86400,    'day'],
    [3600,     'hour'],
    [60,       'minute'],
  ];

  for (const [limit, unit] of units) {
    if (seconds >= limit) {
      const count = Math.floor(seconds / limit);
      return makeRelativePhrase(count, unit, locale, 'past');
    }
  }

  if (seconds < 10) return getLiteral('justNow', locale);
  return makeRelativePhrase(Math.floor(seconds), 'second', locale, 'past');
}

function formatRelativeFuture(seconds: number, locale: string): string {
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000,  'month'],
    [86400,    'day'],
    [3600,     'hour'],
    [60,       'minute'],
  ];

  for (const [limit, unit] of units) {
    if (seconds >= limit) {
      const count = Math.floor(seconds / limit);
      return makeRelativePhrase(count, unit, locale, 'future');
    }
  }

  return makeRelativePhrase(Math.floor(seconds), 'second', locale, 'future');
}

function makeRelativePhrase(
  count: number,
  unit: string,
  locale: string,
  direction: 'past' | 'future'
): string {
  const units = RELATIVE_UNITS[unit];
  if (!units) return String(count);

  const u = count === 1 ? units[locale as keyof typeof units]?.[0] : units[locale as keyof typeof units]?.[1];
  const unitStr = u || (count === 1 ? units.en[0] : units.en[1]);

  if (locale === 'es' || locale === 'pt') {
    return direction === 'past'
      ? `hace ${count} ${unitStr}`
      : `en ${count} ${unitStr}`;
  }

  return direction === 'past'
    ? `${count} ${unitStr} ago`
    : `in ${count} ${unitStr}`;
}

function getLiteral(key: string, locale: string): string {
  const literals: Record<string, Record<string, string>> = {
    justNow: { en: 'just now', es: 'hace un momento', pt: 'agora mesmo' },
  };
  return literals[key]?.[locale] || literals[key]?.en || '';
}

import { describe, it, expect } from 'vitest';
import { formatDate, formatRelative } from './format-date.js';

describe('formatDate', () => {
  const testDate = new Date(2026, 6, 3, 14, 30, 0); // July 3, 2026

  it('formats long date in en', () => {
    const result = formatDate(testDate, { locale: 'en', format: 'long' });
    expect(result).toBe('July 3, 2026');
  });

  it('formats long date in es', () => {
    const result = formatDate(testDate, { locale: 'es', format: 'long' });
    expect(result).toBe('3 de julio de 2026');
  });

  it('formats short date', () => {
    const result = formatDate(testDate, { locale: 'en', format: 'short' });
    expect(result).toMatch(/07\/.+2026/);
  });

  it('formats iso date', () => {
    const result = formatDate(testDate, { locale: 'en', format: 'iso' });
    expect(result).toBe('2026-07-03');
  });

  it('handles string input', () => {
    const result = formatDate('2026-07-03T00:00:00Z', { locale: 'en', format: 'iso' });
    expect(result).toBe('2026-07-03');
  });

  it('returns fallback for invalid date', () => {
    const result = formatDate('not-a-date', { fallback: 'Invalid' });
    expect(result).toBe('Invalid');
  });
});

describe('formatRelative', () => {
  it('formats just now', () => {
    const now = new Date();
    const result = formatRelative(now, 'en');
    expect(result).toBe('just now');
  });

  it('formats minutes ago in es', () => {
    const date = new Date(Date.now() - 1000 * 60 * 5);
    const result = formatRelative(date, 'es');
    expect(result).toBe('hace 5 mins');
  });

  it('formats hours ago', () => {
    const date = new Date(Date.now() - 1000 * 60 * 60 * 3);
    const result = formatRelative(date, 'en');
    expect(result).toBe('3 hours ago');
  });

  it('formats days ago in pt', () => {
    const date = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);
    const result = formatRelative(date, 'pt');
    expect(result).toBe('hace 2 dias');
  });
});

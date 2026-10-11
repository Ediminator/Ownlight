import { describe, it, expect } from 'vitest';
import {
  ISO_3166_1_ALPHA_2_CODES,
  getLocalizedCountries,
  getLocalizedCountryName,
} from '@/lib/countries';
import { parseTagsString, formatTagsString } from '@/lib/tags';
import { isValidCountryCode } from '@/server/clients/schema';

describe('ISO 3166-1 alpha-2 country utilities', () => {
  it('AC-7: contains exactly 249 valid ISO 3166-1 alpha-2 country codes', () => {
    expect(ISO_3166_1_ALPHA_2_CODES).toHaveLength(249);
    for (const code of ISO_3166_1_ALPHA_2_CODES) {
      expect(isValidCountryCode(code)).toBe(true);
    }
  });

  it('AC-7: provides localized country list in English sorted alphabetically', () => {
    const list = getLocalizedCountries('en');
    expect(list.length).toBe(249);
    const deEntry = list.find((c) => c.code === 'DE');
    expect(deEntry?.name).toBe('Germany');

    // Verify alphabetical sort
    for (let i = 0; i < list.length - 1; i++) {
      const current = list[i]?.name ?? '';
      const next = list[i + 1]?.name ?? '';
      expect(current.localeCompare(next, 'en')).toBeLessThanOrEqual(0);
    }
  });

  it('AC-7: provides localized country list in German sorted alphabetically', () => {
    const list = getLocalizedCountries('de');
    expect(list.length).toBe(249);
    const deEntry = list.find((c) => c.code === 'DE');
    expect(deEntry?.name).toBe('Deutschland');

    for (let i = 0; i < list.length - 1; i++) {
      const current = list[i]?.name ?? '';
      const next = list[i + 1]?.name ?? '';
      expect(current.localeCompare(next, 'de')).toBeLessThanOrEqual(0);
    }
  });

  it('AC-7: resolves single country code to name in en and de', () => {
    expect(getLocalizedCountryName('DE', 'en')).toBe('Germany');
    expect(getLocalizedCountryName('DE', 'de')).toBe('Deutschland');
    expect(getLocalizedCountryName('FR', 'en')).toBe('France');
    expect(getLocalizedCountryName('FR', 'de')).toBe('Frankreich');
  });
});

describe('Comma-separated tag parsing and serialization', () => {
  it('AC-8: parses comma-separated tag string correctly trimming whitespace', () => {
    expect(parseTagsString('Wedding, 2026')).toEqual(['Wedding', '2026']);
    expect(parseTagsString('  Portrait ,  Studio , VIP  ')).toEqual(['Portrait', 'Studio', 'VIP']);
    expect(parseTagsString('')).toEqual([]);
    expect(parseTagsString(',,,')).toEqual([]);
  });

  it('AC-8: formats tag objects and strings into comma-separated list', () => {
    expect(formatTagsString([{ name: 'Wedding' }, { name: '2026' }])).toBe('Wedding, 2026');
    expect(formatTagsString(['Wedding', '2026'])).toBe('Wedding, 2026');
    expect(formatTagsString([])).toBe('');
  });
});

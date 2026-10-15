import { describe, it, expect } from 'vitest';
import { convertPriceMajorToMinor, convertPriceMinorToMajorString } from '@/lib/currency';

describe('lib/currency.ts unit tests', () => {
  describe('convertPriceMajorToMinor', () => {
    it('returns undefined for null or undefined input', () => {
      expect(convertPriceMajorToMinor(null)).toBeUndefined();
      expect(convertPriceMajorToMinor(undefined)).toBeUndefined();
    });

    it('returns undefined for empty or whitespace-only string', () => {
      expect(convertPriceMajorToMinor('')).toBeUndefined();
      expect(convertPriceMajorToMinor('   ')).toBeUndefined();
    });

    it('returns undefined for NaN, negative, or infinite values', () => {
      expect(convertPriceMajorToMinor('abc')).toBeUndefined();
      expect(convertPriceMajorToMinor('-100')).toBeUndefined();
      expect(convertPriceMajorToMinor(-50)).toBeUndefined();
      expect(convertPriceMajorToMinor(Infinity)).toBeUndefined();
      expect(convertPriceMajorToMinor(-Infinity)).toBeUndefined();
    });

    it('converts number inputs accurately', () => {
      expect(convertPriceMajorToMinor(2500)).toBe(250000);
      expect(convertPriceMajorToMinor(0)).toBe(0);
      expect(convertPriceMajorToMinor(12.34)).toBe(1234);
    });

    it('converts string inputs with dots or commas', () => {
      expect(convertPriceMajorToMinor('2500.50')).toBe(250050);
      expect(convertPriceMajorToMinor('2500,50')).toBe(250050);
      expect(convertPriceMajorToMinor('0.99')).toBe(99);
      expect(convertPriceMajorToMinor('0')).toBe(0);
    });

    it('handles custom currencies with different fraction digits if supported', () => {
      expect(convertPriceMajorToMinor('100.50', 'EUR')).toBe(10050);
      expect(convertPriceMajorToMinor('100', 'JPY')).toBe(100);
    });
  });

  describe('convertPriceMinorToMajorString', () => {
    it('returns empty string for null or undefined', () => {
      expect(convertPriceMinorToMajorString(null)).toBe('');
      expect(convertPriceMinorToMajorString(undefined)).toBe('');
    });

    it('formats minor integer units to major units string with 2 decimal places by default', () => {
      expect(convertPriceMinorToMajorString(250050)).toBe('2500.50');
      expect(convertPriceMinorToMajorString(0)).toBe('0.00');
      expect(convertPriceMinorToMajorString(99)).toBe('0.99');
    });

    it('formats zero-decimal currencies like JPY appropriately', () => {
      expect(convertPriceMinorToMajorString(2500, 'JPY')).toBe('2500');
    });
  });
});

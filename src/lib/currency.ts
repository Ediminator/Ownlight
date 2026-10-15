import { getCurrencyFractionDigits } from './formatters';

/**
 * Converts a major currency string or number (e.g. "2500.50" or "2500,50" or 2500)
 * into an integer minor unit representation (e.g. 250050 cents).
 * Returns undefined if input is empty, null, undefined, or invalid.
 */
export function convertPriceMajorToMinor(
  value: string | number | null | undefined,
  currency = 'EUR',
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  let num: number;
  if (typeof value === 'number') {
    num = value;
  } else {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const normalized = trimmed.replace(',', '.');
    num = parseFloat(normalized);
  }

  if (Number.isNaN(num) || num < 0 || !Number.isFinite(num)) {
    return undefined;
  }

  const fractionDigits = getCurrencyFractionDigits(currency);
  const factor = Math.pow(10, fractionDigits);
  return Math.round(num * factor);
}

/**
 * Converts integer minor units (e.g. 250050) back to a major units string for input fields (e.g. "2500.50").
 */
export function convertPriceMinorToMajorString(
  minorUnits: number | null | undefined,
  currency = 'EUR',
): string {
  if (minorUnits === null || minorUnits === undefined) {
    return '';
  }
  const fractionDigits = getCurrencyFractionDigits(currency);
  const factor = Math.pow(10, fractionDigits);
  return (minorUnits / factor).toFixed(fractionDigits);
}

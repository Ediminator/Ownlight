/**
 * Utilities for URL slug generation and validation.
 */

/**
 * Converts a title or label into a valid lowercase kebab-case slug.
 * Handles German umlauts, trims whitespace, removes invalid characters,
 * normalizes consecutive hyphens, and truncates to max 64 chars without
 * ending on a hyphen.
 */
export function generateSlug(input: string): string {
  if (!input) return '';

  let slug = input
    .trim()
    .toLowerCase()
    // German umlauts & special characters
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Remove diacritics
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Replace non-alphanumeric characters with hyphen
    .replace(/[^a-z0-9]+/g, '-')
    // Replace consecutive hyphens with single hyphen
    .replace(/-+/g, '-')
    // Trim leading and trailing hyphens
    .replace(/^-+|-+$/g, '');

  // Truncate to max 64 chars
  if (slug.length > 64) {
    slug = slug.slice(0, 64).replace(/-+$/, '');
  }

  return slug;
}

/**
 * Validates whether a slug matches the booking type slug constraints:
 * lowercase alphanumeric characters and hyphens, 2-64 chars, no leading/trailing
 * hyphens, no consecutive hyphens.
 */
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== 'string') return false;
  if (slug.length < 2 || slug.length > 64) return false;
  if (slug.startsWith('-') || slug.endsWith('-') || slug.includes('--')) return false;
  return /^[a-z0-9-]+$/.test(slug);
}

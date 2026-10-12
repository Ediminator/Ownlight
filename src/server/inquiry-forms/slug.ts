import crypto from 'node:crypto';

/**
 * RFC 4648 base32 alphabet in lowercase (32 symbols).
 * Characters: a-z (26) + 2-7 (6) = 32.
 */
export const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export const FORM_SLUG_REGEX = /^[a-z2-7]{10}$/;

/**
 * Generates an unguessable 10-character lowercase base32 form slug using cryptographically
 * secure random bytes (crypto.randomBytes).
 *
 * Each byte modulo 32 maps uniformly to the 32-character alphabet with zero modulo bias,
 * because 256 is an exact multiple of 32 (256 % 32 = 0).
 */
export function generateFormSlug(): string {
  const bytes = crypto.randomBytes(10);
  let slug = '';
  for (let i = 0; i < 10; i++) {
    const byte = bytes.readUInt8(i);
    const char = BASE32_ALPHABET.charAt(byte % 32);
    slug += char;
  }
  return slug;
}

/**
 * Validates whether a value matches the 10-character base32 form slug format.
 */
export function isFormSlug(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return FORM_SLUG_REGEX.test(value);
}

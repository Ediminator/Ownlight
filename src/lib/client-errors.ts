/**
 * Client error mapping helper for localized error messages.
 */

const KNOWN_CLIENT_ERROR_CODES = new Set([
  'VALIDATION_FAILED',
  'DUPLICATE_EMAIL',
  'LIMIT_EXCEEDED',
  'CLIENT_NEEDS_CONTACT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
]);

export function getClientErrorMessage(
  code: string | undefined,
  tErrors: (key: string) => string,
): string {
  if (code && KNOWN_CLIENT_ERROR_CODES.has(code)) {
    return tErrors(code);
  }
  return tErrors('GENERIC_ERROR');
}

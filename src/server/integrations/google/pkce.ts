import { randomBytes, createHash } from 'node:crypto';

export const CODE_CHALLENGE_METHOD = 'S256' as const;
export const GOOGLE_CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts' as const;
export { GOOGLE_CALENDAR_SCOPE } from './constants';

/**
 * Generates an RFC 7636 compliant high-entropy code verifier.
 * Minimum 43 characters, unreserved URL characters.
 */
export function generateCodeVerifier(): string {
  // 32 cryptographically random bytes = 43 base64url characters
  return randomBytes(32).toString('base64url');
}

/**
 * Computes the S256 code challenge for a given code verifier.
 * code_challenge = base64url(sha256(code_verifier))
 */
export function computeCodeChallenge(verifier: string): string {
  if (!verifier || typeof verifier !== 'string' || verifier.length < 43) {
    throw new Error('Code verifier must be at least 43 characters.');
  }

  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Generates a cryptographically secure 32-byte single-use state token.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

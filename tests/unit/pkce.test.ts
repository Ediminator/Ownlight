import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  computeCodeChallenge,
  generateOAuthState,
  CODE_CHALLENGE_METHOD,
  GOOGLE_CONTACTS_SCOPE,
} from '@/server/integrations/google/pkce';

describe('AC-3: PKCE and OAuth helpers', () => {
  it('AC-3: generates valid RFC 7636 code verifiers (min 43 chars, base64url charset)', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();

    expect(verifier1.length).toBeGreaterThanOrEqual(43);
    expect(verifier2.length).toBeGreaterThanOrEqual(43);
    expect(verifier1).not.toBe(verifier2);
    // Base64url characters only
    expect(verifier1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('AC-3: computes correct S256 code challenge matching RFC 7636 test vectors', () => {
    // RFC 7636 Appendix B test vector
    const testVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    const challenge = computeCodeChallenge(testVerifier);
    expect(challenge).toBe(expectedChallenge);
    expect(CODE_CHALLENGE_METHOD).toBe('S256');
  });

  it('AC-3: rejects short or invalid code verifiers', () => {
    expect(() => computeCodeChallenge('')).toThrow();
    expect(() => computeCodeChallenge('too_short')).toThrow();
  });

  it('AC-3: generates cryptographically random 32-byte state strings', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();

    expect(state1.length).toBeGreaterThanOrEqual(43);
    expect(state2.length).toBeGreaterThanOrEqual(43);
    expect(state1).not.toBe(state2);
    expect(state1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(GOOGLE_CONTACTS_SCOPE).toBe('https://www.googleapis.com/auth/contacts');
  });
});

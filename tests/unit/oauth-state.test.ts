import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createOAuthStateCookie,
  validateOAuthStateCookie,
  OAuthStateError,
  _resetUsedOAuthStatesForTesting,
  OAUTH_STATE_PURPOSE,
} from '@/server/integrations/google/state';
import { encryptSecret } from '@/server/crypto/vault';

describe('AC-5: Session-bound OAuth State & Replay Protection', () => {
  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const ownerUserId = '018f0000-0000-7000-8000-000000000001';
  const foreignUserId = '018f0000-0000-7000-8000-000000000002';
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = masterKey;
    _resetUsedOAuthStatesForTesting();
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    _resetUsedOAuthStatesForTesting();
  });

  it('AC-5: successfully validates legitimate state and extracts code verifier', async () => {
    const state = 'valid-test-state-token-12345';
    const codeVerifier = 'valid-test-pkce-verifier-123456789012345678901234567890';

    const cookieValue = await createOAuthStateCookie({
      state,
      codeVerifier,
      userId: ownerUserId,
    });

    const result = await validateOAuthStateCookie({
      cookieValue,
      callbackState: state,
      currentUserId: ownerUserId,
    });

    expect(result.codeVerifier).toBe(codeVerifier);
  });

  it('AC-5: rejects missing cookie or state parameter with HTTP 400 OAuthStateError', async () => {
    await expect(
      validateOAuthStateCookie({
        cookieValue: undefined,
        callbackState: 'some-state',
        currentUserId: ownerUserId,
      }),
    ).rejects.toThrow(OAuthStateError);

    await expect(
      validateOAuthStateCookie({
        cookieValue: 'some-cookie',
        callbackState: '',
        currentUserId: ownerUserId,
      }),
    ).rejects.toThrow(OAuthStateError);
  });

  it('AC-5: rejects state parameter mismatch', async () => {
    const cookieValue = await createOAuthStateCookie({
      state: 'expected-state',
      codeVerifier: 'verifier',
      userId: ownerUserId,
    });

    await expect(
      validateOAuthStateCookie({
        cookieValue,
        callbackState: 'tampered-or-different-state',
        currentUserId: ownerUserId,
      }),
    ).rejects.toThrow(OAuthStateError);
  });

  it('AC-5: rejects expired state (after 10 minutes)', async () => {
    // Construct expired state payload manually
    const expiredPayload = JSON.stringify({
      state: 'expired-state',
      codeVerifier: 'verifier',
      userId: ownerUserId,
      expiresAt: Date.now() - 1000, // 1 second ago
    });

    const cookieValue = await encryptSecret(expiredPayload, OAUTH_STATE_PURPOSE, masterKey);

    await expect(
      validateOAuthStateCookie({
        cookieValue,
        callbackState: 'expired-state',
        currentUserId: ownerUserId,
      }),
    ).rejects.toThrow(OAuthStateError);
  });

  it('AC-5: rejects foreign session state (initiated by user A, completed by user B)', async () => {
    const cookieValue = await createOAuthStateCookie({
      state: 'state-user-a',
      codeVerifier: 'verifier',
      userId: ownerUserId,
    });

    await expect(
      validateOAuthStateCookie({
        cookieValue,
        callbackState: 'state-user-a',
        currentUserId: foreignUserId,
      }),
    ).rejects.toThrow(OAuthStateError);
  });

  it('AC-5: rejects reused state on second attempt (replay prevention)', async () => {
    const state = 'single-use-state-token';
    const cookieValue = await createOAuthStateCookie({
      state,
      codeVerifier: 'verifier',
      userId: ownerUserId,
    });

    // First attempt succeeds
    const firstResult = await validateOAuthStateCookie({
      cookieValue,
      callbackState: state,
      currentUserId: ownerUserId,
    });
    expect(firstResult.codeVerifier).toBe('verifier');

    // Second attempt fails as reused state
    await expect(
      validateOAuthStateCookie({
        cookieValue,
        callbackState: state,
        currentUserId: ownerUserId,
      }),
    ).rejects.toThrow(OAuthStateError);
  });
});

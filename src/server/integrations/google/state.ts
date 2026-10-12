import 'server-only';
import { encryptSecret, decryptSecret } from '@/server/crypto/vault';

export const OAUTH_STATE_PURPOSE = 'ownlight:vault:oauth_state';
export const GOOGLE_OAUTH_STATE_COOKIE = 'ownlight_google_oauth_state';
export const SECURE_GOOGLE_OAUTH_STATE_COOKIE = '__Secure-ownlight_google_oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class OAuthStateError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  userId: string;
  expiresAt: number;
}

// Memory tracking of used states to prevent replay attacks
const usedStates = new Map<string, number>();

function pruneExpiredUsedStates(): void {
  const now = Date.now();
  for (const [state, expiresAt] of usedStates.entries()) {
    if (now > expiresAt) {
      usedStates.delete(state);
    }
  }
}

export function isOAuthStateUsed(state: string): boolean {
  pruneExpiredUsedStates();
  return usedStates.has(state);
}

export function markOAuthStateUsed(state: string, expiresAt: number): void {
  usedStates.set(state, expiresAt);
}

export function _resetUsedOAuthStatesForTesting(): void {
  usedStates.clear();
}

/**
 * Encrypts OAuth state, PKCE verifier, and owner user ID into an encrypted cookie value.
 */
export async function createOAuthStateCookie(params: {
  state: string;
  codeVerifier: string;
  userId: string;
  expiresAtOverride?: number;
  masterKeyOverride?: string;
}): Promise<string> {
  const payload: OAuthStatePayload = {
    state: params.state,
    codeVerifier: params.codeVerifier,
    userId: params.userId,
    expiresAt: params.expiresAtOverride ?? Date.now() + OAUTH_STATE_TTL_MS,
  };

  return encryptSecret(JSON.stringify(payload), OAUTH_STATE_PURPOSE, params.masterKeyOverride);
}

/**
 * Validates the encrypted OAuth state cookie against the callback request parameters.
 * Rejects missing, invalid, expired, reused, or foreign-session state with OAuthStateError (HTTP 400).
 */
export async function validateOAuthStateCookie(params: {
  cookieValue?: string | null;
  callbackState: string;
  currentUserId: string;
  masterKeyOverride?: string;
}): Promise<{ codeVerifier: string }> {
  if (!params.cookieValue) {
    throw new OAuthStateError('Missing OAuth state cookie.');
  }

  if (!params.callbackState) {
    throw new OAuthStateError('Missing state query parameter in OAuth callback.');
  }

  let decrypted: string;
  try {
    decrypted = await decryptSecret(
      params.cookieValue,
      OAUTH_STATE_PURPOSE,
      params.masterKeyOverride,
    );
  } catch {
    throw new OAuthStateError('Invalid or corrupted OAuth state cookie.');
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(decrypted) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError('Malformed OAuth state payload.');
  }

  // 1. Validate state matching
  if (payload.state !== params.callbackState) {
    throw new OAuthStateError('OAuth state mismatch.');
  }

  // 2. Validate expiration (10-minute expiry)
  if (Date.now() > payload.expiresAt) {
    throw new OAuthStateError('OAuth state has expired.');
  }

  // 3. Validate session-binding (foreign owner rejection)
  if (payload.userId !== params.currentUserId) {
    throw new OAuthStateError('OAuth state belongs to a different owner session.');
  }

  // 4. Validate replay prevention
  if (isOAuthStateUsed(payload.state)) {
    throw new OAuthStateError('OAuth state has already been used.');
  }

  markOAuthStateUsed(payload.state, payload.expiresAt);

  return { codeVerifier: payload.codeVerifier };
}

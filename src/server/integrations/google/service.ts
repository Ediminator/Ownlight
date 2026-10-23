import 'server-only';
import { env, isGoogleOAuthConfigured } from '@/env';
import { logger } from '@/server/log';
import { type DbClient } from '@/server/db/client';
import { decryptSecret } from '@/server/crypto/vault';
import { GOOGLE_CONTACTS_SCOPE, CODE_CHALLENGE_METHOD } from './pkce';
import {
  getGoogleAuthUrl,
  getGoogleTokenUrl,
  getGoogleRevokeUrl,
  GOOGLE_OAUTH_PURPOSE,
  hasGoogleCalendarScope,
} from './constants';
import { getGoogleOAuthToken, upsertGoogleOAuthToken } from './repo';

export class GoogleOAuthError extends Error {
  public readonly statusCode: number;
  public readonly isRetryable: boolean;

  constructor(message: string, statusCode = 400, isRetryable = false) {
    super(message);
    this.name = 'GoogleOAuthError';
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export type IntegrationStatus = 'unconfigured' | 'disconnected' | 'connected';

export interface GoogleIntegrationDetails {
  status: IntegrationStatus;
  configured: boolean;
  connected: boolean;
  connectedAt?: Date | null;
  scope?: string | null;
  failedSyncCount?: number;
  calendarSyncEnabled?: boolean;
  selectedCalendarId?: string | null;
  lastCalendarSyncAt?: Date | null;
  lastCalendarSyncError?: string | null;
  hasCalendarScope?: boolean;
}

/**
 * Returns current status of Google Workspace integration.
 */
export async function getGoogleIntegrationStatus(
  client?: DbClient,
): Promise<GoogleIntegrationDetails> {
  const configured = isGoogleOAuthConfigured();
  if (!configured) {
    return {
      status: 'unconfigured',
      configured: false,
      connected: false,
      failedSyncCount: 0,
    };
  }

  const { getFailedOutboxCount } = await import('./outbox');
  const failedSyncCount = await getFailedOutboxCount(client);

  const tokenRecord = await getGoogleOAuthToken(client);
  if (!tokenRecord) {
    return {
      status: 'disconnected',
      configured: true,
      connected: false,
      failedSyncCount,
    };
  }

  const hasCalendarScope = hasGoogleCalendarScope(tokenRecord.scope);

  return {
    status: 'connected',
    configured: true,
    connected: true,
    connectedAt: tokenRecord.createdAt,
    scope: tokenRecord.scope,
    failedSyncCount,
    calendarSyncEnabled: tokenRecord.calendarSyncEnabled,
    selectedCalendarId: tokenRecord.selectedCalendarId ?? 'primary',
    lastCalendarSyncAt: tokenRecord.lastCalendarSyncAt ?? null,
    lastCalendarSyncError: tokenRecord.lastCalendarSyncError ?? null,
    hasCalendarScope,
  };
}

/**
 * Constructs the Google OAuth 2.0 authorization redirect URL.
 */
export function buildGoogleAuthorizationUrl(options: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  clientId?: string;
  scope?: string;
  includeGrantedScopes?: boolean;
}): string {
  let clientId = options.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    try {
      clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    } catch {
      // Ignore env validation failure
    }
  }

  if (!clientId || clientId.trim().length === 0) {
    throw new GoogleOAuthError('GOOGLE_OAUTH_CLIENT_ID is not configured.');
  }

  const url = new URL(getGoogleAuthUrl());
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', options.scope ?? GOOGLE_CONTACTS_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (options.includeGrantedScopes) {
    url.searchParams.set('include_granted_scopes', 'true');
  }
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', CODE_CHALLENGE_METHOD);
  url.searchParams.set('state', options.state);

  return url.toString();
}

export interface GoogleTokenResponse {
  access_token?: string;
  refresh_token: string;
  expires_in?: number;
  scope: string;
  token_type?: string;
}

/**
 * Exchanges authorization code and PKCE code verifier for OAuth tokens with Google token endpoint.
 */
export async function exchangeGoogleAuthorizationCode(options: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  existingRefreshToken?: string;
  fetchFn?: typeof fetch;
}): Promise<GoogleTokenResponse> {
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    try {
      clientId ??= env.GOOGLE_OAUTH_CLIENT_ID;
      clientSecret ??= env.GOOGLE_OAUTH_CLIENT_SECRET;
    } catch {
      // Ignore env validation failure
    }
  }

  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError('Google OAuth credentials not configured on server.');
  }

  const bodyParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: options.redirectUri,
  });

  const customFetch = options.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await customFetch(getGoogleTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Network error connecting to Google token endpoint',
    );
    throw new GoogleOAuthError('Unable to reach Google OAuth token endpoint.', 502);
  }

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Google token exchange failed with HTTP error status');
    throw new GoogleOAuthError(
      `Google token exchange failed: HTTP ${String(response.status)}`,
      response.status >= 500 ? 502 : 400,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const refreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : options.existingRefreshToken;

  if (!refreshToken) {
    logger.warn('Google token response did not contain a refresh token');
    throw new GoogleOAuthError(
      'Google did not return a refresh token. Please re-authenticate with prompt=consent.',
      400,
    );
  }

  return {
    refresh_token: refreshToken,
    access_token: typeof data.access_token === 'string' ? data.access_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    scope: typeof data.scope === 'string' ? data.scope : GOOGLE_CONTACTS_SCOPE,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
  };
}

/**
 * Retrieves a valid Google OAuth access token, refreshing if missing or expired.
 * Shared across Contacts (E1) and Calendar (E4) integrations.
 */
export async function getValidGoogleAccessToken(
  purpose: string = GOOGLE_OAUTH_PURPOSE,
  options: {
    dbClient?: DbClient;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const dbClient = options.dbClient;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const tokenRecord = await getGoogleOAuthToken(dbClient);
  if (!tokenRecord) {
    throw new GoogleOAuthError(
      'Google Workspace is not connected. Connect via settings first.',
      401,
    );
  }

  // Check if cached access token is still valid (with 60-second safety window)
  const now = Date.now();
  if (
    tokenRecord.accessToken &&
    tokenRecord.accessTokenExpiresAt &&
    tokenRecord.accessTokenExpiresAt.getTime() > now + 60_000
  ) {
    return tokenRecord.accessToken;
  }

  // Decrypt refresh token
  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(tokenRecord.encryptedRefreshToken, purpose);
  } catch {
    throw new GoogleOAuthError('Failed to decrypt Google OAuth refresh token.', 500, false);
  }

  // Exchange refresh token for fresh access token
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    try {
      clientId ??= env.GOOGLE_OAUTH_CLIENT_ID;
      clientSecret ??= env.GOOGLE_OAUTH_CLIENT_SECRET;
    } catch {
      // Ignore env parse failure
    }
  }

  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError('Google OAuth client credentials are not configured.', 500, false);
  }

  const bodyParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetchFn(getGoogleTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logger.warn({ isTimeout }, 'Network error during Google token refresh');
    throw new GoogleOAuthError(
      'Network error refreshing Google access token.',
      isTimeout ? 408 : 502,
      true,
    );
  }

  if (!tokenRes.ok) {
    const isRetryable = tokenRes.status === 429 || tokenRes.status >= 500;
    logger.warn({ status: tokenRes.status }, 'Google token refresh failed');
    throw new GoogleOAuthError(
      `Failed to refresh Google access token: HTTP ${String(tokenRes.status)}`,
      tokenRes.status,
      isRetryable,
    );
  }

  const data = (await tokenRes.json()) as Record<string, unknown>;
  const newAccessToken = data.access_token;
  if (typeof newAccessToken !== 'string' || !newAccessToken) {
    throw new GoogleOAuthError('Google token refresh response missing access token.', 502, false);
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
  const updatedScope =
    typeof data.scope === 'string' && data.scope ? data.scope : tokenRecord.scope;

  await upsertGoogleOAuthToken(
    {
      encryptedRefreshToken: tokenRecord.encryptedRefreshToken,
      accessToken: newAccessToken,
      accessTokenExpiresAt: newExpiresAt,
      scope: updatedScope,
      calendarSyncEnabled: tokenRecord.calendarSyncEnabled,
      selectedCalendarId: tokenRecord.selectedCalendarId,
      lastCalendarSyncAt: tokenRecord.lastCalendarSyncAt,
      lastCalendarSyncError: tokenRecord.lastCalendarSyncError,
    },
    dbClient,
  );

  return newAccessToken;
}

/**
 * Revokes an OAuth token using Google's revocation endpoint.
 */
export async function revokeGoogleToken(token: string, fetchFn?: typeof fetch): Promise<boolean> {
  const customFetch = fetchFn ?? fetch;
  const revokeUrl = `${getGoogleRevokeUrl()}?token=${encodeURIComponent(token)}`;

  try {
    const res = await customFetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status },
        'Google token revocation returned non-200 status (token may already be revoked)',
      );
    }
    return true;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Network warning during Google token revocation',
    );
    // Return true so local disconnect is not blocked by external network failure
    return true;
  }
}

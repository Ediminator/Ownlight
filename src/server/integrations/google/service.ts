import 'server-only';
import { env, isGoogleOAuthConfigured } from '@/env';
import { logger } from '@/server/log';
import { type DbClient } from '@/server/db/client';
import { GOOGLE_CONTACTS_SCOPE, CODE_CHALLENGE_METHOD } from './pkce';
import { getGoogleAuthUrl, getGoogleTokenUrl, getGoogleRevokeUrl } from './constants';
import { getGoogleOAuthToken } from './repo';

export class GoogleOAuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'GoogleOAuthError';
    this.statusCode = statusCode;
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

  return {
    status: 'connected',
    configured: true,
    connected: true,
    connectedAt: tokenRecord.createdAt,
    scope: tokenRecord.scope,
    failedSyncCount,
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
  url.searchParams.set('scope', GOOGLE_CONTACTS_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
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

  if (typeof data.refresh_token !== 'string' || !data.refresh_token) {
    logger.warn('Google token response did not contain a refresh token');
    throw new GoogleOAuthError(
      'Google did not return a refresh token. Please re-authenticate with prompt=consent.',
      400,
    );
  }

  return {
    refresh_token: data.refresh_token,
    access_token: typeof data.access_token === 'string' ? data.access_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    scope: typeof data.scope === 'string' ? data.scope : GOOGLE_CONTACTS_SCOPE,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
  };
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

import 'server-only';
import { env } from '@/env';
import { logger } from '@/server/log';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { decryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE, getGoogleTokenUrl, getGooglePeopleApiBase } from './constants';
import { getGoogleOAuthToken, upsertGoogleOAuthToken } from './repo';
import {
  mapContactToGooglePerson,
  assertMinimisedPayload,
  type ContactForGoogleSync,
} from './mapping';

export class PeopleApiError extends Error {
  public readonly statusCode: number;
  public readonly isRetryable: boolean;

  constructor(message: string, statusCode = 500, isRetryable = false) {
    super(message);
    this.name = 'PeopleApiError';
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export interface PeopleClientOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  dbClient?: DbClient;
}

export interface GoogleContactResult {
  resourceName: string;
  etag: string;
}

/**
 * Google People API HTTP Client with token refreshing and data minimisation.
 */
export class GooglePeopleClient {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly dbClient: DbClient;

  constructor(options: PeopleClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.dbClient = options.dbClient ?? defaultDb;
  }

  /**
   * Retrieves a valid Google OAuth access token, refreshing if missing or expired.
   */
  async getValidAccessToken(): Promise<string> {
    const tokenRecord = await getGoogleOAuthToken(this.dbClient);
    if (!tokenRecord) {
      throw new PeopleApiError(
        'Google Workspace is not connected. Connect via settings first.',
        401,
        false,
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
      refreshToken = await decryptSecret(tokenRecord.encryptedRefreshToken, GOOGLE_OAUTH_PURPOSE);
    } catch {
      throw new PeopleApiError('Failed to decrypt Google OAuth refresh token.', 500, false);
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
      throw new PeopleApiError('Google OAuth client credentials are not configured.', 500, false);
    }

    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    let tokenRes: Response;
    try {
      tokenRes = await this.fetchFn(getGoogleTokenUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: bodyParams.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network error during Google token refresh');
      throw new PeopleApiError(
        'Network error refreshing Google access token.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!tokenRes.ok) {
      const isRetryable = tokenRes.status === 429 || tokenRes.status >= 500;
      logger.warn({ status: tokenRes.status }, 'Google token refresh failed');
      throw new PeopleApiError(
        `Failed to refresh Google access token: HTTP ${String(tokenRes.status)}`,
        tokenRes.status,
        isRetryable,
      );
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
    if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
      throw new PeopleApiError('Google token refresh response missing access token.', 502, false);
    }

    const expiresInSec = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    const expiresAt = new Date(now + expiresInSec * 1000);

    // Cache updated token in database
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken: tokenRecord.encryptedRefreshToken,
        accessToken: tokenData.access_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokenRecord.scope,
      },
      this.dbClient,
    );

    return tokenData.access_token;
  }

  /**
   * Creates a contact in Google Contacts with data minimisation.
   */
  async createContact(contact: ContactForGoogleSync): Promise<GoogleContactResult> {
    const accessToken = await this.getValidAccessToken();
    const payload = mapContactToGooglePerson(contact);
    assertMinimisedPayload(payload as unknown as Record<string, unknown>);

    const url = `${getGooglePeopleApiBase()}/people:createContact`;

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn(
        { endpoint: 'createContact', isTimeout },
        'Network failure calling People API createContact',
      );
      throw new PeopleApiError(
        'People API createContact network error or timeout.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!res.ok) {
      const isRetryable = res.status === 429 || res.status >= 500;
      logger.warn(
        { endpoint: 'createContact', status: res.status },
        'People API createContact failed',
      );
      throw new PeopleApiError(
        `Google People API createContact failed: HTTP ${String(res.status)}`,
        res.status,
        isRetryable,
      );
    }

    const data = (await res.json()) as { resourceName?: string; etag?: string };
    if (!data.resourceName || !data.etag) {
      throw new PeopleApiError(
        'Google People API response missing resourceName or etag.',
        502,
        false,
      );
    }

    return {
      resourceName: data.resourceName,
      etag: data.etag,
    };
  }

  /**
   * Updates an existing contact in Google Contacts using optimistic concurrency (etag).
   */
  async updateContact(
    resourceName: string,
    contact: ContactForGoogleSync,
    etag: string,
  ): Promise<GoogleContactResult> {
    const accessToken = await this.getValidAccessToken();
    const payload = mapContactToGooglePerson(contact, etag);
    assertMinimisedPayload(payload as unknown as Record<string, unknown>);

    // Clean resource name for URL path
    const encodedResource = resourceName.split('/').map(encodeURIComponent).join('/');
    const url = `${getGooglePeopleApiBase()}/${encodedResource}:updateContact?updatePersonFields=names,phoneNumbers`;

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn(
        { endpoint: 'updateContact', isTimeout },
        'Network failure calling People API updateContact',
      );
      throw new PeopleApiError(
        'People API updateContact network error or timeout.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!res.ok) {
      const isRetryable = res.status === 429 || res.status >= 500;
      logger.warn(
        { endpoint: 'updateContact', status: res.status },
        'People API updateContact failed',
      );
      throw new PeopleApiError(
        `Google People API updateContact failed: HTTP ${String(res.status)}`,
        res.status,
        isRetryable,
      );
    }

    const data = (await res.json()) as { resourceName?: string; etag?: string };
    if (!data.resourceName || !data.etag) {
      throw new PeopleApiError(
        'Google People API response missing resourceName or etag.',
        502,
        false,
      );
    }

    return {
      resourceName: data.resourceName,
      etag: data.etag,
    };
  }

  /**
   * Deletes a contact from Google Contacts.
   */
  async deleteContact(resourceName: string): Promise<boolean> {
    const accessToken = await this.getValidAccessToken();
    const encodedResource = resourceName.split('/').map(encodeURIComponent).join('/');
    const url = `${getGooglePeopleApiBase()}/${encodedResource}:deleteContact`;

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn(
        { endpoint: 'deleteContact', isTimeout },
        'Network failure calling People API deleteContact',
      );
      throw new PeopleApiError(
        'People API deleteContact network error or timeout.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!res.ok) {
      // 404 means already deleted upstream, which is treated as successful deletion
      if (res.status === 404) {
        return true;
      }
      const isRetryable = res.status === 429 || res.status >= 500;
      logger.warn(
        { endpoint: 'deleteContact', status: res.status },
        'People API deleteContact failed',
      );
      throw new PeopleApiError(
        `Google People API deleteContact failed: HTTP ${String(res.status)}`,
        res.status,
        isRetryable,
      );
    }

    return true;
  }
}

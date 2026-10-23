import 'server-only';
import { logger } from '@/server/log';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { GOOGLE_OAUTH_PURPOSE, getGooglePeopleApiBase } from './constants';
import { getValidGoogleAccessToken, GoogleOAuthError } from './service';
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
    try {
      return await getValidGoogleAccessToken(GOOGLE_OAUTH_PURPOSE, {
        dbClient: this.dbClient,
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof GoogleOAuthError) {
        throw new PeopleApiError(err.message, err.statusCode, err.isRetryable);
      }
      if (err instanceof PeopleApiError) {
        throw err;
      }
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new PeopleApiError(
        'Network error refreshing Google access token.',
        isTimeout ? 408 : 502,
        true,
      );
    }
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

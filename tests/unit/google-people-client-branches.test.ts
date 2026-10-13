import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { GooglePeopleClient } from '@/server/integrations/google/people-client';
import * as googleRepo from '@/server/integrations/google/repo';
import { encryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';
import type { ContactForGoogleSync } from '@/server/integrations/google/mapping';

describe('GooglePeopleClient Unit Branch Coverage', () => {
  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const dummyContact: ContactForGoogleSync = {
    id: '018f0000-0000-7000-8000-000000000001',
    givenName: 'Test',
    familyName: 'User',
    email: 'test@example.com',
    phone: '+49 30 123456',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('instantiates GooglePeopleClient with default options', () => {
    const client = new GooglePeopleClient();
    expect(client).toBeDefined();
  });

  describe('getValidAccessToken branches', () => {
    it('throws 401 when token record is missing in database', async () => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue(null);

      const client = new GooglePeopleClient();
      await expect(client.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 401,
        isRetryable: false,
      });
    });

    it('returns cached access token when valid and not expiring within 60s', async () => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'cached-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 300_000),
        encryptedRefreshToken: 'enc-refresh',
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = new GooglePeopleClient();
      const token = await client.getValidAccessToken();
      expect(token).toBe('cached-access-token');
    });

    it('throws 500 when refresh token decryption fails', async () => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'expired-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        encryptedRefreshToken: 'invalid-encrypted-payload',
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = new GooglePeopleClient();
      await expect(client.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 500,
        isRetryable: false,
      });
    });

    it('throws 500 when Google OAuth client credentials are not configured', async () => {
      const encRefreshToken = await encryptSecret(
        'valid-refresh-token',
        GOOGLE_OAUTH_PURPOSE,
        masterKey,
      );

      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'expired-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        encryptedRefreshToken: encRefreshToken,
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const origId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const origSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;

      try {
        const client = new GooglePeopleClient();
        await expect(client.getValidAccessToken()).rejects.toMatchObject({
          statusCode: 500,
          isRetryable: false,
        });
      } finally {
        if (origId) process.env.GOOGLE_OAUTH_CLIENT_ID = origId;
        if (origSecret) process.env.GOOGLE_OAUTH_CLIENT_SECRET = origSecret;
      }
    });

    it('handles network error during token refresh: TimeoutError and generic Error', async () => {
      process.env.ENCRYPTION_KEY = masterKey;
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';

      const encRefreshToken = await encryptSecret(
        'valid-refresh-token',
        GOOGLE_OAUTH_PURPOSE,
        masterKey,
      );

      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'expired-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        encryptedRefreshToken: encRefreshToken,
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. TimeoutError
      const timeoutFetch = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Connection timed out'), { name: 'TimeoutError' }),
        );
      const clientTimeout = new GooglePeopleClient({ fetchFn: timeoutFetch });
      await expect(clientTimeout.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 408,
        isRetryable: true,
      });

      // 2. Generic Error
      const genericFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      const clientGeneric = new GooglePeopleClient({ fetchFn: genericFetch });
      await expect(clientGeneric.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: true,
      });
    });

    it('handles HTTP error responses on token refresh (429 retryable, 400 non-retryable)', async () => {
      process.env.ENCRYPTION_KEY = masterKey;
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';

      const encRefreshToken = await encryptSecret(
        'valid-refresh-token',
        GOOGLE_OAUTH_PURPOSE,
        masterKey,
      );

      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'expired-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        encryptedRefreshToken: encRefreshToken,
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. 429 Rate Limit (isRetryable = true)
      const fetch429 = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });
      const client429 = new GooglePeopleClient({ fetchFn: fetch429 });
      await expect(client429.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 429,
        isRetryable: true,
      });

      // 2. 400 Bad Request (isRetryable = false)
      const fetch400 = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });
      const client400 = new GooglePeopleClient({ fetchFn: fetch400 });
      await expect(client400.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 400,
        isRetryable: false,
      });
    });

    it('handles missing access_token in response and non-numeric expires_in fallback', async () => {
      process.env.ENCRYPTION_KEY = masterKey;
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';

      const encRefreshToken = await encryptSecret(
        'valid-refresh-token',
        GOOGLE_OAUTH_PURPOSE,
        masterKey,
      );

      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'expired-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        encryptedRefreshToken: encRefreshToken,
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(googleRepo, 'upsertGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'refreshed-tok',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        encryptedRefreshToken: encRefreshToken,
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Missing access token
      const fetchMissingToken = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ expires_in: 3600 }),
      });
      const clientMissing = new GooglePeopleClient({ fetchFn: fetchMissingToken });
      await expect(clientMissing.getValidAccessToken()).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: false,
      });

      // Non-numeric expires_in (defaults to 3600)
      const fetchNonNumExpires = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'tok-1', expires_in: 'invalid' }),
      });
      const clientExpires = new GooglePeopleClient({ fetchFn: fetchNonNumExpires });
      const refreshed = await clientExpires.getValidAccessToken();
      expect(refreshed).toBe('tok-1');
    });
  });

  describe('createContact branches', () => {
    beforeEach(() => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'valid-tok',
        accessTokenExpiresAt: new Date(Date.now() + 300_000),
        encryptedRefreshToken: 'enc',
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('handles createContact network timeout and generic error', async () => {
      // Timeout
      const fetchTimeout = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Abort'), { name: 'AbortError' }));
      const clientTimeout = new GooglePeopleClient({ fetchFn: fetchTimeout });
      await expect(clientTimeout.createContact(dummyContact)).rejects.toMatchObject({
        statusCode: 408,
        isRetryable: true,
      });

      // Generic error
      const fetchGeneric = vi.fn().mockRejectedValue(new Error('Connection reset'));
      const clientGeneric = new GooglePeopleClient({ fetchFn: fetchGeneric });
      await expect(clientGeneric.createContact(dummyContact)).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: true,
      });
    });

    it('handles createContact non-ok HTTP responses and response format validation', async () => {
      // 500 error (isRetryable = true)
      const fetch500 = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const client500 = new GooglePeopleClient({ fetchFn: fetch500 });
      await expect(client500.createContact(dummyContact)).rejects.toMatchObject({
        statusCode: 500,
        isRetryable: true,
      });

      // 400 error (isRetryable = false)
      const fetch400 = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });
      const client400 = new GooglePeopleClient({ fetchFn: fetch400 });
      await expect(client400.createContact(dummyContact)).rejects.toMatchObject({
        statusCode: 400,
        isRetryable: false,
      });

      // 200 but missing etag
      const fetchMissingEtag = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ resourceName: 'people/123' }),
      });
      const clientMissing = new GooglePeopleClient({ fetchFn: fetchMissingEtag });
      await expect(clientMissing.createContact(dummyContact)).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: false,
      });

      // 200 success
      const fetchSuccess = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ resourceName: 'people/123', etag: 'etag123' }),
      });
      const clientSuccess = new GooglePeopleClient({ fetchFn: fetchSuccess });
      const res = await clientSuccess.createContact(dummyContact);
      expect(res).toEqual({ resourceName: 'people/123', etag: 'etag123' });
    });
  });

  describe('updateContact branches', () => {
    beforeEach(() => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'valid-tok',
        accessTokenExpiresAt: new Date(Date.now() + 300_000),
        encryptedRefreshToken: 'enc',
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('handles updateContact network timeout and generic error', async () => {
      // Timeout
      const fetchTimeout = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Timeout'), { name: 'TimeoutError' }));
      const clientTimeout = new GooglePeopleClient({ fetchFn: fetchTimeout });
      await expect(
        clientTimeout.updateContact('people/123', dummyContact, 'etag'),
      ).rejects.toMatchObject({
        statusCode: 408,
        isRetryable: true,
      });

      // Generic
      const fetchGeneric = vi.fn().mockRejectedValue(new Error('Socket hung up'));
      const clientGeneric = new GooglePeopleClient({ fetchFn: fetchGeneric });
      await expect(
        clientGeneric.updateContact('people/123', dummyContact, 'etag'),
      ).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: true,
      });
    });

    it('handles updateContact non-ok responses and missing resourceName/etag', async () => {
      // 503 retryable
      const fetch503 = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });
      const client503 = new GooglePeopleClient({ fetchFn: fetch503 });
      await expect(
        client503.updateContact('people/123', dummyContact, 'etag'),
      ).rejects.toMatchObject({
        statusCode: 503,
        isRetryable: true,
      });

      // 404 non-retryable
      const fetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      const client404 = new GooglePeopleClient({ fetchFn: fetch404 });
      await expect(
        client404.updateContact('people/123', dummyContact, 'etag'),
      ).rejects.toMatchObject({
        statusCode: 404,
        isRetryable: false,
      });

      // Missing resourceName
      const fetchNoResource = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ etag: 'etag123' }),
      });
      const clientNoResource = new GooglePeopleClient({ fetchFn: fetchNoResource });
      await expect(
        clientNoResource.updateContact('people/123', dummyContact, 'etag'),
      ).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: false,
      });

      // Success
      const fetchSuccess = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ resourceName: 'people/123', etag: 'etag456' }),
      });
      const clientSuccess = new GooglePeopleClient({ fetchFn: fetchSuccess });
      const res = await clientSuccess.updateContact('people/123', dummyContact, 'etag');
      expect(res).toEqual({ resourceName: 'people/123', etag: 'etag456' });
    });
  });

  describe('deleteContact branches', () => {
    beforeEach(() => {
      vi.spyOn(googleRepo, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        accessToken: 'valid-tok',
        accessTokenExpiresAt: new Date(Date.now() + 300_000),
        encryptedRefreshToken: 'enc',
        scope: 'scope',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('handles deleteContact network timeout, generic error, 404 idempotent, non-ok, and success', async () => {
      // Timeout
      const fetchTimeout = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Timeout'), { name: 'TimeoutError' }));
      const clientTimeout = new GooglePeopleClient({ fetchFn: fetchTimeout });
      await expect(clientTimeout.deleteContact('people/123')).rejects.toMatchObject({
        statusCode: 408,
        isRetryable: true,
      });

      // Generic Error
      const fetchGeneric = vi.fn().mockRejectedValue(new Error('Failed to connect'));
      const clientGeneric = new GooglePeopleClient({ fetchFn: fetchGeneric });
      await expect(clientGeneric.deleteContact('people/123')).rejects.toMatchObject({
        statusCode: 502,
        isRetryable: true,
      });

      // 404 idempotent success (returns true)
      const fetch404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      const client404 = new GooglePeopleClient({ fetchFn: fetch404 });
      const res404 = await client404.deleteContact('people/123');
      expect(res404).toBe(true);

      // 500 error (retryable)
      const fetch500 = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const client500 = new GooglePeopleClient({ fetchFn: fetch500 });
      await expect(client500.deleteContact('people/123')).rejects.toMatchObject({
        statusCode: 500,
        isRetryable: true,
      });

      // 400 error (non-retryable)
      const fetch400 = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });
      const client400 = new GooglePeopleClient({ fetchFn: fetch400 });
      await expect(client400.deleteContact('people/123')).rejects.toMatchObject({
        statusCode: 400,
        isRetryable: false,
      });

      // 200 OK (returns true)
      const fetch200 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      const client200 = new GooglePeopleClient({ fetchFn: fetch200 });
      const res200 = await client200.deleteContact('people/123');
      expect(res200).toBe(true);
    });
  });
});

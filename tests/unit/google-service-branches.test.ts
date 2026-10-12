import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GoogleOAuthError,
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  revokeGoogleToken,
  getGoogleIntegrationStatus,
} from '@/server/integrations/google/service';
import * as envModule from '@/env';
import * as repoModule from '@/server/integrations/google/repo';
import * as outboxModule from '@/server/integrations/google/outbox';

describe('Google Integration Service Branch Coverage (service.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getGoogleIntegrationStatus', () => {
    it('returns unconfigured status when Google OAuth is not configured', async () => {
      vi.spyOn(envModule, 'isGoogleOAuthConfigured').mockReturnValue(false);

      const status = await getGoogleIntegrationStatus();
      expect(status.status).toBe('unconfigured');
      expect(status.configured).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.failedSyncCount).toBe(0);
    });

    it('returns disconnected status when configured but no token in database', async () => {
      vi.spyOn(envModule, 'isGoogleOAuthConfigured').mockReturnValue(true);
      vi.spyOn(outboxModule, 'getFailedOutboxCount').mockResolvedValue(2);
      vi.spyOn(repoModule, 'getGoogleOAuthToken').mockResolvedValue(null);

      const status = await getGoogleIntegrationStatus();
      expect(status.status).toBe('disconnected');
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.failedSyncCount).toBe(2);
    });

    it('returns connected status with timestamp and scope when token is present', async () => {
      vi.spyOn(envModule, 'isGoogleOAuthConfigured').mockReturnValue(true);
      vi.spyOn(outboxModule, 'getFailedOutboxCount').mockResolvedValue(0);
      const createdAt = new Date('2026-10-12T08:00:00Z');
      vi.spyOn(repoModule, 'getGoogleOAuthToken').mockResolvedValue({
        id: 'token-1',
        provider: 'google',
        scope: 'https://www.googleapis.com/auth/contacts',
        createdAt,
        encryptedRefreshToken: 'enc-token',
        accessToken: null,
        accessTokenExpiresAt: null,
        updatedAt: createdAt,
      });

      const status = await getGoogleIntegrationStatus();
      expect(status.status).toBe('connected');
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(true);
      expect(status.connectedAt).toEqual(createdAt);
      expect(status.scope).toBe('https://www.googleapis.com/auth/contacts');
      expect(status.failedSyncCount).toBe(0);
    });
  });

  describe('buildGoogleAuthorizationUrl', () => {
    it('throws GoogleOAuthError when client_id is missing', () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;

      expect(() =>
        buildGoogleAuthorizationUrl({
          state: 'state-123',
          codeChallenge: 'challenge-456',
          redirectUri: 'https://studio.example.com/callback',
          clientId: '',
        }),
      ).toThrow(GoogleOAuthError);
    });

    it('constructs authorization URL with required OAuth parameters', () => {
      const urlStr = buildGoogleAuthorizationUrl({
        state: 'test-state-abc',
        codeChallenge: 'test-challenge-xyz',
        redirectUri: 'https://studio.example.com/callback',
        clientId: 'my-client-id.apps.googleusercontent.com',
      });

      const url = new URL(urlStr);
      expect(url.searchParams.get('client_id')).toBe('my-client-id.apps.googleusercontent.com');
      expect(url.searchParams.get('state')).toBe('test-state-abc');
      expect(url.searchParams.get('code_challenge')).toBe('test-challenge-xyz');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('access_type')).toBe('offline');
    });
  });

  describe('exchangeGoogleAuthorizationCode', () => {
    it('throws GoogleOAuthError when client credentials are missing', async () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;

      await expect(
        exchangeGoogleAuthorizationCode({
          code: 'code-123',
          codeVerifier: 'verifier-456',
          redirectUri: 'https://studio.example.com/callback',
        }),
      ).rejects.toThrow(GoogleOAuthError);
    });

    it('handles network error during token exchange with HTTP 502 error', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection refused'));

      await expect(
        exchangeGoogleAuthorizationCode({
          code: 'code-123',
          codeVerifier: 'verifier-456',
          redirectUri: 'https://studio.example.com/callback',
          fetchFn: mockFetch,
        }),
      ).rejects.toThrow(GoogleOAuthError);
    });

    it('handles HTTP error responses from Google token endpoint', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';

      // 500 error -> status 502
      const mockFetch500 = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        exchangeGoogleAuthorizationCode({
          code: 'code-123',
          codeVerifier: 'verifier-456',
          redirectUri: 'https://studio.example.com/callback',
          fetchFn: mockFetch500,
        }),
      ).rejects.toMatchObject({ statusCode: 502 });

      // 400 error -> status 400
      const mockFetch400 = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      await expect(
        exchangeGoogleAuthorizationCode({
          code: 'code-123',
          codeVerifier: 'verifier-456',
          redirectUri: 'https://studio.example.com/callback',
          fetchFn: mockFetch400,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws when Google response does not contain a refresh token', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'acc-token' }), // No refresh_token
      });

      await expect(
        exchangeGoogleAuthorizationCode({
          code: 'code-123',
          codeVerifier: 'verifier-456',
          redirectUri: 'https://studio.example.com/callback',
          fetchFn: mockFetch,
        }),
      ).rejects.toThrow('Google did not return a refresh token');
    });

    it('returns token response when refresh_token and optional fields are present', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            refresh_token: 'refresh-xyz',
            access_token: 'acc-xyz',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/contacts',
            token_type: 'Bearer',
          }),
      });

      const res = await exchangeGoogleAuthorizationCode({
        code: 'code-123',
        codeVerifier: 'verifier-456',
        redirectUri: 'https://studio.example.com/callback',
        fetchFn: mockFetch,
      });

      expect(res.refresh_token).toBe('refresh-xyz');
      expect(res.access_token).toBe('acc-xyz');
      expect(res.expires_in).toBe(3600);
      expect(res.scope).toBe('https://www.googleapis.com/auth/contacts');
      expect(res.token_type).toBe('Bearer');
    });

    it('applies default scope when Google response omits scope field', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            refresh_token: 'refresh-default-scope',
          }),
      });

      const res = await exchangeGoogleAuthorizationCode({
        code: 'code-123',
        codeVerifier: 'verifier-456',
        redirectUri: 'https://studio.example.com/callback',
        fetchFn: mockFetch,
      });

      expect(res.refresh_token).toBe('refresh-default-scope');
      expect(res.scope).toBe('https://www.googleapis.com/auth/contacts');
      expect(res.access_token).toBeUndefined();
    });
  });

  describe('revokeGoogleToken', () => {
    it('returns true when revocation request succeeds with 200 OK', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await revokeGoogleToken('test-token', mockFetch);
      expect(result).toBe(true);
    });

    it('returns true when revocation returns non-200 status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });

      const result = await revokeGoogleToken('test-token', mockFetch);
      expect(result).toBe(true);
    });

    it('returns true and catches error when revocation encounters network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      const result = await revokeGoogleToken('test-token', mockFetch);
      expect(result).toBe(true);
    });
  });
});

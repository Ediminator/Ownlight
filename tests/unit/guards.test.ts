import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer ownlight_live_from_next_headers' : null,
    }),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import {
  extractBearerToken,
  extractSessionToken,
  requireAuth,
  requireOwnerSession,
  ForbiddenError,
  UnauthorizedError,
} from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

describe('Authentication and authorization guards (guards.ts)', () => {
  describe('extractBearerToken', () => {
    it('extracts Bearer token from Headers instance', () => {
      const h = new Headers();
      h.set('authorization', 'Bearer ownlight_live_123456');
      expect(extractBearerToken(h)).toBe('ownlight_live_123456');
    });

    it('extracts Bearer token from plain Record with Authorization key', () => {
      expect(extractBearerToken({ Authorization: 'Bearer ownlight_live_654321' })).toBe(
        'ownlight_live_654321',
      );
    });

    it('returns null when header is absent, non-Bearer, or empty', () => {
      expect(extractBearerToken(undefined)).toBeNull();
      expect(extractBearerToken({})).toBeNull();
      expect(extractBearerToken({ authorization: 'Basic dXNlcjpwYXNz' })).toBeNull();
      expect(extractBearerToken({ authorization: 'Bearer' })).toBeNull();
    });
  });

  describe('requireAuth and requireOwner error branches', () => {
    it('throws UnauthorizedError when API key format is malformed', async () => {
      await expect(
        requireAuth({
          headers: { authorization: 'Bearer invalid_format_key' },
          client: {} as DbClient,
        }),
      ).rejects.toThrow('Malformed API key format.');
    });

    it('throws UnauthorizedError when neither API key nor session cookie is provided', async () => {
      await expect(
        requireAuth({
          headers: { authorization: undefined },
          client: {} as DbClient,
        }),
      ).rejects.toThrow('Authentication required. No session or API key provided.');
    });

    it('I1-S07: automatically falls back to next/headers headers() when options.headers is omitted', async () => {
      // Calling requireAuth() without options.headers will pick up 'Bearer ownlight_live_from_next_headers'
      // and fail on invalid API key verification rather than 'No session or API key provided.'
      await expect(
        requireAuth({
          client: {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => [],
                }),
              }),
            }),
          } as unknown as DbClient,
        }),
      ).rejects.toThrow('Invalid API key.');
    });

    it('extracts session cookie from headers object and throws when invalid', async () => {
      await expect(
        requireAuth({
          headers: { cookie: 'ownlight_session=cookie-session-token' },
          client: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: () => [],
                  }),
                }),
              }),
            }),
          } as unknown as DbClient,
        }),
      ).rejects.toThrow('Invalid or expired session.');
    });
  });

  describe('extractSessionToken', () => {
    it('extracts session token from standard and secure cookie headers', async () => {
      expect(await extractSessionToken({ cookie: 'ownlight_session=standard_token_123' })).toBe(
        'standard_token_123',
      );
      expect(
        await extractSessionToken({ cookie: '__Secure-ownlight_session=secure_token_456' }),
      ).toBe('secure_token_456');

      const headersInstance = new Headers();
      headersInstance.set('cookie', 'foo=bar; ownlight_session=header_token_789; baz=qux');
      expect(await extractSessionToken(headersInstance)).toBe('header_token_789');

      expect(await extractSessionToken(undefined)).toBeUndefined();
      expect(await extractSessionToken({})).toBeUndefined();
      expect(await extractSessionToken({ cookie: 'other_cookie=xyz' })).toBeUndefined();
    });
  });

  describe('requireOwnerSession (I4-CI01: session-only guard)', () => {
    it('I4-CI01: strictly ignores Bearer API keys and throws UnauthorizedError when no session cookie is present', async () => {
      // Even if an Authorization: Bearer ... header is supplied, requireOwnerSession strictly ignores it
      await expect(
        requireOwnerSession({
          headers: { authorization: 'Bearer ow_live_valid_key_123' },
          client: {} as DbClient,
        }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('I4-CI01: throws UnauthorizedError when no session cookie is supplied', async () => {
      await expect(
        requireOwnerSession({
          headers: {},
          client: {} as DbClient,
        }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('I4-CI01: throws UnauthorizedError when session cookie is invalid or expired', async () => {
      await expect(
        requireOwnerSession({
          headers: { cookie: 'ownlight_session=expired-tok' },
          client: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: () => [],
                  }),
                }),
              }),
            }),
          } as unknown as DbClient,
        }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('I4-CI01: throws ForbiddenError when authenticated user is not an owner', async () => {
      const mockAssistantUser = { id: 'u1', role: 'assistant', name: 'Assistant' };
      const mockSession = { id: 's1', token: 'tok-asst', userId: 'u1' };

      await expect(
        requireOwnerSession({
          headers: { cookie: 'ownlight_session=tok-asst' },
          client: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: () => [{ session: mockSession, user: mockAssistantUser }],
                  }),
                }),
              }),
            }),
          } as unknown as DbClient,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('I4-CI01: successfully returns AuthContext for authenticated studio owner', async () => {
      const mockOwnerUser = { id: 'u-owner', role: 'owner', name: 'Studio Owner' };
      const mockSession = { id: 's-owner', token: 'tok_owner', userId: 'u-owner' };

      const context = await requireOwnerSession({
        headers: { cookie: 'ownlight_session=tok_owner' },
        client: {
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => [{ session: mockSession, user: mockOwnerUser }],
                }),
              }),
            }),
          }),
        } as unknown as DbClient,
      });

      expect(context.authType).toBe('session');
      expect(context.user.id).toBe('u-owner');
      expect(context.user.role).toBe('owner');
      expect(context.session?.id).toBe('s-owner');
      expect(context.scopes).toEqual(['*']);
    });
  });
});

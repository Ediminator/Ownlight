import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
let mockCookiesThrowOnce = false;

vi.mock('next/headers', () => ({
  cookies: () => {
    if (mockCookiesThrowOnce) {
      mockCookiesThrowOnce = false;
      return Promise.reject(new Error('Cookies temporarily unavailable'));
    }
    return Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    });
  },
  headers: () =>
    Promise.resolve({
      get: (name: string) => (name === 'x-real-ip' ? '127.0.0.1' : null),
    }),
}));

let mockCurrentUser = {
  id: 'owner-uuid-1',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'owner',
};

vi.mock('@/server/auth/guards', () => ({
  requireOwner: vi.fn(() => Promise.resolve({ user: mockCurrentUser })),
  requireAuth: vi.fn(() => Promise.resolve({ user: mockCurrentUser })),
}));

let mockStudioSettings = {
  id: 'settings-1',
  mfa_required: false,
  mfa_postponed_until: null as Date | null,
};

vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: vi.fn(() => Promise.resolve(mockStudioSettings)),
}));

vi.mock('@/server/auth/session', () => ({
  rotateSession: vi.fn((_oldToken: string | null | undefined, userId: string) =>
    Promise.resolve({
      id: 'new-session-id',
      userId,
      token: 'new-session-token',
      expiresAt: new Date(Date.now() + 86400000),
    }),
  ),
  revokeSession: vi.fn(() => Promise.resolve()),
  verifySession: vi.fn(),
  getSessionCookieAttributes: vi.fn(() => ({
    name: 'ownlight_session',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 86400,
  })),
  SESSION_COOKIE_NAME: 'ownlight_session',
  SECURE_SESSION_COOKIE_NAME: '__Secure-ownlight_session',
  shouldUseSecureCookies: vi.fn(() => false),
}));

let mockRateLimitAllowed = true;
vi.mock('@/server/auth/rate-limiter', () => ({
  checkMfaRateLimit: vi.fn(() => Promise.resolve({ allowed: mockRateLimitAllowed })),
  recordMfaFailure: vi.fn(() => Promise.resolve()),
  recordMfaSuccess: vi.fn(() => Promise.resolve()),
  anonymizeIp: (ip: string) => ip,
}));

let mockVerifyRegThrows = false;
let mockVerifyAuthThrows = false;

vi.mock('@/server/auth/webauthn', () => ({
  getWebAuthnConfig: vi.fn(() => ({
    rpId: 'localhost',
    rpName: 'Ownlight',
    origin: 'http://localhost:3000',
  })),
  generateWebAuthnChallenge: vi.fn(() => 'mock-challenge-token'),
  createRegistrationOptions: vi.fn(() => ({
    challenge: 'mock-challenge-token',
    rp: { id: 'localhost', name: 'Ownlight' },
  })),
  createAuthenticationOptions: vi.fn(() => ({
    challenge: 'mock-challenge-token',
    rpId: 'localhost',
  })),
  verifyRegistrationResponse: vi.fn(() => {
    if (mockVerifyRegThrows) {
      return Promise.reject(new Error('Registration verification failed in test'));
    }
    return Promise.resolve({
      credentialId: 'mock-cred-id',
      publicKeyPem: 'mock-public-key-pem',
      counter: 0,
    });
  }),
  verifyAuthenticationResponse: vi.fn(() => {
    if (mockVerifyAuthThrows) {
      return Promise.reject(new Error('Authentication verification failed in test'));
    }
    return Promise.resolve({
      verified: true,
      newCounter: 1,
    });
  }),
}));

vi.mock('@/server/audit', () => ({
  audit: vi.fn(() => Promise.resolve()),
}));

import {
  startPasskeyRegistrationAction,
  completePasskeyRegistrationAction,
  listPasskeysAction,
  deletePasskeyAction,
  startPasskeyAuthenticationAction,
  completePasskeyAuthenticationAction,
  getMfaStatusAction,
  postponeMfaAction,
  listActiveSessionsAction,
  revokeSessionByIdAction,
} from '@/server/auth/mfa-actions';
import type { DbClient } from '@/server/db/client';

describe('MFA Server Actions Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesStore.clear();
    mockCurrentUser = {
      id: 'owner-uuid-1',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
    };
    mockStudioSettings = {
      id: 'settings-1',
      mfa_required: false,
      mfa_postponed_until: null,
    };
    mockRateLimitAllowed = true;
    mockVerifyRegThrows = false;
    mockVerifyAuthThrows = false;
  });

  describe('startPasskeyRegistrationAction', () => {
    it('stores challenge and returns options for standard owner', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      });
      const mockClient = {
        insert: mockInsert,
      } as unknown as DbClient;

      const result = await startPasskeyRegistrationAction(mockClient);
      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
      expect(result.data?.options).toBeDefined();
    });
  });

  describe('completePasskeyRegistrationAction', () => {
    it('rejects empty or excessively long passkey names', async () => {
      const emptyRes = await completePasskeyRegistrationAction({
        name: '   ',
        response: {
          id: 'test-id',
          rawId: 'test-raw-id',
          response: { clientDataJSON: '', attestationObject: '' },
        },
      });
      expect(emptyRes.success).toBe(false);
      expect(emptyRes.error).toContain('between 1 and 255 characters');

      const longRes = await completePasskeyRegistrationAction({
        name: 'A'.repeat(256),
        response: {
          id: 'test-id',
          rawId: 'test-raw-id',
          response: { clientDataJSON: '', attestationObject: '' },
        },
      });
      expect(longRes.success).toBe(false);
      expect(longRes.error).toContain('between 1 and 255 characters');
    });

    it('rejects expired or missing registration challenge session', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyRegistrationAction(
        {
          name: 'My Passkey',
          response: {
            id: 'test-id',
            rawId: 'test-raw-id',
            response: { clientDataJSON: '', attestationObject: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('registration session expired');
    });

    it('completes passkey registration successfully', async () => {
      const mockCreatedDate = new Date();
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 'ver-1',
                    value: 'mock-challenge-token',
                    expiresAt: new Date(Date.now() + 60000),
                  },
                ]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () =>
              Promise.resolve([
                {
                  id: 'passkey-1',
                  name: 'My YubiKey',
                  createdAt: mockCreatedDate,
                },
              ]),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve([]),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyRegistrationAction(
        {
          name: 'My YubiKey',
          response: {
            id: 'test-id',
            rawId: 'test-raw-id',
            response: { clientDataJSON: '', attestationObject: '', transports: ['usb'] },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(true);
      expect(result.data?.passkey.id).toBe('passkey-1');
      expect(result.data?.passkey.name).toBe('My YubiKey');
    });

    it('handles verification exceptions gracefully', async () => {
      mockVerifyRegThrows = true;

      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 'ver-1',
                    value: 'mock-challenge-token',
                    expiresAt: new Date(Date.now() + 60000),
                  },
                ]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyRegistrationAction(
        {
          name: 'My YubiKey',
          response: {
            id: 'test-id',
            rawId: 'test-raw-id',
            response: { clientDataJSON: '', attestationObject: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Registration verification failed in test');
    });
  });

  describe('listPasskeysAction', () => {
    it('returns empty array when user has no passkeys', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      const result = await listPasskeysAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('queries and returns passkeys for standard owner', async () => {
      const mockRows = [
        {
          id: 'pk-1',
          name: 'Passkey 1',
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ];
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockRows),
          }),
        }),
      } as unknown as DbClient;

      const result = await listPasskeysAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.name).toBe('Passkey 1');
    });
  });

  describe('deletePasskeyAction', () => {
    it('returns error if passkey is not found', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await deletePasskeyAction({ passkeyId: 'pk-missing' }, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Passkey not found');
    });

    it('requires re-authentication if deleting last passkey without fresh session', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              // If limit is called, it is foundRows; otherwise allPasskeys
              return {
                limit: () => Promise.resolve([{ id: 'pk-1', userId: 'owner-uuid-1' }]),
                then: (resolve: (rows: unknown[]) => void) => {
                  resolve([{ id: 'pk-1', userId: 'owner-uuid-1' }]);
                },
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await deletePasskeyAction({ passkeyId: 'pk-1' }, mockClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('REAUTH_REQUIRED');
    });

    it('deletes passkey successfully when user has multiple passkeys', async () => {
      const mockDelete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      });

      let callCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              callCount++;
              if (callCount === 1) {
                return {
                  limit: () => Promise.resolve([{ id: 'pk-1', userId: 'owner-uuid-1' }]),
                };
              }
              // allPasskeys has 2 items
              return Promise.resolve([
                { id: 'pk-1', userId: 'owner-uuid-1' },
                { id: 'pk-2', userId: 'owner-uuid-1' },
              ]);
            },
          }),
        }),
        delete: mockDelete,
      } as unknown as DbClient;

      const result = await deletePasskeyAction({ passkeyId: 'pk-1' }, mockClient);
      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('startPasskeyAuthenticationAction', () => {
    it('creates challenge and stores in verification table', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      });
      const mockClient = {
        insert: mockInsert,
      } as unknown as DbClient;

      const result = await startPasskeyAuthenticationAction(mockClient);
      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
      expect(result.data?.options.challenge).toBe('mock-challenge-token');
    });
  });

  describe('completePasskeyAuthenticationAction', () => {
    it('rejects expired or missing challenge', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'missing-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Passkey sign-in session expired');
    });

    it('rejects unrecognized passkey credential', async () => {
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              // credRows empty
              return {
                limit: () => Promise.resolve([]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'unknown-cred',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unrecognized passkey credential');
    });

    it('enforces rate limiting on passkey sign-in attempts', async () => {
      mockRateLimitAllowed = false;
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'pk-1',
                        credentialId: 'cred-1',
                        userId: 'owner-uuid-1',
                        publicKey: 'pem',
                        counter: 0,
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'owner-uuid-1',
                      email: 'owner@example.com',
                      name: 'Owner',
                    },
                  ]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many failed sign-in attempts');
    });

    it('completes passkey authentication successfully and sets session', async () => {
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'pk-1',
                        credentialId: 'cred-1',
                        userId: 'owner-uuid-1',
                        publicKey: 'pem',
                        counter: 0,
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'owner-uuid-1',
                      email: 'owner@example.com',
                      name: 'Owner',
                    },
                  ]),
              };
            },
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve([]),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(true);
      expect(result.data?.user.id).toBe('owner-uuid-1');
      expect(mockCookiesStore.get('ownlight_session')).toBe('new-session-token');
    });

    it('returns error if user for passkey credential is not found in db', async () => {
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'pk-1',
                        credentialId: 'cred-1',
                        userId: 'missing-user-id',
                        publicKey: 'pem',
                        counter: 0,
                      },
                    ]),
                };
              }
              return {
                limit: () => Promise.resolve([]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found.');
    });

    it('completes passkey authentication even when cookies() throws when fetching old token', async () => {
      mockCookiesThrowOnce = true;
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'pk-1',
                        credentialId: 'cred-1',
                        userId: 'owner-uuid-1',
                        publicKey: 'pem',
                        counter: 0,
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'owner-uuid-1',
                      email: 'owner@example.com',
                      name: 'Owner',
                    },
                  ]),
              };
            },
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        delete: () => ({
          where: () => Promise.resolve([]),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(true);
    });

    it('records failure and returns error when verification throws', async () => {
      mockVerifyAuthThrows = true;
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'ver-1',
                        value: 'valid-challenge',
                        expiresAt: new Date(Date.now() + 60000),
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'pk-1',
                        credentialId: 'cred-1',
                        userId: 'owner-uuid-1',
                        publicKey: 'pem',
                        counter: 0,
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'owner-uuid-1',
                      email: 'owner@example.com',
                      name: 'Owner',
                    },
                  ]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await completePasskeyAuthenticationAction(
        {
          challenge: 'valid-challenge',
          response: {
            id: 'cred-1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '' },
          },
        },
        mockClient,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication verification failed in test');
    });
  });

  describe('getMfaStatusAction', () => {
    it('returns default unconfigured status for unconfigured owner', async () => {
      mockCurrentUser.id = 'owner-uuid-1';
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;
      const result = await getMfaStatusAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data?.hasMfa).toBe(false);
      expect(result.data?.totpEnabled).toBe(false);
    });

    it('returns combined status for standard owner', async () => {
      let selectCall = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCall++;
              if (selectCall === 1) {
                // totpRows
                return { limit: () => Promise.resolve([{ id: 'totp-1' }]) };
              }
              if (selectCall === 2) {
                // passkeys count
                return Promise.resolve([{ count: 2 }]);
              }
              // recoveryCodes count
              return Promise.resolve([{ count: 7 }]);
            },
          }),
        }),
      } as unknown as DbClient;

      const result = await getMfaStatusAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data?.totpEnabled).toBe(true);
      expect(result.data?.passkeyCount).toBe(2);
      expect(result.data?.recoveryCodesRemaining).toBe(7);
      expect(result.data?.hasMfa).toBe(true);
    });
  });

  describe('postponeMfaAction', () => {
    it('updates studioSettings and records audit event for standard owner', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const mockClient = {
        update: mockUpdate,
      } as unknown as DbClient;

      const result = await postponeMfaAction(mockClient);
      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result.data?.postponedUntil).toBeInstanceOf(Date);
    });
  });

  describe('listActiveSessionsAction and revokeSessionByIdAction', () => {
    it('listActiveSessionsAction flags current session using cookie token', async () => {
      mockCookiesStore.set('ownlight_session', 'token-active-1');
      const now = new Date();
      const mockRows = [
        {
          id: 'sess-1',
          token: 'token-active-1',
          ipAddress: '127.0.0.1',
          userAgent: 'Chrome',
          createdAt: now,
          lastReauthenticatedAt: now,
        },
        {
          id: 'sess-2',
          token: 'token-other-2',
          ipAddress: '10.0.0.1',
          userAgent: 'Firefox',
          createdAt: now,
          lastReauthenticatedAt: now,
        },
      ];

      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockRows),
          }),
        }),
      } as unknown as DbClient;

      const result = await listActiveSessionsAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.isCurrent).toBe(true);
      expect(result.data?.[1]?.isCurrent).toBe(false);
    });

    it('listActiveSessionsAction handles cookies() throwing gracefully', async () => {
      mockCookiesThrowOnce = true;
      const now = new Date();
      const mockRows = [
        {
          id: 'sess-1',
          token: 'token-active-1',
          ipAddress: '127.0.0.1',
          userAgent: 'Chrome',
          createdAt: now,
          lastReauthenticatedAt: now,
        },
      ];

      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockRows),
          }),
        }),
      } as unknown as DbClient;

      const result = await listActiveSessionsAction(mockClient);
      expect(result.success).toBe(true);
      expect(result.data?.[0]?.isCurrent).toBe(false);
    });

    it('revokeSessionByIdAction returns error when session is not found', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await revokeSessionByIdAction({ sessionId: 'sess-missing' }, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });

    it('revokeSessionByIdAction revokes existing session', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 'sess-target',
                    token: 'token-target',
                    userId: 'owner-uuid-1',
                  },
                ]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const result = await revokeSessionByIdAction({ sessionId: 'sess-target' }, mockClient);
      expect(result.success).toBe(true);
    });
  });
});

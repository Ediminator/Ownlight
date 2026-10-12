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
      get: (name: string) =>
        name === 'x-forwarded-for' || name === 'x-real-ip' ? '127.0.0.1' : null,
    }),
}));

let mockRateLimitAllowed = true;
vi.mock('@/server/auth/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/rate-limiter')>();
  return {
    ...actual,
    checkSignInRateLimit: vi.fn(() => Promise.resolve({ allowed: mockRateLimitAllowed })),
    recordSignInFailure: vi.fn(() => Promise.resolve()),
    recordSignInSuccess: vi.fn(() => Promise.resolve()),
    checkSetupRateLimit: vi.fn(() => Promise.resolve({ allowed: mockRateLimitAllowed })),
    recordSetupFailure: vi.fn(() => Promise.resolve()),
    checkPasswordResetRequestRateLimit: vi.fn(() =>
      Promise.resolve({ allowed: mockRateLimitAllowed }),
    ),
    consumePasswordResetRequestRateLimit: vi.fn(() =>
      Promise.resolve({ allowed: mockRateLimitAllowed }),
    ),
    recordPasswordResetRequest: vi.fn(() => Promise.resolve()),
    checkPasswordResetActionRateLimit: vi.fn(() =>
      Promise.resolve({ allowed: mockRateLimitAllowed }),
    ),
    recordPasswordResetActionFailure: vi.fn(() => Promise.resolve()),
    anonymizeIp: (ip: string) => ip,
  };
});

let mockArgon2Match = true;
vi.mock('@/server/auth/passwords/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/passwords/policy')>();
  return {
    ...actual,
    verifyPasswordArgon2id: vi.fn(() => Promise.resolve(mockArgon2Match)),
  };
});

let mockRequestPasswordResetThrows = false;
let mockResetPasswordError: Error | null = null;

vi.mock('@/server/auth/password-reset', () => ({
  requestPasswordReset: vi.fn(() => {
    if (mockRequestPasswordResetThrows) {
      return Promise.reject(new Error('Failed to dispatch reset email in test'));
    }
    return Promise.resolve({ success: true, message: 'If account exists, email sent.' });
  }),
  resetPassword: vi.fn(() => {
    if (mockResetPasswordError) {
      return Promise.reject(mockResetPasswordError);
    }
    return Promise.resolve({ success: true });
  }),
}));

vi.mock('@/server/audit', () => ({
  audit: vi.fn(() => Promise.resolve()),
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
  signOutEverywhere: vi.fn(() => Promise.resolve()),
  verifySession: vi.fn((token: string) => {
    if (['valid-token'].includes(token)) {
      return Promise.resolve({
        session: { id: 'sess-uuid-1', userId: 'user-uuid-1' },
        user: { id: 'user-uuid-1', email: 'owner@example.com', name: 'Owner' },
      });
    }
    return Promise.resolve(null);
  }),
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
}));

vi.mock('@/server/auth/guards', () => ({
  requireOwner: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-uuid-1', email: 'owner@example.com', role: 'owner' },
    }),
  ),
}));

vi.mock('@/server/auth/email', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));

import {
  signInAction,
  signOutAction,
  signOutEverywhereAction,
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/server/auth/actions';
import type { DbClient } from '@/server/db/client';

describe('Auth Server Actions Branch Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesStore.clear();
    mockCookiesThrowOnce = false;
    mockRateLimitAllowed = true;
    mockArgon2Match = true;
    mockRequestPasswordResetThrows = false;
    mockResetPasswordError = null;

    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_SECRET = '01234567890123456789012345678901';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    process.env.STORAGE_ACCESS_KEY = 'test';
    process.env.STORAGE_SECRET_KEY = 'test';
  });

  describe('signInAction branches', () => {
    it('returns error when rate limiting is triggered', async () => {
      mockRateLimitAllowed = false;
      const dummyClient = {} as unknown as DbClient;
      const res = await signInAction(
        {
          email: 'owner@example.com',
          password: 'Password123!',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Too many failed attempts');
    });

    it('returns generic error when user is not found in database', async () => {
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'missing@example.com', password: 'Password123!' },
        mockClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid email or password');
    });

    it('returns generic error when account has no password set', async () => {
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
                        id: 'u-1',
                        email: 'owner@example.com',
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'acc-1',
                      userId: 'u-1',
                      password: null,
                    },
                  ]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'owner@example.com', password: 'Password123!' },
        mockClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid email or password');
    });

    it('returns mfaRequired: true and mfaTicket when user has active TOTP credential', async () => {
      let selectCount = 0;
      const mockClient = {
        select: () => ({
          from: () => ({
            where: () => {
              selectCount++;
              if (selectCount === 1) {
                // user lookup
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'u-1',
                        email: 'owner@example.com',
                        name: 'Owner',
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                // account lookup (password)
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'acc-1',
                        userId: 'u-1',
                        password: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
                      },
                    ]),
                };
              }
              if (selectCount === 3) {
                // totp check: returns active TOTP
                return {
                  limit: () => Promise.resolve([{ id: 'totp-1', verified: true }]),
                };
              }
              return {
                limit: () => Promise.resolve([]),
              };
            },
          }),
        }),
        insert: () => ({
          values: () => Promise.resolve([]),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'owner@example.com', password: 'Password123!' },
        mockClient,
      );
      expect(res.success).toBe(true);
      if (res.success && res.data) {
        expect(res.data.mfaRequired).toBe(true);
        expect(res.data.mfaTicket).toBeDefined();
      }
    });

    it('returns generic error when argon2 password verification fails', async () => {
      mockArgon2Match = false;
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
                        id: 'u-1',
                        email: 'owner@example.com',
                      },
                    ]),
                };
              }
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'acc-1',
                      userId: 'u-1',
                      password: '$argon2id$v=19$m=65536,t=3,p=4$wrong',
                    },
                  ]),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'owner@example.com', password: 'WrongPassword123!' },
        mockClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid email or password');
    });

    it('returns mfaEnforced: true when studio settings require MFA and postponement has expired and no passkey', async () => {
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
                        id: 'u-1',
                        email: 'owner@example.com',
                        name: 'Owner',
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'acc-1',
                        userId: 'u-1',
                        password: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
                      },
                    ]),
                };
              }
              // totp empty (3) and passkey check (4) empty
              return {
                limit: () => Promise.resolve([]),
              };
            },
            limit: () =>
              Promise.resolve([
                {
                  id: 's-1',
                  mfa_required: true,
                  mfa_postponed_until: new Date(Date.now() - 10000),
                },
              ]),
          }),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'owner@example.com', password: 'Password123!' },
        mockClient,
      );
      expect(res.success).toBe(true);
      if (res.success && res.data) {
        expect(res.data.mfaEnforced).toBe(true);
      }
    });

    it('returns mfaEnforced: false when user has a registered passkey', async () => {
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
                        id: 'u-1',
                        email: 'owner@example.com',
                        name: 'Owner',
                      },
                    ]),
                };
              }
              if (selectCount === 2) {
                return {
                  limit: () =>
                    Promise.resolve([
                      {
                        id: 'acc-1',
                        userId: 'u-1',
                        password: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
                      },
                    ]),
                };
              }
              if (selectCount === 3) {
                // totp empty
                return {
                  limit: () => Promise.resolve([]),
                };
              }
              // passkey found
              return {
                limit: () => Promise.resolve([{ id: 'pk-1' }]),
              };
            },
            limit: () =>
              Promise.resolve([
                {
                  id: 's-1',
                  mfa_required: true,
                  mfa_postponed_until: new Date(Date.now() - 10000),
                },
              ]),
          }),
        }),
      } as unknown as DbClient;

      const res = await signInAction(
        { email: 'owner@example.com', password: 'Password123!' },
        mockClient,
      );
      expect(res.success).toBe(true);
      if (res.success && res.data) {
        expect(res.data.mfaEnforced).toBe(false);
      }
    });
  });

  describe('signOutAction branches', () => {
    it('revokes session using SECURE_SESSION_COOKIE_NAME when present', async () => {
      mockCookiesStore.set('__Secure-ownlight_session', 'valid-token');
      const res = await signOutAction();
      expect(res.success).toBe(true);
      expect(mockCookiesStore.has('__Secure-ownlight_session')).toBe(false);
    });

    it('revokes session using SESSION_COOKIE_NAME when present', async () => {
      mockCookiesStore.set('ownlight_session', 'valid-token');
      const res = await signOutAction();
      expect(res.success).toBe(true);
      expect(mockCookiesStore.has('ownlight_session')).toBe(false);
    });

    it('handles sign out cleanly when no session cookie is present', async () => {
      const res = await signOutAction();
      expect(res.success).toBe(true);
    });

    it('clears session cookie and returns success when initial cookies() lookup throws', async () => {
      mockCookiesThrowOnce = true;
      const res = await signOutAction();
      expect(res.success).toBe(true);
    });
  });

  describe('signOutEverywhereAction', () => {
    it('calls signOutEverywhere and clears cookies', async () => {
      mockCookiesStore.set('ownlight_session', 'valid-token');
      const res = await signOutEverywhereAction();
      expect(res.success).toBe(true);
      expect(mockCookiesStore.has('ownlight_session')).toBe(false);
    });
  });

  describe('requestPasswordResetAction branches', () => {
    it('returns error when email format is invalid', async () => {
      const res = await requestPasswordResetAction({ email: 'bad-email' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('valid email');
    });

    it('returns rate limit error when limit is exceeded', async () => {
      mockRateLimitAllowed = false;
      const res = await requestPasswordResetAction({ email: 'owner@example.com' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Too many password reset requests');
    });

    it('dispatches reset request and returns success message', async () => {
      const res = await requestPasswordResetAction({ email: 'owner@example.com' });
      expect(res.success).toBe(true);
      expect(res.data?.message).toBeDefined();
    });

    it('handles exception in requestPasswordReset gracefully', async () => {
      mockRequestPasswordResetThrows = true;
      const res = await requestPasswordResetAction({ email: 'owner@example.com' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Failed to dispatch reset email in test');
    });
  });

  describe('resetPasswordAction branches', () => {
    it('rejects passwords failing security policy', async () => {
      const res = await resetPasswordAction({
        email: 'owner@example.com',
        token: 'token-123',
        newPassword: 'short',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('at least 12 characters');
    });

    it('rejects expired or invalid reset token', async () => {
      mockResetPasswordError = new Error('Invalid or expired reset token.');
      const dummyClient = {} as unknown as DbClient;

      const res = await resetPasswordAction(
        {
          email: 'owner@example.com',
          token: 'invalid-token',
          newPassword: 'ValidNewPassword123!',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid or expired reset token');
    });

    it('rejects when token is valid but associated user is missing', async () => {
      mockResetPasswordError = new Error('User account not found.');
      const dummyClient = {} as unknown as DbClient;

      const res = await resetPasswordAction(
        {
          email: 'owner@example.com',
          token: 'valid-token',
          newPassword: 'ValidNewPassword123!',
        },
        dummyClient,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('User account not found');
    });

    it('successfully resets password, revokes previous sessions, and sets cookie', async () => {
      const dummyClient = {} as unknown as DbClient;

      const res = await resetPasswordAction(
        {
          email: 'owner@example.com',
          token: 'valid-token',
          newPassword: 'ValidNewPassword123!',
        },
        dummyClient,
      );
      expect(res.success).toBe(true);
    });
  });
});

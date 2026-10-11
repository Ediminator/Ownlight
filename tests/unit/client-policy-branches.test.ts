import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

let mockAuditThrows = false;
const mockAuditFn = vi.fn().mockImplementation(() => {
  if (mockAuditThrows) {
    return Promise.reject(new Error('Audit DB down'));
  }
  return Promise.resolve();
});

vi.mock('@/server/audit', () => ({
  audit: (...args: unknown[]): Promise<void> => mockAuditFn(...args) as Promise<void>,
}));

import { authorizeClientRead, authorizeClientWrite } from '@/server/clients/policy';
import { ForbiddenError, type AuthContext } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

type ApiKeyType = NonNullable<AuthContext['apiKey']>;

function createMockUser(role: 'owner' | 'member' = 'owner') {
  return {
    id: 'u1',
    name: role === 'owner' ? 'Owner' : 'Member',
    email: `${role}@example.com`,
    emailVerified: true,
    image: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockSession() {
  return {
    id: 's1',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(),
    token: 'token-s1',
    ipAddress: null,
    userAgent: null,
    userId: 'u1',
    lastReauthenticatedAt: new Date(),
  };
}

function createMockApiKey(overrides: Partial<ApiKeyType> = {}): ApiKeyType {
  return {
    id: 'k1',
    prefix: 'ownlight_live_k1',
    tokenHash: 'mock-token-hash',
    name: 'Test Key',
    scopes: ['clients:read'],
    userId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('src/server/clients/policy branch coverage', () => {
  const mockDbClient = {} as DbClient;

  beforeEach(() => {
    mockAuditThrows = false;
    vi.clearAllMocks();
  });

  describe('authorizeClientRead', () => {
    it('throws ForbiddenError when role is not owner', async () => {
      const nonOwnerContext: AuthContext = {
        user: createMockUser('member'),
        scopes: ['*'],
        authType: 'session',
        session: createMockSession(),
      };

      await expect(authorizeClientRead(nonOwnerContext)).rejects.toThrow(
        new ForbiddenError('Owner role required to read client resources.'),
      );
    });

    it('throws ForbiddenError when scopes lack both * and clients:read', async () => {
      const noScopeContext: AuthContext = {
        user: createMockUser('owner'),
        scopes: ['settings:read'],
        authType: 'apiKey',
        apiKey: createMockApiKey({ scopes: ['settings:read'] }),
      };

      await expect(authorizeClientRead(noScopeContext)).rejects.toThrow(
        new ForbiddenError('Insufficient permissions. Required scope: clients:read'),
      );
    });

    it('returns context when owner has clients:read scope', async () => {
      const readScopeContext: AuthContext = {
        user: createMockUser('owner'),
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: createMockApiKey({ scopes: ['clients:read'] }),
      };

      const res = await authorizeClientRead(readScopeContext);
      expect(res).toBe(readScopeContext);
    });
  });

  describe('authorizeClientWrite', () => {
    it('throws ForbiddenError and audits denied event for non-owner role', async () => {
      const nonOwnerContext: AuthContext = {
        user: createMockUser('member'),
        scopes: ['*'],
        authType: 'session',
        session: createMockSession(),
      };

      await expect(
        authorizeClientWrite('client.create', null, nonOwnerContext, mockDbClient),
      ).rejects.toThrow(new ForbiddenError('Owner role required to modify client resources.'));

      expect(mockAuditFn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'client.create',
          outcome: 'denied',
          actorType: 'member',
          actorId: 'u1',
        }),
        mockDbClient,
      );
    });

    it('throws ForbiddenError and audits with token actor when apiKey lacks clients:write scope', async () => {
      const apiKeyContext: AuthContext = {
        user: createMockUser('owner'),
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: createMockApiKey({ scopes: ['clients:read'] }),
      };

      await expect(
        authorizeClientWrite('client.update', 'c-1', apiKeyContext, mockDbClient),
      ).rejects.toThrow(
        new ForbiddenError('Insufficient permissions. Required scope: clients:write'),
      );

      expect(mockAuditFn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'client.update',
          outcome: 'denied',
          actorType: 'token',
          actorId: 'k1',
          targetId: 'c-1',
        }),
        mockDbClient,
      );
    });

    it('falls back to apiKey prefix when apiKey.id is missing', async () => {
      const apiKeyPrefixContext: AuthContext = {
        user: createMockUser('owner'),
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: createMockApiKey({
          id: undefined as unknown as string,
          prefix: 'ownlight_live_pref',
        }),
      };

      await expect(
        authorizeClientWrite('client.delete', 'c-2', apiKeyPrefixContext, mockDbClient),
      ).rejects.toThrow(ForbiddenError);

      expect(mockAuditFn).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'token',
          actorId: 'ownlight_live_pref',
        }),
        mockDbClient,
      );
    });

    it('gracefully catches audit errors during authorization denial without masking ForbiddenError', async () => {
      mockAuditThrows = true;
      const nonOwnerContext: AuthContext = {
        user: createMockUser('member'),
        scopes: ['*'],
        authType: 'session',
        session: createMockSession(),
      };

      await expect(
        authorizeClientWrite('client.create', null, nonOwnerContext, mockDbClient),
      ).rejects.toThrow(new ForbiddenError('Owner role required to modify client resources.'));
    });

    it('returns context when owner has clients:write scope', async () => {
      const writeScopeContext: AuthContext = {
        user: createMockUser('owner'),
        scopes: ['clients:write'],
        authType: 'apiKey',
        apiKey: createMockApiKey({ scopes: ['clients:write'] }),
      };

      const res = await authorizeClientWrite(
        'client.create',
        'c-3',
        writeScopeContext,
        mockDbClient,
      );
      expect(res).toBe(writeScopeContext);
      expect(mockAuditFn).not.toHaveBeenCalled();
    });
  });
});

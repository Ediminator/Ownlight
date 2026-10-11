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
  audit: (...args: unknown[]) => mockAuditFn(...args),
}));

import { authorizeClientRead, authorizeClientWrite } from '@/server/clients/policy';
import { ForbiddenError, type AuthContext } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

describe('src/server/clients/policy branch coverage', () => {
  const mockDbClient = {} as DbClient;

  beforeEach(() => {
    mockAuditThrows = false;
    vi.clearAllMocks();
  });

  describe('authorizeClientRead', () => {
    it('throws ForbiddenError when role is not owner', async () => {
      const nonOwnerContext: AuthContext = {
        user: { id: 'u1', name: 'Member', email: 'member@example.com', role: 'member' },
        scopes: ['*'],
        authType: 'session',
        session: { id: 's1' },
      };

      await expect(authorizeClientRead(nonOwnerContext)).rejects.toThrow(
        new ForbiddenError('Owner role required to read client resources.'),
      );
    });

    it('throws ForbiddenError when scopes lack both * and clients:read', async () => {
      const noScopeContext: AuthContext = {
        user: { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        scopes: ['settings:read'],
        authType: 'apiKey',
        apiKey: { id: 'k1', prefix: 'ownlight_live_k1' },
      };

      await expect(authorizeClientRead(noScopeContext)).rejects.toThrow(
        new ForbiddenError('Insufficient permissions. Required scope: clients:read'),
      );
    });

    it('returns context when owner has clients:read scope', async () => {
      const readScopeContext: AuthContext = {
        user: { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: { id: 'k1', prefix: 'ownlight_live_k1' },
      };

      const res = await authorizeClientRead(readScopeContext);
      expect(res).toBe(readScopeContext);
    });
  });

  describe('authorizeClientWrite', () => {
    it('throws ForbiddenError and audits denied event for non-owner role', async () => {
      const nonOwnerContext: AuthContext = {
        user: { id: 'u1', name: 'Member', email: 'member@example.com', role: 'member' },
        scopes: ['*'],
        authType: 'session',
        session: { id: 's1' },
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
        user: { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: { id: 'k1', prefix: 'ownlight_live_k1' },
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
        user: { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        scopes: ['clients:read'],
        authType: 'apiKey',
        apiKey: { id: undefined as unknown as string, prefix: 'ownlight_live_pref' },
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
        user: { id: 'u1', name: 'Member', email: 'member@example.com', role: 'member' },
        scopes: ['*'],
        authType: 'session',
        session: { id: 's1' },
      };

      await expect(
        authorizeClientWrite('client.create', null, nonOwnerContext, mockDbClient),
      ).rejects.toThrow(new ForbiddenError('Owner role required to modify client resources.'));
    });

    it('returns context when owner has clients:write scope', async () => {
      const writeScopeContext: AuthContext = {
        user: { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        scopes: ['clients:write'],
        authType: 'apiKey',
        apiKey: { id: 'k1', prefix: 'ownlight_live_k1' },
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

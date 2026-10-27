import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockRequireOwner = vi.fn();

vi.mock('@/server/auth/guards', () => ({
  requireOwner: (...args: unknown[]) => mockRequireOwner(...args) as Promise<AuthContext>,
}));

import { resolveRepoAuth, UnauthenticatedError } from '@/server/auth/repo-auth';
import type { AuthContext } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

describe('TASK-0056: resolveRepoAuth Unit Tests (AC-7)', () => {
  const dummyOwnerAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Owner',
      email: 'owner@example.org',
      role: 'owner',
      image: null,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  const dummyClientAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000002',
      name: 'Client',
      email: 'client@example.org',
      role: 'client',
      image: null,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: [],
  };

  const mockDbClient = {
    select: vi.fn(),
    transaction: vi.fn(),
  } as unknown as DbClient;

  it('AC-7: accepts direct owner AuthContext', async () => {
    const result = await resolveRepoAuth(dummyOwnerAuth, mockDbClient);
    expect(result.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(result.client).toBe(mockDbClient);

    // Fallback to defaultDb when explicitClient is omitted
    const resultWithDefaultDb = await resolveRepoAuth(dummyOwnerAuth);
    expect(resultWithDefaultDb.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(resultWithDefaultDb.client).toBeDefined();
  });

  it('AC-7: rejects non-owner direct AuthContext with UNAUTHENTICATED', async () => {
    await expect(resolveRepoAuth(dummyClientAuth, mockDbClient)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('AC-7: accepts options object with explicit owner auth', async () => {
    const result = await resolveRepoAuth({ auth: dummyOwnerAuth, client: mockDbClient });
    expect(result.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(result.client).toBe(mockDbClient);

    // Fallback to defaultDb in options object
    const resultDefaultInOptions = await resolveRepoAuth({ auth: dummyOwnerAuth });
    expect(resultDefaultInOptions.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(resultDefaultInOptions.client).toBeDefined();
  });

  it('AC-7: rejects options object with non-owner auth or null auth', async () => {
    await expect(resolveRepoAuth({ auth: dummyClientAuth, client: mockDbClient })).rejects.toThrow(
      'UNAUTHENTICATED',
    );

    await expect(resolveRepoAuth({ auth: null, client: mockDbClient })).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });

  it('AC-7: rejects when no active session exists in headers/cookies', async () => {
    mockRequireOwner.mockRejectedValue(new Error('No session'));
    await expect(resolveRepoAuth(mockDbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(resolveRepoAuth(undefined, mockDbClient)).rejects.toThrow('UNAUTHENTICATED');
    await expect(resolveRepoAuth({ client: mockDbClient })).rejects.toThrow('UNAUTHENTICATED');
    await expect(resolveRepoAuth()).rejects.toThrow('UNAUTHENTICATED');
  });

  it('AC-7: delegates to requireOwner when auth is omitted in options or client passed directly', async () => {
    mockRequireOwner.mockResolvedValue(dummyOwnerAuth);
    const res1 = await resolveRepoAuth({ client: mockDbClient });
    expect(res1.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(res1.client).toBe(mockDbClient);

    const res2 = await resolveRepoAuth(mockDbClient);
    expect(res2.auth.user.id).toBe(dummyOwnerAuth.user.id);
    expect(res2.client).toBe(mockDbClient);
  });
});

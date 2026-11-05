import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getProposalPublicLinkAction } from '@/server/proposals/actions';
import { ForbiddenError } from '@/server/auth/guards';

const mockRequireOwner = vi.fn();
vi.mock('@/server/auth/guards', async () => {
  const actual =
    await vi.importActual<typeof import('@/server/auth/guards')>('@/server/auth/guards');
  return {
    ...actual,
    requireOwner: (...args: unknown[]): unknown => mockRequireOwner(...args),
  };
});

const mockGetProposalById = vi.fn();
vi.mock('@/server/proposals/repo', async () => {
  const actual =
    await vi.importActual<typeof import('@/server/proposals/repo')>('@/server/proposals/repo');
  return {
    ...actual,
    getProposalById: (...args: unknown[]): unknown => mockGetProposalById(...args),
  };
});

describe('getProposalPublicLinkAction unit tests', () => {
  const validProposalId = '01920000-0000-7000-8000-000000000202';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-2: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    mockRequireOwner.mockRejectedValue(new Error('Unauthorized'));

    const result = await getProposalPublicLinkAction({ proposalId: validProposalId });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('UNAUTHENTICATED');
    }
  });

  it('AC-2: rejects non-owner caller with FORBIDDEN', async () => {
    mockRequireOwner.mockRejectedValue(new ForbiddenError('Forbidden'));

    const result = await getProposalPublicLinkAction({ proposalId: validProposalId });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('FORBIDDEN');
    }
  });

  it('AC-2: rejects invalid non-uuid proposalId with VALIDATION_FAILED', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });

    const result = await getProposalPublicLinkAction({ proposalId: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_FAILED');
    }
  });

  it('AC-2: returns NOT_FOUND if proposal does not exist', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue(null);

    const result = await getProposalPublicLinkAction({ proposalId: validProposalId });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('AC-2: returns REVOKED if proposal token is revoked', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: new Date(),
    });

    const result = await getProposalPublicLinkAction({ proposalId: validProposalId });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('REVOKED');
    }
  });

  it('AC-2: resolves proposal public link from email outbox', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: null,
    });

    const sampleToken = 'tok-preview';
    const mockDbClient = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          payload: {
            token: sampleToken,
            tokenUrl: `/p/${sampleToken}`,
          },
        },
      ]),
    };

    const result = await getProposalPublicLinkAction(
      { proposalId: validProposalId },
      mockDbClient as never,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposalId).toBe(validProposalId);
      expect(result.data.token).toBe(sampleToken);
      expect(result.data.tokenUrl).toBe(`/p/${sampleToken}`);
    }
  });

  it('AC-2: uses fallback tokenUrl when outbox payload omits tokenUrl', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: null,
    });

    const sampleToken = 'tok-fallback';
    const mockDbClient = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          payload: {
            token: sampleToken,
          },
        },
      ]),
    };

    const result = await getProposalPublicLinkAction(
      { proposalId: validProposalId },
      mockDbClient as never,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokenUrl).toBe(`/p/${sampleToken}`);
    }
  });

  it('AC-2: returns NOT_FOUND when outbox payload token is missing', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: null,
    });

    const mockDbClient = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          payload: {},
        },
      ]),
    };

    const result = await getProposalPublicLinkAction(
      { proposalId: validProposalId },
      mockDbClient as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toBe('Proposal link not available');
    }
  });

  it('AC-2: catches unexpected Error in getProposalPublicLinkAction', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: null,
    });

    const mockDbClient = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('Outbox query failed')),
    };

    const result = await getProposalPublicLinkAction(
      { proposalId: validProposalId },
      mockDbClient as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toBe('Outbox query failed');
    }
  });

  it('AC-2: catches unexpected non-Error in getProposalPublicLinkAction', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { id: 'owner-1', role: 'owner' },
      session: { id: 'sess-1' },
      authType: 'session',
    });
    mockGetProposalById.mockResolvedValue({
      id: validProposalId,
      status: 'sent',
      tokenRevokedAt: null,
    });

    const mockDbClient = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue('Fatal string exception'),
    };

    const result = await getProposalPublicLinkAction(
      { proposalId: validProposalId },
      mockDbClient as never,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toBe('Internal error resolving proposal link');
    }
  });
});

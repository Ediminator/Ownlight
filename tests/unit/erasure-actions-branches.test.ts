import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

let mockHeadersThrow = false;
let mockBearerToken: string | null = null;
let mockOrigin: string | null = null;
let mockHost = 'localhost:3000';

vi.mock('next/headers', () => ({
  headers: () => {
    if (mockHeadersThrow) {
      return Promise.reject(new Error('Headers unavailable'));
    }
    const h = new Headers();
    if (mockBearerToken) {
      h.set('authorization', `Bearer ${mockBearerToken}`);
    }
    if (mockOrigin) {
      h.set('origin', mockOrigin);
    }
    if (mockHost) {
      h.set('host', mockHost);
    }
    return Promise.resolve(h);
  },
}));

let mockOwnerThrowsForbidden = false;
let mockOwnerThrowsUnauthorized = false;
const mockOwnerUser = {
  id: '018f0000-0000-7000-8000-000000000001',
  name: 'Studio Owner',
  email: 'owner@example.org',
  role: 'owner',
};

vi.mock('@/server/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/guards')>();
  return {
    ...actual,
    extractBearerToken: (h: Headers) => {
      const authHeader = h.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
      }
      return null;
    },
    requireOwnerSession: () => {
      if (mockOwnerThrowsForbidden) {
        throw new actual.ForbiddenError('Action requires studio owner role.');
      }
      if (mockOwnerThrowsUnauthorized) {
        throw new Error('Authentication required.');
      }
      return Promise.resolve({
        user: mockOwnerUser,
        session: { id: 'session-1' },
      });
    },
  };
});

let mockReauthThrows = false;
vi.mock('@/server/auth/reauth', () => ({
  assertFreshReauthentication: () => {
    if (mockReauthThrows) {
      return Promise.reject(new Error('Re-authentication required.'));
    }
    return Promise.resolve();
  },
}));

let mockClientRow: { id: string; displayName: string } | null = {
  id: '018f0000-0000-7000-8000-000000000010',
  displayName: 'Alice Client',
};
let mockContactRow: { id: string } | null = {
  id: '018f0000-0000-7000-8000-000000000020',
};

import { clientContacts } from '@/server/db/schema/clients';

vi.mock('@/server/db/client', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === clientContacts) {
              return Promise.resolve(mockContactRow ? [mockContactRow] : []);
            }
            return Promise.resolve(mockClientRow ? [mockClientRow] : []);
          },
        }),
      }),
    }),
  },
}));

let mockPlanErasureResult: unknown = {
  subject: { kind: 'client', clientId: '018f0000-0000-7000-8000-000000000010' },
  holds: [],
  categoryCounts: { client: 1 },
};

let mockEraseSubjectResult: unknown = {
  success: true,
  categoryCounts: { client: 1 },
};

vi.mock('@/server/privacy/erasure/service', () => ({
  planErasure: () => Promise.resolve(mockPlanErasureResult),
  eraseSubject: () => Promise.resolve(mockEraseSubjectResult),
}));

import { planErasureAction, executeErasureAction } from '@/server/privacy/erasure/actions';

describe('privacy/erasure/actions branch coverage', () => {
  const validClientId = '018f0000-0000-7000-8000-000000000010';
  const validContactId = '018f0000-0000-7000-8000-000000000020';

  beforeEach(() => {
    mockHeadersThrow = false;
    mockBearerToken = null;
    mockOrigin = null;
    mockHost = 'localhost:3000';
    mockOwnerThrowsForbidden = false;
    mockOwnerThrowsUnauthorized = false;
    mockReauthThrows = false;
    mockClientRow = {
      id: validClientId,
      displayName: 'Alice Client',
    };
    mockContactRow = {
      id: validContactId,
    };
    mockPlanErasureResult = {
      subject: { kind: 'client', clientId: validClientId },
      holds: [],
      categoryCounts: { client: 1 },
    };
    mockEraseSubjectResult = {
      success: true,
      categoryCounts: { client: 1 },
    };
    vi.clearAllMocks();
  });

  describe('planErasureAction', () => {
    it('rejects API key bearer with FORBIDDEN', async () => {
      mockBearerToken = 'ownlight_live_test_key';
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('rejects foreign origin with FORBIDDEN', async () => {
      mockOrigin = 'http://evil.com';
      mockHost = 'localhost:3000';
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('allows matching host origin', async () => {
      mockOrigin = 'http://localhost:3000';
      mockHost = 'localhost:3000';
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(true);
    });

    it('handles headers exception gracefully', async () => {
      mockHeadersThrow = true;
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(true);
    });

    it('handles requireOwnerSession ForbiddenError and UnauthorizedError', async () => {
      mockOwnerThrowsForbidden = true;
      const res1 = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('FORBIDDEN');
      }

      mockOwnerThrowsForbidden = false;
      mockOwnerThrowsUnauthorized = true;
      const res2 = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('UNAUTHORIZED');
      }
    });

    it('handles invalid schema input with VALIDATION_FAILED', async () => {
      const res = await planErasureAction({
        subject: { kind: 'invalid', clientId: 'not-a-uuid' },
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('returns NOT_FOUND when planErasure returns null', async () => {
      mockPlanErasureResult = null;
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('returns success with plan when valid', async () => {
      const res = await planErasureAction({
        subject: { kind: 'client', clientId: validClientId },
      });
      expect(res.success).toBe(true);
    });
  });

  describe('executeErasureAction', () => {
    it('rejects API key with FORBIDDEN', async () => {
      mockBearerToken = 'ownlight_live_test_key';
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('handles requireOwnerSession ForbiddenError and UnauthorizedError', async () => {
      mockOwnerThrowsForbidden = true;
      const res1 = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('FORBIDDEN');
      }

      mockOwnerThrowsForbidden = false;
      mockOwnerThrowsUnauthorized = true;
      const res2 = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('UNAUTHORIZED');
      }
    });

    it('handles invalid schema input with VALIDATION_FAILED', async () => {
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: 'bad' },
        confirmation: '',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('requires fresh re-authentication and returns REAUTH_REQUIRED', async () => {
      mockReauthThrows = true;
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('REAUTH_REQUIRED');
      }
    });

    it('returns NOT_FOUND when client does not exist in database', async () => {
      mockClientRow = null;
      mockContactRow = null;
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('returns CONFIRMATION_MISMATCH when confirmation does not match display name', async () => {
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Wrong Name',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('CONFIRMATION_MISMATCH');
      }
    });

    it('successfully executes client erasure', async () => {
      const res = await executeErasureAction({
        subject: { kind: 'client', clientId: validClientId },
        confirmation: 'Alice Client',
      });
      expect(res.success).toBe(true);
    });
  });
});

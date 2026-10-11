import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

let mockHeadersThrow = false;
let mockHeadersBearerToken: string | null = null;
vi.mock('next/headers', () => ({
  headers: () => {
    if (mockHeadersThrow) {
      return Promise.reject(new Error('Headers unavailable'));
    }
    const h = new Headers();
    if (mockHeadersBearerToken) {
      h.set('authorization', `Bearer ${mockHeadersBearerToken}`);
    }
    return Promise.resolve(h);
  },
}));

let mockOwnerThrowsForbidden = false;
let mockOwnerThrowsUnauthorized = false;
const mockAuthUser = {
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
        user: mockAuthUser,
        session: { id: 'session-1' },
      });
    },
  };
});

let mockStudioSettingsThrows = false;
vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: () => {
    if (mockStudioSettingsThrows) {
      return Promise.reject(new Error('Settings unavailable'));
    }
    return Promise.resolve({
      timezone: 'Europe/Berlin',
    });
  },
}));

let mockClientExists = true;
let mockExistingHold: {
  id: string;
  clientId: string;
  reason: 'dispute' | 'statutory' | 'other';
  note: string | null;
  until: string | null;
  setByActorType: 'owner';
  setByActorId: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null = null;

vi.mock('@/server/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              mockClientExists ? [{ id: '018f0000-0000-7000-8000-000000000010' }] : [],
            ),
        }),
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

let mockIsUpdate = false;
vi.mock('@/server/clients/legal-hold-repo', () => ({
  getLegalHold: () => Promise.resolve(mockExistingHold),
  upsertLegalHold: () =>
    Promise.resolve({
      hold: {
        id: '018f0000-0000-7000-8000-000000000099',
        clientId: '018f0000-0000-7000-8000-000000000010',
        reason: 'dispute' as const,
        note: 'Upserted hold',
        until: '2028-12-31',
        setByActorType: 'owner' as const,
        setByActorId: '018f0000-0000-7000-8000-000000000001',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isUpdate: mockIsUpdate,
    }),
  deleteLegalHold: () => Promise.resolve(),
}));

const mockAuditFn = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/audit', () => ({
  audit: (...args: unknown[]): Promise<void> => mockAuditFn(...args) as Promise<void>,
}));

import {
  setLegalHoldAction,
  releaseLegalHoldAction,
  getLegalHoldAction,
} from '@/server/clients/legal-hold-actions';

describe('legal-hold-actions branch coverage', () => {
  beforeEach(() => {
    mockHeadersThrow = false;
    mockHeadersBearerToken = null;
    mockOwnerThrowsForbidden = false;
    mockOwnerThrowsUnauthorized = false;
    mockStudioSettingsThrows = false;
    mockClientExists = true;
    mockExistingHold = null;
    vi.clearAllMocks();
  });

  describe('setLegalHoldAction', () => {
    const validClientId = '018f0000-0000-7000-8000-000000000010';

    it('rejects API key with 403 Forbidden', async () => {
      mockHeadersBearerToken = 'ownlight_live_secret';
      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('handles headers() exception and continues', async () => {
      mockHeadersThrow = true;
      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
      });
      expect(res.success).toBe(true);
    });

    it('handles requireOwnerSession ForbiddenError and UnauthorizedError', async () => {
      mockOwnerThrowsForbidden = true;
      const res1 = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
      });
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('FORBIDDEN');
      }

      mockOwnerThrowsForbidden = false;
      mockOwnerThrowsUnauthorized = true;
      const res2 = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
      });
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('UNAUTHORIZED');
      }
    });

    it('handles invalid schema input', async () => {
      const res = await setLegalHoldAction({
        clientId: 'not-a-uuid',
        reason: 'dispute',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('validates calendar date format and non-numeric components', async () => {
      const res1 = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
        until: '2028-ab-cd',
      });
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('VALIDATION_FAILED');
        expect(res1.error).toContain('until must be a valid date in YYYY-MM-DD format');
      }

      const res2 = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
        until: '2028-02-31',
      });
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('VALIDATION_FAILED');
        expect(res2.error).toBe('Invalid calendar date for until.');
      }
    });

    it('falls back to UTC when getStudioSettings throws', async () => {
      mockStudioSettingsThrows = true;
      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
        until: '2028-12-31',
      });
      expect(res.success).toBe(true);
    });

    it('rejects past date in studio timezone', async () => {
      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
        until: '2020-01-01',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.error).toBe('until date must be today or in the future.');
      }
    });

    it('returns NOT_FOUND when client does not exist', async () => {
      mockClientExists = false;
      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('emits client.legal_hold.updated when an existing hold is updated', async () => {
      mockIsUpdate = true;
      mockExistingHold = {
        id: '018f0000-0000-7000-8000-000000000099',
        clientId: validClientId,
        reason: 'statutory',
        note: 'Old hold',
        until: '2028-01-01',
        setByActorType: 'owner',
        setByActorId: mockAuthUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const res = await setLegalHoldAction({
        clientId: validClientId,
        reason: 'dispute',
        note: '   ',
      });

      expect(res.success).toBe(true);
      expect(mockAuditFn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'client.legal_hold.updated',
        }),
        expect.anything(),
      );
    });
  });

  describe('releaseLegalHoldAction', () => {
    const validClientId = '018f0000-0000-7000-8000-000000000010';

    it('rejects API key with 403 Forbidden', async () => {
      mockHeadersBearerToken = 'ownlight_live_secret';
      const res = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('handles headers() exception and continues', async () => {
      mockHeadersThrow = true;
      mockExistingHold = {
        id: '018f0000-0000-7000-8000-000000000099',
        clientId: validClientId,
        reason: 'dispute',
        note: 'Note',
        until: null,
        setByActorType: 'owner',
        setByActorId: mockAuthUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const res = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res.success).toBe(true);
    });

    it('handles requireOwnerSession ForbiddenError and UnauthorizedError', async () => {
      mockOwnerThrowsForbidden = true;
      const res1 = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('FORBIDDEN');
      }

      mockOwnerThrowsForbidden = false;
      mockOwnerThrowsUnauthorized = true;
      const res2 = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('UNAUTHORIZED');
      }
    });

    it('handles invalid schema input', async () => {
      const res = await releaseLegalHoldAction({ clientId: 'invalid-uuid' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('returns NOT_FOUND when client does not exist', async () => {
      mockClientExists = false;
      const res = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND when client exists but legal hold does not exist', async () => {
      mockExistingHold = null;
      const res = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
        expect(res.error).toBe('Legal hold not found.');
      }
    });

    it('successfully deletes legal hold and emits client.legal_hold.released', async () => {
      mockExistingHold = {
        id: '018f0000-0000-7000-8000-000000000099',
        clientId: validClientId,
        reason: 'dispute',
        note: 'Note',
        until: null,
        setByActorType: 'owner',
        setByActorId: mockAuthUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const res = await releaseLegalHoldAction({ clientId: validClientId });
      expect(res.success).toBe(true);
      expect(mockAuditFn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'client.legal_hold.released',
        }),
        expect.anything(),
      );
    });
  });

  describe('getLegalHoldAction', () => {
    const validClientId = '018f0000-0000-7000-8000-000000000010';

    it('rejects API key with 403 Forbidden', async () => {
      mockHeadersBearerToken = 'ownlight_live_secret';
      const res = await getLegalHoldAction(validClientId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe('API keys are not permitted for legal hold actions.');
      }
    });

    it('handles headers() exception and continues', async () => {
      mockHeadersThrow = true;
      const res = await getLegalHoldAction(validClientId);
      expect(res.success).toBe(true);
    });

    it('handles requireOwnerSession UnauthorizedError', async () => {
      mockOwnerThrowsUnauthorized = true;
      const res = await getLegalHoldAction(validClientId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe('Authentication required.');
      }
    });
  });
});

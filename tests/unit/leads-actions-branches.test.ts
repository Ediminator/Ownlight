import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/server/db/client', () => ({
  db: {},
}));

const hoisted = vi.hoisted(() => {
  class MockForbiddenError extends Error {
    override name = 'ForbiddenError';
  }
  return {
    MockForbiddenError,
    mockBearerHeader: { current: null as string | null },
    mockHeadersShouldThrow: { current: false },
    revalidateShouldThrow: { current: false },
    mockRequireOwnerSession: vi.fn(),
    mockAssertFreshReauthentication: vi.fn(),
    mockGenerateExport: vi.fn(),
    mockChangeLeadStatus: vi.fn(),
    mockDeleteLeads: vi.fn(),
    mockDeleteAllSpamLeads: vi.fn(),
    mockGetLeadCounts: vi.fn(),
    revalidatePathMock: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  headers: () => {
    if (hoisted.mockHeadersShouldThrow.current) {
      throw new Error('headers() called outside request context');
    }
    return Promise.resolve({
      get: (name: string) => {
        if (name.toLowerCase() === 'authorization') {
          return hoisted.mockBearerHeader.current;
        }
        return null;
      },
    });
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((...args: unknown[]) => {
    if (hoisted.revalidateShouldThrow.current) {
      throw new Error('revalidatePath failed');
    }
    hoisted.revalidatePathMock(...args);
  }),
}));

vi.mock('@/server/auth/guards', () => ({
  requireOwnerSession: (...args: unknown[]): unknown =>
    hoisted.mockRequireOwnerSession(...args) as unknown,
  extractBearerToken: (headersObj: { get: (name: string) => string | null } | null) => {
    const auth = headersObj?.get('authorization');
    if (auth?.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  },
  ForbiddenError: hoisted.MockForbiddenError,
}));

vi.mock('@/server/auth/reauth', () => ({
  assertFreshReauthentication: (...args: unknown[]): unknown =>
    hoisted.mockAssertFreshReauthentication(...args) as unknown,
}));

vi.mock('@/server/privacy/export/service', () => ({
  generateExport: (...args: unknown[]): unknown => hoisted.mockGenerateExport(...args) as unknown,
}));

vi.mock('@/server/leads/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/leads/service')>();
  return {
    ...actual,
    changeLeadStatus: (...args: unknown[]): unknown =>
      hoisted.mockChangeLeadStatus(...args) as unknown,
    deleteLeads: (...args: unknown[]): unknown => hoisted.mockDeleteLeads(...args) as unknown,
    deleteAllSpamLeads: (...args: unknown[]): unknown =>
      hoisted.mockDeleteAllSpamLeads(...args) as unknown,
  };
});

vi.mock('@/server/leads/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/leads/repo')>();
  return {
    ...actual,
    getLeadCounts: (...args: unknown[]): unknown => hoisted.mockGetLeadCounts(...args) as unknown,
  };
});

import {
  changeLeadStatusAction,
  deleteLeadsAction,
  exportLeadDsarAction,
  getLeadCountsAction,
} from '@/server/leads/actions';
import { isAllowedLeadStatusTransition, type LeadStatus } from '@/server/leads/transitions';
import type { DbClient } from '@/server/db/client';

const {
  MockForbiddenError,
  mockBearerHeader,
  mockHeadersShouldThrow,
  revalidateShouldThrow,
  mockRequireOwnerSession,
  mockAssertFreshReauthentication,
  mockGenerateExport,
  mockChangeLeadStatus,
  mockDeleteLeads,
  mockDeleteAllSpamLeads,
  mockGetLeadCounts,
  revalidatePathMock,
} = hoisted;

const mockDbClient = {} as unknown as DbClient;

const dummyLead = {
  id: '018f0000-0000-7000-8000-000000000001',
  formId: '018f0000-0000-7000-8000-000000000002',
  noticeVersionId: '018f0000-0000-7000-8000-000000000003',
  clientId: null,
  status: 'new' as const,
  verification: 'verified' as const,
  locale: 'en',
  email: 'client@example.org',
  emailNormalized: 'client@example.org',
  givenName: 'Jane',
  familyName: 'Doe',
  phone: '+49 30 123456',
  eventTypeKey: 'wedding',
  eventDate: '2026-06-20',
  eventLocation: 'Berlin',
  message: 'Inquiry',
  deliveryMode: 'hosted' as const,
  autoReplyStatus: 'sent' as const,
  convertedAt: null,
  receivedAt: new Date('2026-10-10T10:00:00Z'),
  lastActivityAt: new Date('2026-10-10T10:00:00Z'),
  noticeAcknowledgedAt: new Date('2026-10-10T10:00:00Z'),
  createdAt: new Date('2026-10-10T10:00:00Z'),
  updatedAt: new Date('2026-10-10T10:00:00Z'),
};

describe('Leads Actions Branch Coverage Tests (TASK-0031 Iteration 3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBearerHeader.current = null;
    mockHeadersShouldThrow.current = false;
    revalidateShouldThrow.current = false;
    mockRequireOwnerSession.mockResolvedValue({
      user: { id: '018f0000-0000-7000-8000-000000000099' },
      session: { token: 'mock-session-token' },
    });
  });

  describe('checkBearerRejection & safeRevalidate branches', () => {
    it('handles headers() throwing an error gracefully without rejecting', async () => {
      mockHeadersShouldThrow.current = true;
      mockGetLeadCounts.mockResolvedValueOnce({
        all: 0,
        new: 0,
        contacted: 0,
        converted: 0,
        archived: 0,
        spam: 0,
      });

      const res = await getLeadCountsAction(mockDbClient);
      expect(res.success).toBe(true);
    });

    it('handles revalidatePath() throwing an error gracefully inside safeRevalidate', async () => {
      revalidateShouldThrow.current = true;
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: true,
        data: dummyLead,
        ...dummyLead,
      });

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted', mockDbClient);
      expect(res.success).toBe(true);
    });
  });

  describe('changeLeadStatusAction branch coverage', () => {
    it('supports positional arguments without thirdArgClient', async () => {
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: true,
        data: dummyLead,
        ...dummyLead,
      });

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted');
      expect(res.success).toBe(true);
      expect(mockChangeLeadStatus).toHaveBeenCalledWith(
        dummyLead.id,
        'contacted',
        '018f0000-0000-7000-8000-000000000099',
        expect.anything(),
      );
      expect(revalidatePathMock).toHaveBeenCalledWith('/leads');
    });

    it('supports positional arguments with thirdArgClient', async () => {
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: true,
        data: dummyLead,
        ...dummyLead,
      });

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted', mockDbClient);
      expect(res.success).toBe(true);
      expect(mockChangeLeadStatus).toHaveBeenCalledWith(
        dummyLead.id,
        'contacted',
        '018f0000-0000-7000-8000-000000000099',
        mockDbClient,
      );
      expect(revalidatePathMock).toHaveBeenCalledWith('/leads');
    });

    it('supports object argument with toStatus and secondArgOrClient as DbClient', async () => {
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: true,
        data: dummyLead,
        ...dummyLead,
      });

      const res = await changeLeadStatusAction(
        { leadId: dummyLead.id, toStatus: 'archived' },
        mockDbClient,
      );
      expect(res.success).toBe(true);
      expect(mockChangeLeadStatus).toHaveBeenCalledWith(
        dummyLead.id,
        'archived',
        '018f0000-0000-7000-8000-000000000099',
        mockDbClient,
      );
    });

    it('supports object argument with targetStatus', async () => {
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: true,
        data: dummyLead,
        ...dummyLead,
      });

      const res = await changeLeadStatusAction({
        leadId: dummyLead.id,
        targetStatus: 'spam',
      });
      expect(res.success).toBe(true);
      expect(mockChangeLeadStatus).toHaveBeenCalledWith(
        dummyLead.id,
        'spam',
        '018f0000-0000-7000-8000-000000000099',
        expect.anything(),
      );
    });

    it('rejects with VALIDATION_FAILED when schema safeParse fails', async () => {
      const res = await changeLeadStatusAction({ leadId: 'not-a-uuid', targetStatus: 'invalid' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.fields).toBeDefined();
      }
    });

    it('rejects with UNAUTHORIZED when bearer token is present', async () => {
      mockBearerHeader.current = 'Bearer secret-api-key';

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects with FORBIDDEN when requireOwnerSession throws ForbiddenError', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('rejects with UNAUTHORIZED when requireOwnerSession throws standard error', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new Error('No session'));

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns service failure without calling safeRevalidate when changeLeadStatus fails', async () => {
      mockChangeLeadStatus.mockResolvedValueOnce({
        success: false,
        code: 'INVALID_TRANSITION',
        error: 'INVALID_TRANSITION',
      });

      const res = await changeLeadStatusAction(dummyLead.id, 'contacted');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('INVALID_TRANSITION');
      }
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteLeadsAction branch coverage', () => {
    it('supports rawInput as array of lead IDs with DbClient', async () => {
      mockDeleteLeads.mockResolvedValueOnce({ success: true, count: 1, data: { count: 1 } });

      const res = await deleteLeadsAction([dummyLead.id], mockDbClient);
      expect(res.success).toBe(true);
      expect(mockDeleteLeads).toHaveBeenCalledWith([dummyLead.id], expect.anything(), mockDbClient);
      expect(revalidatePathMock).toHaveBeenCalledWith('/leads');
    });

    it('supports rawInput as a single string ID without DbClient', async () => {
      mockDeleteLeads.mockResolvedValueOnce({ success: true, count: 1, data: { count: 1 } });

      const res = await deleteLeadsAction(dummyLead.id);
      expect(res.success).toBe(true);
      expect(mockDeleteLeads).toHaveBeenCalledWith(
        [dummyLead.id],
        expect.anything(),
        expect.anything(),
      );
    });

    it('supports rawInput as an object with single leadId property', async () => {
      mockDeleteLeads.mockResolvedValueOnce({ success: true, count: 1, data: { count: 1 } });

      const res = await deleteLeadsAction({ leadId: dummyLead.id });
      expect(res.success).toBe(true);
      expect(mockDeleteLeads).toHaveBeenCalledWith(
        [dummyLead.id],
        expect.anything(),
        expect.anything(),
      );
    });

    it('supports rawInput as an object with leadIds array', async () => {
      mockDeleteLeads.mockResolvedValueOnce({ success: true, count: 2, data: { count: 2 } });

      const res = await deleteLeadsAction({ leadIds: [dummyLead.id, dummyLead.formId] });
      expect(res.success).toBe(true);
      expect(mockDeleteLeads).toHaveBeenCalledWith(
        [dummyLead.id, dummyLead.formId],
        expect.anything(),
        expect.anything(),
      );
    });

    it('supports rawInput as an object with deleteAllSpam: true', async () => {
      mockDeleteAllSpamLeads.mockResolvedValueOnce({ success: true, count: 3, data: { count: 3 } });

      const res = await deleteLeadsAction({ deleteAllSpam: true }, mockDbClient);
      expect(res.success).toBe(true);
      expect(mockDeleteAllSpamLeads).toHaveBeenCalledWith(expect.anything(), mockDbClient);
      expect(revalidatePathMock).toHaveBeenCalledWith('/leads');
    });

    it('handles rawInput as null, number, or unrecognized object gracefully', async () => {
      mockDeleteLeads.mockResolvedValue({ success: true, count: 0, data: { count: 0 } });

      const resNull = await deleteLeadsAction(null);
      expect(resNull.success).toBe(true);

      const resNumber = await deleteLeadsAction(123);
      expect(resNumber.success).toBe(true);

      const resUnrecognized = await deleteLeadsAction({ unrecognised: true });
      expect(resUnrecognized.success).toBe(true);
    });

    it('rejects with VALIDATION_FAILED when invalid leadId format is provided', async () => {
      const res = await deleteLeadsAction({ leadId: 'invalid-uuid-string' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.fields).toBeDefined();
      }
    });

    it('rejects with UNAUTHORIZED when bearer token is present', async () => {
      mockBearerHeader.current = 'Bearer test-token';

      const res = await deleteLeadsAction([dummyLead.id]);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects with FORBIDDEN when requireOwnerSession throws ForbiddenError', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));

      const res = await deleteLeadsAction([dummyLead.id]);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('rejects with UNAUTHORIZED when requireOwnerSession throws standard error', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new Error('Session invalid'));

      const res = await deleteLeadsAction([dummyLead.id]);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns failure when deleteLeads returns CONVERTED_LEAD without revalidating', async () => {
      mockDeleteLeads.mockResolvedValueOnce({
        success: false,
        code: 'CONVERTED_LEAD',
        error: 'CONVERTED_LEAD',
      });

      const res = await deleteLeadsAction([dummyLead.id]);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('CONVERTED_LEAD');
      }
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  describe('exportLeadDsarAction branch coverage', () => {
    it('supports rawInput as single string ID with mockDbClient', async () => {
      mockAssertFreshReauthentication.mockResolvedValueOnce(undefined);
      mockGenerateExport.mockResolvedValueOnce({
        content: '{"lead":"data"}',
        filename: 'lead-export.json',
        contentType: 'application/json',
        exportData: { lead: 'data' },
      });

      const res = await exportLeadDsarAction(dummyLead.id, mockDbClient);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.filename).toBe('lead-export.json');
        expect(res.downloadUrl).toContain('data:application/json;utf8,');
        expect(res.data.downloadUrl).toBe(res.downloadUrl);
      }
    });

    it('supports rawInput as object with format html and default db', async () => {
      mockAssertFreshReauthentication.mockResolvedValueOnce(undefined);
      mockGenerateExport.mockResolvedValueOnce({
        content: '<p>lead data</p>',
        filename: 'lead-export.html',
        contentType: 'text/html',
        exportData: { lead: 'data' },
      });

      const res = await exportLeadDsarAction({ leadId: dummyLead.id, format: 'html' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.filename).toBe('lead-export.html');
        expect(res.contentType).toBe('text/html');
      }
    });

    it('rejects with VALIDATION_FAILED when invalid leadId is passed', async () => {
      const res = await exportLeadDsarAction({ leadId: 'invalid-uuid-format' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects with UNAUTHORIZED when bearer token is present', async () => {
      mockBearerHeader.current = 'Bearer token-test';

      const res = await exportLeadDsarAction(dummyLead.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects with FORBIDDEN when requireOwnerSession throws ForbiddenError', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new MockForbiddenError());

      const res = await exportLeadDsarAction(dummyLead.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('rejects with UNAUTHORIZED when requireOwnerSession throws standard error', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new Error('Unauthenticated'));

      const res = await exportLeadDsarAction(dummyLead.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects with REAUTH_REQUIRED when assertFreshReauthentication throws', async () => {
      mockAssertFreshReauthentication.mockRejectedValueOnce(new Error('Reauth expired'));

      const res = await exportLeadDsarAction(dummyLead.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('REAUTH_REQUIRED');
      }
    });

    it('rejects with NOT_FOUND when generateExport returns null', async () => {
      mockAssertFreshReauthentication.mockResolvedValueOnce(undefined);
      mockGenerateExport.mockResolvedValueOnce(null);

      const res = await exportLeadDsarAction(dummyLead.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('getLeadCountsAction branch coverage', () => {
    it('returns counts successfully for authenticated owner with default db', async () => {
      mockGetLeadCounts.mockResolvedValueOnce({
        all: 10,
        new: 3,
        contacted: 2,
        converted: 1,
        archived: 2,
        spam: 2,
      });

      const res = await getLeadCountsAction();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.all).toBe(10);
        expect(res.data.new).toBe(3);
      }
    });

    it('rejects with UNAUTHORIZED when bearer token is present', async () => {
      mockBearerHeader.current = 'Bearer token-test';

      const res = await getLeadCountsAction();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects with FORBIDDEN when requireOwnerSession throws ForbiddenError', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new MockForbiddenError());

      const res = await getLeadCountsAction();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('rejects with UNAUTHORIZED when requireOwnerSession throws standard error', async () => {
      mockRequireOwnerSession.mockRejectedValueOnce(new Error('Auth failed'));

      const res = await getLeadCountsAction();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('isAllowedLeadStatusTransition exhaustive transition matrix', () => {
    const allStatuses: LeadStatus[] = ['new', 'contacted', 'archived', 'spam', 'converted'];

    it('rejects identical from and to statuses', () => {
      for (const s of allStatuses) {
        expect(isAllowedLeadStatusTransition(s, s)).toBe(false);
      }
    });

    it('rejects any transition involving converted as source or target', () => {
      for (const s of allStatuses) {
        expect(isAllowedLeadStatusTransition('converted', s)).toBe(false);
        expect(isAllowedLeadStatusTransition(s, 'converted')).toBe(false);
      }
    });

    it('permits all valid transitions and rejects invalid ones', () => {
      // from 'new': permitted to contacted, archived, spam
      expect(isAllowedLeadStatusTransition('new', 'contacted')).toBe(true);
      expect(isAllowedLeadStatusTransition('new', 'archived')).toBe(true);
      expect(isAllowedLeadStatusTransition('new', 'spam')).toBe(true);

      // from 'contacted': permitted to archived, spam
      expect(isAllowedLeadStatusTransition('contacted', 'archived')).toBe(true);
      expect(isAllowedLeadStatusTransition('contacted', 'spam')).toBe(true);
      expect(isAllowedLeadStatusTransition('contacted', 'new')).toBe(false);

      // from 'archived': permitted to new only
      expect(isAllowedLeadStatusTransition('archived', 'new')).toBe(true);
      expect(isAllowedLeadStatusTransition('archived', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('archived', 'spam')).toBe(false);

      // from 'spam': permitted to new only
      expect(isAllowedLeadStatusTransition('spam', 'new')).toBe(true);
      expect(isAllowedLeadStatusTransition('spam', 'contacted')).toBe(false);
      expect(isAllowedLeadStatusTransition('spam', 'archived')).toBe(false);

      // unknown status
      expect(isAllowedLeadStatusTransition('unknown' as LeadStatus, 'new')).toBe(false);
    });
  });
});

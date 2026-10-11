import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordConsentAction, listConsentsAction } from '@/server/consents/actions';
import * as guards from '@/server/auth/guards';
import * as policy from '@/server/clients/policy';
import * as service from '@/server/consents/service';

vi.mock('server-only', () => ({}));

vi.mock('@/server/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/guards')>();
  return {
    ...actual,
    requireAuth: vi.fn(),
  };
});

vi.mock('@/server/clients/policy', () => ({
  authorizeClientWrite: vi.fn(),
  authorizeClientRead: vi.fn(),
}));

vi.mock('@/server/consents/service', () => ({
  recordConsent: vi.fn(),
  listConsents: vi.fn(),
}));

describe('Consents server actions branches (recordConsentAction, listConsentsAction)', () => {
  const mockAuth: guards.AuthContext = {
    authType: 'session',
    scopes: ['*'],
    session: {
      id: 'sess-1',
      userId: 'user-1',
      token: 'tok-1',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      lastReauthenticatedAt: new Date(),
    },
    user: {
      id: 'user-1',
      name: 'Owner',
      email: 'owner@example.com',
      role: 'owner',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordConsentAction', () => {
    it('catches UnauthorizedError and returns UNAUTHORIZED', async () => {
      vi.mocked(guards.requireAuth).mockRejectedValueOnce(new guards.UnauthorizedError());

      const res = await recordConsentAction({});
      expect(res).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });
    });

    it('catches ForbiddenError from authorizeClientWrite and returns FORBIDDEN', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientWrite).mockRejectedValueOnce(
        new guards.ForbiddenError('clients:write required'),
      );

      const res = await recordConsentAction({ clientId: 'cl-1' });
      expect(res).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });
    });

    it('re-throws unexpected errors from auth/policy check', async () => {
      vi.mocked(guards.requireAuth).mockRejectedValueOnce(new Error('DB failure'));

      await expect(recordConsentAction({ clientId: 'cl-1' })).rejects.toThrow('DB failure');
    });

    it('returns VALIDATION_FAILED when schema parsing fails with various issue paths', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientWrite).mockResolvedValueOnce(mockAuth);

      // Invalid input missing required fields
      const res = await recordConsentAction({
        clientId: 'cl-1',
        // missing contactId, purpose, status, effectiveOn, method
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(Array.isArray(res.fields)).toBe(true);
      }
    });

    it('calls consentService.recordConsent when valid', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientWrite).mockResolvedValueOnce(mockAuth);
      vi.mocked(service.recordConsent).mockResolvedValueOnce({
        success: true,
        data: { consentId: 'c-uuid-1' },
      });

      const res = await recordConsentAction({
        clientId: '0192a3b4-c5d6-7e8f-9012-3456789abcde',
        contactId: '0192a3b4-c5d6-7e8f-9012-3456789abcdf',
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2026-10-11',
        method: 'in_person',
        scope: null,
        evidenceNote: null,
      });

      expect(res).toEqual({
        success: true,
        data: { consentId: 'c-uuid-1' },
      });
      expect(service.recordConsent).toHaveBeenCalled();
    });
  });

  describe('listConsentsAction', () => {
    it('catches UnauthorizedError and returns UNAUTHORIZED', async () => {
      vi.mocked(guards.requireAuth).mockRejectedValueOnce(new guards.UnauthorizedError());

      const res = await listConsentsAction({});
      expect(res).toEqual({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
      });
    });

    it('catches ForbiddenError and returns FORBIDDEN', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientRead).mockRejectedValueOnce(
        new guards.ForbiddenError('clients:read required'),
      );

      const res = await listConsentsAction({ clientId: 'cl-1' });
      expect(res).toEqual({
        success: false,
        code: 'FORBIDDEN',
        error: 'FORBIDDEN',
      });
    });

    it('re-throws unexpected error from policy check', async () => {
      vi.mocked(guards.requireAuth).mockRejectedValueOnce(new Error('Fatal error'));

      await expect(listConsentsAction({ clientId: 'cl-1' })).rejects.toThrow('Fatal error');
    });

    it('returns VALIDATION_FAILED when schema parsing fails', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientRead).mockResolvedValueOnce(mockAuth);

      const res = await listConsentsAction({ clientId: 'not-a-uuid' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('calls consentService.listConsents when valid', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(policy.authorizeClientRead).mockResolvedValueOnce(mockAuth);
      vi.mocked(service.listConsents).mockResolvedValueOnce({
        success: true,
        data: {
          clientId: '0192a3b4-c5d6-7e8f-9012-3456789abcde',
          contacts: [],
        },
      });

      const res = await listConsentsAction({
        clientId: '0192a3b4-c5d6-7e8f-9012-3456789abcde',
      });

      expect(res).toEqual({
        success: true,
        data: {
          clientId: '0192a3b4-c5d6-7e8f-9012-3456789abcde',
          contacts: [],
        },
      });
      expect(service.listConsents).toHaveBeenCalledWith(
        '0192a3b4-c5d6-7e8f-9012-3456789abcde',
        mockAuth,
      );
    });
  });

  describe('extractClientId helper edge cases via recordConsentAction', () => {
    it('handles null, non-object, object without clientId, and empty string clientId', async () => {
      vi.mocked(guards.requireAuth).mockResolvedValue(mockAuth);
      vi.mocked(policy.authorizeClientWrite).mockResolvedValue(mockAuth);

      await recordConsentAction(null);
      expect(policy.authorizeClientWrite).toHaveBeenCalledWith('consent.recorded', null, mockAuth);

      await recordConsentAction('a string');
      expect(policy.authorizeClientWrite).toHaveBeenCalledWith('consent.recorded', null, mockAuth);

      await recordConsentAction({});
      expect(policy.authorizeClientWrite).toHaveBeenCalledWith('consent.recorded', null, mockAuth);

      await recordConsentAction({ clientId: '' });
      expect(policy.authorizeClientWrite).toHaveBeenCalledWith('consent.recorded', null, mockAuth);

      await recordConsentAction({ clientId: 'cl-valid' });
      expect(policy.authorizeClientWrite).toHaveBeenCalledWith(
        'consent.recorded',
        'cl-valid',
        mockAuth,
      );
    });
  });
});

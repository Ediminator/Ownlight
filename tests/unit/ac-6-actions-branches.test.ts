import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', () => ({ db: {} }));

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
        throw new actual.UnauthorizedError('Authentication required.');
      }
      return Promise.resolve({
        user: mockOwnerUser,
        session: { id: 'session-1' },
      });
    },
  };
});

const mockCreateForm = vi.fn();
const mockUpdateForm = vi.fn();
const mockCreateNoticeVersion = vi.fn();
const mockPublishForm = vi.fn();
const mockUnpublishForm = vi.fn();
const mockArchiveForm = vi.fn();

vi.mock('@/server/inquiry-forms/service', () => ({
  createForm: (...args: unknown[]): unknown => mockCreateForm(...args) as unknown,
  updateForm: (...args: unknown[]): unknown => mockUpdateForm(...args) as unknown,
  createNoticeVersion: (...args: unknown[]): unknown => mockCreateNoticeVersion(...args) as unknown,
  publishForm: (...args: unknown[]): unknown => mockPublishForm(...args) as unknown,
  unpublishForm: (...args: unknown[]): unknown => mockUnpublishForm(...args) as unknown,
  archiveForm: (...args: unknown[]): unknown => mockArchiveForm(...args) as unknown,
}));

import {
  createInquiryFormAction,
  updateInquiryFormAction,
  createNoticeVersionAction,
  publishInquiryFormAction,
  unpublishInquiryFormAction,
  archiveInquiryFormAction,
} from '@/server/inquiry-forms/actions';

describe('TASK-0025: Inquiry Forms Server Actions Complete Branch Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadersThrow = false;
    mockHeadersBearerToken = null;
    mockOwnerThrowsForbidden = false;
    mockOwnerThrowsUnauthorized = false;

    mockCreateForm.mockResolvedValue({
      success: true,
      data: { id: 'form-1', name: 'Form 1', status: 'draft' },
    });
    mockUpdateForm.mockResolvedValue({
      success: true,
      data: { id: 'form-1', name: 'Form 1 Updated', status: 'draft' },
    });
    mockCreateNoticeVersion.mockResolvedValue({
      success: true,
      data: { id: 'v-2', version: 2 },
    });
    mockPublishForm.mockResolvedValue({
      success: true,
      data: { id: 'form-1', status: 'published' },
    });
    mockUnpublishForm.mockResolvedValue({
      success: true,
      data: { id: 'form-1', status: 'draft' },
    });
    mockArchiveForm.mockResolvedValue({
      success: true,
      data: { id: 'form-1', status: 'archived' },
    });
  });

  describe('Bearer Token Rejection and Header Error Branches', () => {
    it('returns FORBIDDEN for all actions when bearer token is present', async () => {
      mockHeadersBearerToken = 'api-key-test-token';

      const r1 = await createInquiryFormAction({ name: 'Test' });
      expect(r1).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r2 = await updateInquiryFormAction({ id: 'f-1' });
      expect(r2).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r3 = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
      });
      expect(r3).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r4 = await publishInquiryFormAction({ id: 'f-1' });
      expect(r4).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r5 = await unpublishInquiryFormAction({ id: 'f-1' });
      expect(r5).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r6 = await archiveInquiryFormAction({ id: 'f-1' });
      expect(r6).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });
    });

    it('gracefully handles headers() throwing an exception', async () => {
      mockHeadersThrow = true;
      const res = await createInquiryFormAction({ name: 'Valid Form' });
      expect(res.success).toBe(true);
    });
  });

  describe('Authentication and Authorization Error Branches', () => {
    it('returns FORBIDDEN when requireOwnerSession throws ForbiddenError', async () => {
      mockOwnerThrowsForbidden = true;

      const r1 = await createInquiryFormAction({ name: 'Test' });
      expect(r1).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r2 = await updateInquiryFormAction({ id: 'f-1' });
      expect(r2).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r3 = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
      });
      expect(r3).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r4 = await publishInquiryFormAction({ id: 'f-1' });
      expect(r4).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r5 = await unpublishInquiryFormAction({ id: 'f-1' });
      expect(r5).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      const r6 = await archiveInquiryFormAction({ id: 'f-1' });
      expect(r6).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });
    });

    it('returns UNAUTHORIZED when requireOwnerSession throws UnauthorizedError', async () => {
      mockOwnerThrowsUnauthorized = true;

      const r1 = await createInquiryFormAction({ name: 'Test' });
      expect(r1).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      const r2 = await updateInquiryFormAction({ id: 'f-1' });
      expect(r2).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      const r3 = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
      });
      expect(r3).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      const r4 = await publishInquiryFormAction({ id: 'f-1' });
      expect(r4).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      const r5 = await unpublishInquiryFormAction({ id: 'f-1' });
      expect(r5).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      const r6 = await archiveInquiryFormAction({ id: 'f-1' });
      expect(r6).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });
    });
  });

  describe('createInquiryFormAction Input Validation and Execution Branches', () => {
    it('returns VALIDATION_FAILED for invalid input (empty or too long)', async () => {
      const resEmpty = await createInquiryFormAction({ name: '   ' });
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.code).toBe('VALIDATION_FAILED');

      const resLong = await createInquiryFormAction({ name: 'a'.repeat(101) });
      expect(resLong.success).toBe(false);
      expect(resLong.code).toBe('VALIDATION_FAILED');

      const resExtra = await createInquiryFormAction({ name: 'Test', unexpected: 123 });
      expect(resExtra.success).toBe(false);
      expect(resExtra.code).toBe('VALIDATION_FAILED');
    });

    it('successfully calls createForm and returns service result', async () => {
      const res = await createInquiryFormAction({
        name: 'Wedding Studio Form',
        default_locale: 'de',
      });
      expect(res.success).toBe(true);
      expect(mockCreateForm).toHaveBeenCalledWith(
        { name: 'Wedding Studio Form', default_locale: 'de' },
        mockOwnerUser.id,
        expect.anything(),
      );
    });
  });

  describe('updateInquiryFormAction Branches', () => {
    it('returns VALIDATION_FAILED for invalid schema input', async () => {
      const resMissingId = await updateInquiryFormAction({ name: 'Missing ID' });
      expect(resMissingId.success).toBe(false);
      expect(resMissingId.code).toBe('VALIDATION_FAILED');

      const resEmptyName = await updateInquiryFormAction({ id: 'f-1', name: '' });
      expect(resEmptyName.success).toBe(false);
      expect(resEmptyName.code).toBe('VALIDATION_FAILED');

      const resInvalidUrl = await updateInquiryFormAction({
        id: 'f-1',
        success_redirect_url: 'http://insecure.com',
      });
      expect(resInvalidUrl.success).toBe(false);
      expect(resInvalidUrl.code).toBe('VALIDATION_FAILED');
    });

    it('successfully calls updateForm with full configuration', async () => {
      const input = {
        id: 'f-1',
        name: 'New Name',
        default_locale: 'en' as const,
        auto_reply_enabled: true,
        accept_unverified: false,
        success_redirect_url: 'https://example.org/thanks',
        fields: [{ key: 'given_name', enabled: true, required: true, order: 0 }],
        event_types: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
      };

      const res = await updateInquiryFormAction(input);
      expect(res.success).toBe(true);
      expect(mockUpdateForm).toHaveBeenCalledWith(
        'f-1',
        {
          name: 'New Name',
          default_locale: 'en',
          auto_reply_enabled: true,
          accept_unverified: false,
          success_redirect_url: 'https://example.org/thanks',
          fields: input.fields,
          event_types: input.event_types,
        },
        mockOwnerUser.id,
        expect.anything(),
      );
    });
  });

  describe('createNoticeVersionAction Branches', () => {
    it('returns VALIDATION_FAILED for invalid privacy policy URL', async () => {
      const r1 = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'http://not-https.com',
      });
      expect(r1.success).toBe(false);
      expect(r1.code).toBe('VALIDATION_FAILED');

      const r2 = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://',
      });
      expect(r2.success).toBe(false);
      expect(r2.code).toBe('VALIDATION_FAILED');
    });

    it('returns VALIDATION_FAILED for HTML tags in acknowledgement text', async () => {
      const rEn = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
        acknowledgement_text_en: 'Invalid <script>alert(1)</script>',
      });
      expect(rEn.success).toBe(false);
      expect(rEn.code).toBe('VALIDATION_FAILED');

      const rDe = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
        acknowledgement_text_de: 'Ungültig <b>HTML</b>',
      });
      expect(rDe.success).toBe(false);
      expect(rDe.code).toBe('VALIDATION_FAILED');
    });

    it('returns VALIDATION_FAILED for overly long text (>500 chars)', async () => {
      const rLong = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org',
        acknowledgement_text_en: 'a'.repeat(501),
      });
      expect(rLong.success).toBe(false);
      expect(rLong.code).toBe('VALIDATION_FAILED');
    });

    it('successfully calls createNoticeVersion with valid input', async () => {
      const res = await createNoticeVersionAction({
        formId: 'f-1',
        privacy_policy_url: 'https://example.org/privacy',
        acknowledgement_text_en: 'Valid English',
        acknowledgement_text_de: 'Gültiges Deutsch',
      });
      expect(res.success).toBe(true);
      expect(mockCreateNoticeVersion).toHaveBeenCalledWith(
        'f-1',
        {
          privacy_policy_url: 'https://example.org/privacy',
          acknowledgement_text_en: 'Valid English',
          acknowledgement_text_de: 'Gültiges Deutsch',
        },
        mockOwnerUser.id,
        expect.anything(),
      );
    });
  });

  describe('publish, unpublish, and archive Actions Branches', () => {
    it('returns VALIDATION_FAILED when id is missing or extra keys present', async () => {
      const rPub = await publishInquiryFormAction({});
      expect(rPub.code).toBe('VALIDATION_FAILED');

      const rUnpub = await unpublishInquiryFormAction({ id: 'f-1', extra: true });
      expect(rUnpub.code).toBe('VALIDATION_FAILED');

      const rArch = await archiveInquiryFormAction({ extra: 1 });
      expect(rArch.code).toBe('VALIDATION_FAILED');
    });

    it('successfully calls publishForm and handles precondition failure', async () => {
      mockPublishForm.mockResolvedValueOnce({
        success: false,
        code: 'PUBLISH_PRECONDITION_FAILED',
        error: 'Missing URL',
      });
      const resFail = await publishInquiryFormAction({ id: 'f-1' });
      expect(resFail.code).toBe('PUBLISH_PRECONDITION_FAILED');

      const resSuccess = await publishInquiryFormAction({ id: 'f-1' });
      expect(resSuccess.success).toBe(true);
    });

    it('successfully calls unpublishForm and archiveForm', async () => {
      const resUnpub = await unpublishInquiryFormAction({ id: 'f-1' });
      expect(resUnpub.success).toBe(true);
      expect(mockUnpublishForm).toHaveBeenCalledWith('f-1', mockOwnerUser.id, expect.anything());

      const resArch = await archiveInquiryFormAction({ id: 'f-1' });
      expect(resArch.success).toBe(true);
      expect(mockArchiveForm).toHaveBeenCalledWith('f-1', mockOwnerUser.id, expect.anything());
    });
  });
});

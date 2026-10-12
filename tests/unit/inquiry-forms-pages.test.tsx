import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => (key: string, values?: Record<string, unknown>) => {
    return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/settings/inquiry-forms',
}));

const mockRedirect = vi.fn();
const mockNotFound = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    mockNotFound();
    throw new Error('NOT_FOUND');
  },
}));

const mockRequireOwner = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: async (): Promise<unknown> => {
    return await mockRequireOwner();
  },
}));

const mockListForms = vi.fn<() => Promise<unknown>>();
const mockGetForm = vi.fn<(id: string) => Promise<unknown>>();
const mockGetNoticeVersions = vi.fn<(id: string) => Promise<unknown>>();

vi.mock('@/server/inquiry-forms/service', () => ({
  listForms: async (): Promise<unknown> => {
    return await mockListForms();
  },
  getForm: async (id: string): Promise<unknown> => {
    return await mockGetForm(id);
  },
  getNoticeVersions: async (id: string): Promise<unknown> => {
    return await mockGetNoticeVersions(id);
  },
}));

import InquiryFormsPage from '@/app/[locale]/settings/inquiry-forms/page';
import NewInquiryFormPage from '@/app/[locale]/settings/inquiry-forms/new/page';
import EditInquiryFormPage from '@/app/[locale]/settings/inquiry-forms/[id]/page';
import { SettingsNav } from '@/components/settings/settings-nav';
import { DEFAULT_FORM_FIELDS } from '@/server/inquiry-forms/schema';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';

describe('Inquiry Forms Route Pages & Navigation (AC-1, AC-8)', () => {
  const dummyForm: InquiryForm = {
    id: '018f0000-0000-7000-8000-000000000010',
    slug: 'formslug12',
    name: 'Portrait Inquiries',
    status: 'draft',
    defaultLocale: 'de',
    fields: DEFAULT_FORM_FIELDS,
    eventTypes: [{ key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' }],
    autoReplyEnabled: true,
    acceptUnverified: false,
    currentNoticeVersionId: '018f0000-0000-7000-8000-000000000020',
    successRedirectUrl: null,
    createdAt: new Date('2026-10-12T10:00:00Z'),
    updatedAt: new Date('2026-10-12T10:00:00Z'),
  };

  const dummyNoticeVersion: InquiryFormNoticeVersion = {
    id: '018f0000-0000-7000-8000-000000000020',
    formId: dummyForm.id,
    version: 1,
    acknowledgementTextEn: 'Notice EN',
    acknowledgementTextDe: 'Hinweis DE',
    privacyPolicyUrl: 'https://example.org/privacy',
    createdByActorId: '018f0000-0000-7000-8000-000000000000',
    createdAt: new Date('2026-10-12T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOwner.mockResolvedValue({
      user: { id: 'test-owner', role: 'owner' },
    });
  });

  describe('SettingsNav', () => {
    it('renders navigation links to security, google integration, and inquiry forms', () => {
      const html = renderToStaticMarkup(<SettingsNav />);
      expect(html).toContain('href="/settings/security"');
      expect(html).toContain('href="/settings/integrations/google"');
      expect(html).toContain('href="/settings/inquiry-forms"');
    });
  });

  describe('InquiryFormsPage', () => {
    it('redirects unauthenticated users to sign-in', async () => {
      mockRequireOwner.mockRejectedValueOnce(new Error('Unauthorized'));

      await expect(InquiryFormsPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
        'REDIRECT:/en/sign-in?callbackUrl=/en/settings/inquiry-forms',
      );
    });

    it('renders list view when authenticated', async () => {
      mockListForms.mockResolvedValueOnce([dummyForm]);

      const element = await InquiryFormsPage({
        params: Promise.resolve({ locale: 'en' }),
      });
      const html = renderToStaticMarkup(element);

      expect(html).toContain('data-testid="inquiry-forms-list-view"');
      expect(html).toContain('Portrait Inquiries');
    });
  });

  describe('NewInquiryFormPage', () => {
    it('redirects unauthenticated users to sign-in', async () => {
      mockRequireOwner.mockRejectedValueOnce(new Error('Unauthorized'));

      await expect(
        NewInquiryFormPage({ params: Promise.resolve({ locale: 'de' }) }),
      ).rejects.toThrow('REDIRECT:/de/sign-in?callbackUrl=/de/settings/inquiry-forms/new');
    });

    it('renders new form view when authenticated', async () => {
      const element = await NewInquiryFormPage({
        params: Promise.resolve({ locale: 'en' }),
      });
      const html = renderToStaticMarkup(element);

      expect(html).toContain('data-testid="new-inquiry-form-view"');
    });
  });

  describe('EditInquiryFormPage', () => {
    it('redirects unauthenticated users to sign-in', async () => {
      mockRequireOwner.mockRejectedValueOnce(new Error('Unauthorized'));

      await expect(
        EditInquiryFormPage({
          params: Promise.resolve({ locale: 'en', id: dummyForm.id }),
        }),
      ).rejects.toThrow(
        `REDIRECT:/en/sign-in?callbackUrl=/en/settings/inquiry-forms/${dummyForm.id}`,
      );
    });

    it('calls notFound() when form is missing or ID is empty', async () => {
      await expect(
        EditInquiryFormPage({
          params: Promise.resolve({ locale: 'en', id: '' }),
        }),
      ).rejects.toThrow('NOT_FOUND');

      mockGetForm.mockResolvedValueOnce(null);
      mockGetNoticeVersions.mockResolvedValueOnce([]);

      await expect(
        EditInquiryFormPage({
          params: Promise.resolve({ locale: 'en', id: 'unknown-id' }),
        }),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('renders edit view when form is found', async () => {
      mockGetForm.mockResolvedValueOnce(dummyForm);
      mockGetNoticeVersions.mockResolvedValueOnce([dummyNoticeVersion]);

      const element = await EditInquiryFormPage({
        params: Promise.resolve({ locale: 'en', id: dummyForm.id }),
      });
      const html = renderToStaticMarkup(element);

      expect(html).toContain('data-testid="inquiry-form-edit-view"');
      expect(html).toContain('Portrait Inquiries');
    });
  });
});

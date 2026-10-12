import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@/server/inquiry-forms/actions', () => ({
  createInquiryFormAction: vi.fn().mockResolvedValue({
    success: true,
    data: { id: '018f0000-0000-7000-8000-000000000001' },
  }),
  updateInquiryFormAction: vi.fn().mockResolvedValue({ success: true }),
  createNoticeVersionAction: vi.fn().mockResolvedValue({ success: true }),
  publishInquiryFormAction: vi.fn().mockResolvedValue({ success: true }),
  unpublishInquiryFormAction: vi.fn().mockResolvedValue({ success: true }),
  archiveInquiryFormAction: vi.fn().mockResolvedValue({ success: true }),
}));

import { InquiryFormsListView } from '@/components/settings/inquiry-forms-list-view';
import { NewInquiryFormView } from '@/components/settings/new-inquiry-form-view';
import { InquiryFormEditView } from '@/components/settings/inquiry-form-edit-view';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';
import { DEFAULT_FORM_FIELDS } from '@/server/inquiry-forms/schema';

describe('Inquiry Forms Component Views (AC-1 to AC-5, AC-10)', () => {
  const dummyForm: InquiryForm = {
    id: '018f0000-0000-7000-8000-000000000001',
    slug: 'abc123def4',
    name: 'Wedding Inquiries',
    status: 'draft',
    defaultLocale: 'en',
    fields: DEFAULT_FORM_FIELDS,
    eventTypes: [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
    ],
    autoReplyEnabled: true,
    acceptUnverified: false,
    currentNoticeVersionId: '018f0000-0000-7000-8000-000000000002',
    successRedirectUrl: null,
    createdAt: new Date('2026-10-12T10:00:00Z'),
    updatedAt: new Date('2026-10-12T10:00:00Z'),
  };

  const dummyNoticeVersion: InquiryFormNoticeVersion = {
    id: '018f0000-0000-7000-8000-000000000002',
    formId: dummyForm.id,
    version: 1,
    acknowledgementTextEn: 'I acknowledge the privacy notice.',
    acknowledgementTextDe: 'Ich nehme den Datenschutzhinweis zur Kenntnis.',
    privacyPolicyUrl: 'https://example.org/privacy',
    createdByActorId: '018f0000-0000-7000-8000-000000000000',
    createdAt: new Date('2026-10-12T10:00:00Z'),
  };

  describe('InquiryFormsListView', () => {
    it('renders empty state when forms array is empty', () => {
      const html = renderToStaticMarkup(<InquiryFormsListView forms={[]} locale="en" />);
      expect(html).toContain('data-testid="inquiry-forms-empty-state"');
      expect(html).toContain('data-testid="create-first-form-button"');
      expect(html).not.toContain('data-testid="inquiry-forms-table"');
    });

    it('renders table with status badges and edit links when forms are present', () => {
      const html = renderToStaticMarkup(<InquiryFormsListView forms={[dummyForm]} locale="en" />);
      expect(html).toContain('data-testid="inquiry-forms-table"');
      expect(html).toContain('data-testid="form-status-018f0000-0000-7000-8000-000000000001"');
      expect(html).toContain('Wedding Inquiries');
      expect(html).toContain('/settings/inquiry-forms/018f0000-0000-7000-8000-000000000001');
    });
  });

  describe('NewInquiryFormView', () => {
    it('AC-1: renders form with name input, default locale select, and submit button', () => {
      const html = renderToStaticMarkup(<NewInquiryFormView locale="en" />);
      expect(html).toContain('data-testid="new-form-name-input"');
      expect(html).toContain('data-testid="new-form-locale-select"');
      expect(html).toContain('data-testid="create-form-submit-button"');
    });
  });

  describe('InquiryFormEditView', () => {
    it('AC-2: given_name and email are locked (no enabled/required toggles)', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView form={dummyForm} noticeVersions={[dummyNoticeVersion]} locale="en" />,
      );

      // Locked badges for mandatory fields
      expect(html).toContain('data-testid="locked-badge-given_name"');
      expect(html).toContain('data-testid="locked-badge-email"');

      // Given name and email do NOT render checkboxes
      expect(html).not.toContain('data-testid="field-enabled-given_name"');
      expect(html).not.toContain('data-testid="field-required-given_name"');
      expect(html).not.toContain('data-testid="field-enabled-email"');
      expect(html).not.toContain('data-testid="field-required-email"');

      // Other fields have toggles
      expect(html).toContain('data-testid="field-enabled-phone"');
      expect(html).toContain('data-testid="field-required-phone"');
      expect(html).toContain('data-testid="field-enabled-message"');
    });

    it('AC-3 & AC-10: renders event types section with D7 sensitive information warning', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView form={dummyForm} noticeVersions={[dummyNoticeVersion]} locale="en" />,
      );

      // AC-10: sensitive event types warning notice
      expect(html).toContain('data-testid="sensitive-event-types-warning"');
      expect(html).toContain('eventTypes.sensitiveWarningTitle');

      // Event types table and rows
      expect(html).toContain('data-testid="event-types-table"');
      expect(html).toContain('data-testid="event-type-row-wedding"');
      expect(html).toContain('data-testid="event-type-row-portrait"');

      // Add event type form
      expect(html).toContain('data-testid="add-event-type-form"');
      expect(html).toContain('data-testid="new-event-type-key"');
      expect(html).toContain('data-testid="add-event-type-button"');
    });

    it('AC-4: renders privacy notice section with current version and version history', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView form={dummyForm} noticeVersions={[dummyNoticeVersion]} locale="en" />,
      );

      // Current notice box
      expect(html).toContain('data-testid="current-notice-version"');
      expect(html).toContain('data-testid="current-version-number"');
      expect(html).toContain('data-testid="current-policy-url"');
      expect(html).toContain('https://example.org/privacy');

      // Version history table
      expect(html).toContain('data-testid="notice-versions-history"');
      expect(html).toContain('data-testid="history-version-1"');

      // Save as new version button
      expect(html).toContain('data-testid="save-notice-version-button"');
    });

    it('AC-5: renders publish button for draft forms and status actions bar', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView form={dummyForm} noticeVersions={[dummyNoticeVersion]} locale="en" />,
      );

      expect(html).toContain('data-testid="status-actions-bar"');
      expect(html).toContain('data-testid="status-badge-draft"');
      expect(html).toContain('data-testid="publish-form-button"');
      expect(html).toContain('data-testid="archive-form-button"');
    });

    it('renders unpublish button for published forms', () => {
      const publishedForm = { ...dummyForm, status: 'published' as const };
      const html = renderToStaticMarkup(
        <InquiryFormEditView
          form={publishedForm}
          noticeVersions={[dummyNoticeVersion]}
          locale="en"
        />,
      );

      expect(html).toContain('data-testid="status-badge-published"');
      expect(html).toContain('data-testid="unpublish-form-button"');
      expect(html).not.toContain('data-testid="publish-form-button"');
    });
  });
});

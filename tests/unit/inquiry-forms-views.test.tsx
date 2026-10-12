import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => (key: string, values?: Record<string, unknown>) => {
    return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
  },
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();

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
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => '/settings/inquiry-forms',
}));

const mockCreateInquiryFormAction = vi.fn();
const mockUpdateInquiryFormAction = vi.fn();
const mockCreateNoticeVersionAction = vi.fn();
const mockPublishInquiryFormAction = vi.fn();
const mockUnpublishInquiryFormAction = vi.fn();
const mockArchiveInquiryFormAction = vi.fn();

vi.mock('@/server/inquiry-forms/actions', () => ({
  createInquiryFormAction: (...args: unknown[]): unknown =>
    mockCreateInquiryFormAction(...args) as unknown,
  updateInquiryFormAction: (...args: unknown[]): unknown =>
    mockUpdateInquiryFormAction(...args) as unknown,
  createNoticeVersionAction: (...args: unknown[]): unknown =>
    mockCreateNoticeVersionAction(...args) as unknown,
  publishInquiryFormAction: (...args: unknown[]): unknown =>
    mockPublishInquiryFormAction(...args) as unknown,
  unpublishInquiryFormAction: (...args: unknown[]): unknown =>
    mockUnpublishInquiryFormAction(...args) as unknown,
  archiveInquiryFormAction: (...args: unknown[]): unknown =>
    mockArchiveInquiryFormAction(...args) as unknown,
}));

import { InquiryFormsListView } from '@/components/settings/inquiry-forms-list-view';
import { NewInquiryFormView } from '@/components/settings/new-inquiry-form-view';
import { InquiryFormEditView, swapArrayItems } from '@/components/settings/inquiry-form-edit-view';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';
import { DEFAULT_FORM_FIELDS } from '@/server/inquiry-forms/schema';

function findNode(
  element: React.ReactElement | undefined,
  predicate: (node: React.ReactElement) => boolean,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (found || !node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (predicate(node)) {
        found = node;
        return;
      }
      if (node.props && (node.props as Record<string, unknown>).children) {
        traverse((node.props as Record<string, unknown>).children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

function findNodeByTestId(
  element: React.ReactElement | undefined,
  testId: string,
): React.ReactElement | undefined {
  return findNode(element, (node) => {
    const props = node.props as Record<string, unknown> | null | undefined;
    return props?.['data-testid'] === testId;
  });
}

async function triggerClick(element: React.ReactElement | undefined): Promise<void> {
  if (!element?.props) return;
  const props = element.props as Record<string, unknown>;
  if (typeof props.onClick === 'function') {
    await (props.onClick as () => Promise<void> | void)();
  }
}

function triggerChange(
  element: React.ReactElement | undefined,
  valueOrChecked: { value?: string; checked?: boolean },
): void {
  if (!element?.props) return;
  const props = element.props as Record<string, unknown>;
  if (typeof props.onChange === 'function') {
    (props.onChange as (e: { target: { value?: string; checked?: boolean } }) => void)({
      target: valueOrChecked,
    });
  }
}

async function triggerSubmit(element: React.ReactElement | undefined): Promise<void> {
  if (!element?.props) return;
  const props = element.props as Record<string, unknown>;
  if (typeof props.onSubmit === 'function') {
    await (props.onSubmit as (e: { preventDefault: () => void }) => Promise<void> | void)({
      preventDefault: vi.fn(),
    });
  }
}

describe('Inquiry Forms Component Views (AC-1 to AC-5, AC-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateInquiryFormAction.mockResolvedValue({
      success: true,
      data: { id: '018f0000-0000-7000-8000-000000000001' },
    });
    mockUpdateInquiryFormAction.mockResolvedValue({
      success: true,
      data: { ...dummyForm },
    });
    mockCreateNoticeVersionAction.mockResolvedValue({
      success: true,
      data: { ...dummyNoticeVersion, id: 'v-2', version: 2 },
    });
    mockPublishInquiryFormAction.mockResolvedValue({
      success: true,
      data: { ...dummyForm, status: 'published' },
    });
    mockUnpublishInquiryFormAction.mockResolvedValue({
      success: true,
      data: { ...dummyForm, status: 'draft' },
    });
    mockArchiveInquiryFormAction.mockResolvedValue({
      success: true,
      data: { ...dummyForm, status: 'archived' },
    });
  });

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

  describe('swapArrayItems pure function', () => {
    it('returns a shallow copy when indices are out of range or elements missing', () => {
      const items = ['one', 'two', 'three'];
      expect(swapArrayItems(items, -1, 1)).toEqual(['one', 'two', 'three']);
      expect(swapArrayItems(items, 0, -1)).toEqual(['one', 'two', 'three']);
      expect(swapArrayItems(items, 3, 1)).toEqual(['one', 'two', 'three']);
      expect(swapArrayItems(items, 0, 3)).toEqual(['one', 'two', 'three']);
      expect(swapArrayItems([undefined as unknown as string], 0, 0)).toEqual([undefined]);
    });

    it('swaps elements correctly when indices are valid', () => {
      const items = ['a', 'b', 'c'];
      expect(swapArrayItems(items, 0, 1)).toEqual(['b', 'a', 'c']);
      expect(swapArrayItems(items, 1, 2)).toEqual(['a', 'c', 'b']);
    });
  });

  describe('InquiryFormsListView', () => {
    it('renders empty state when forms array is empty', () => {
      const html = renderToStaticMarkup(<InquiryFormsListView forms={[]} locale="en" />);
      expect(html).toContain('data-testid="inquiry-forms-empty-state"');
      expect(html).toContain('data-testid="create-first-form-button"');
      expect(html).not.toContain('data-testid="inquiry-forms-table"');
    });

    it('renders table with status badges and edit links when forms are present', () => {
      const publishedForm = { ...dummyForm, id: 'f-pub', status: 'published' as const };
      const archivedForm = { ...dummyForm, id: 'f-arch', status: 'archived' as const };

      const html = renderToStaticMarkup(
        <InquiryFormsListView forms={[dummyForm, publishedForm, archivedForm]} locale="de" />,
      );
      expect(html).toContain('data-testid="inquiry-forms-table"');
      expect(html).toContain('data-testid="form-status-018f0000-0000-7000-8000-000000000001"');
      expect(html).toContain('data-testid="form-status-f-pub"');
      expect(html).toContain('data-testid="form-status-f-arch"');
      expect(html).toContain('Wedding Inquiries');
    });
  });

  describe('NewInquiryFormView', () => {
    it('AC-1: renders form with name input, default locale select, and submit button', () => {
      const html = renderToStaticMarkup(<NewInquiryFormView locale="en" />);
      expect(html).toContain('data-testid="new-form-name-input"');
      expect(html).toContain('data-testid="new-form-locale-select"');
      expect(html).toContain('data-testid="create-form-submit-button"');
    });

    it('handles input changes and submission branches', async () => {
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = NewInquiryFormView({ locale: 'de' });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const nameInput = findNodeByTestId(tree, 'new-form-name-input');
      triggerChange(nameInput, { value: 'New Test Form' });

      const localeSelect = findNodeByTestId(tree, 'new-form-locale-select');
      triggerChange(localeSelect, { value: 'en' });

      // Form submission validation error when empty
      const formEl = findNode(tree, (c) => c.type === 'form');
      await triggerSubmit(formEl);

      // Action returns error
      mockCreateInquiryFormAction.mockResolvedValueOnce({
        success: false,
        error: 'Validation failed',
      });
      await triggerSubmit(formEl);

      // Action throws error
      mockCreateInquiryFormAction.mockRejectedValueOnce(new Error('Network error'));
      await triggerSubmit(formEl);
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

    it('renders empty event types message when no event types are present', () => {
      const formNoEvents = { ...dummyForm, eventTypes: [] };
      const html = renderToStaticMarkup(
        <InquiryFormEditView
          form={formNoEvents}
          noticeVersions={[dummyNoticeVersion]}
          locale="en"
        />,
      );
      expect(html).toContain('data-testid="no-event-types-message"');
      expect(html).not.toContain('data-testid="event-types-table"');
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

    it('renders unpublish button for published forms and badge for archived forms', () => {
      const publishedForm = { ...dummyForm, status: 'published' as const };
      const htmlPub = renderToStaticMarkup(
        <InquiryFormEditView
          form={publishedForm}
          noticeVersions={[dummyNoticeVersion]}
          locale="en"
        />,
      );
      expect(htmlPub).toContain('data-testid="status-badge-published"');
      expect(htmlPub).toContain('data-testid="unpublish-form-button"');
      expect(htmlPub).not.toContain('data-testid="publish-form-button"');

      const archivedForm = { ...dummyForm, status: 'archived' as const };
      const htmlArch = renderToStaticMarkup(
        <InquiryFormEditView
          form={archivedForm}
          noticeVersions={[dummyNoticeVersion]}
          locale="en"
        />,
      );
      expect(htmlArch).toContain('data-testid="status-badge-archived"');
    });

    it('exercises all interactive buttons and change handlers', async () => {
      const formWithFallback = {
        ...dummyForm,
        fields: [
          ...dummyForm.fields,
          { key: 'unknown_custom_field', enabled: true, required: false, order: 9 },
        ],
      };

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = InquiryFormEditView({
          form: formWithFallback,
          noticeVersions: [dummyNoticeVersion],
          locale: 'en',
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // General inputs
      const nameInput = findNodeByTestId(tree, 'general-name-input');
      triggerChange(nameInput, { value: 'Updated Name' });

      const localeSelect = findNodeByTestId(tree, 'general-locale-select');
      triggerChange(localeSelect, { value: 'de' });

      const autoReplyToggle = findNodeByTestId(tree, 'general-auto-reply-toggle');
      triggerChange(autoReplyToggle, { checked: false });

      const unverifiedToggle = findNodeByTestId(tree, 'general-accept-unverified-toggle');
      triggerChange(unverifiedToggle, { checked: true });

      const redirectInput = findNodeByTestId(tree, 'general-redirect-url-input');
      triggerChange(redirectInput, {
        value: 'https://example.org/thanks',
      });

      // Save general settings
      const saveGeneralBtn = findNodeByTestId(tree, 'save-general-button');
      await triggerClick(saveGeneralBtn);

      // Field toggles
      const phoneEnabled = findNodeByTestId(tree, 'field-enabled-phone');
      triggerChange(phoneEnabled, { checked: false });

      const dateRequired = findNodeByTestId(tree, 'field-required-event_date');
      triggerChange(dateRequired, { checked: true });

      // Field moves
      const moveUpBtn = findNodeByTestId(tree, 'field-move-up-phone');
      await triggerClick(moveUpBtn);

      const moveDownBtn = findNodeByTestId(tree, 'field-move-down-phone');
      await triggerClick(moveDownBtn);

      // Save fields
      const saveFieldsBtn = findNodeByTestId(tree, 'save-fields-button');
      await triggerClick(saveFieldsBtn);

      // Event types inputs and add
      const etKey = findNodeByTestId(tree, 'new-event-type-key');
      triggerChange(etKey, { value: 'party' });

      const etEn = findNodeByTestId(tree, 'new-event-type-label-en');
      triggerChange(etEn, { value: 'Party' });

      const etDe = findNodeByTestId(tree, 'new-event-type-label-de');
      triggerChange(etDe, { value: 'Party' });

      const addEtForm = findNodeByTestId(tree, 'add-event-type-form');
      await triggerSubmit(addEtForm);

      // Event type moves & remove
      const moveUpEt = findNodeByTestId(tree, 'event-type-move-up-portrait');
      await triggerClick(moveUpEt);

      const moveDownEt = findNodeByTestId(tree, 'event-type-move-down-wedding');
      await triggerClick(moveDownEt);

      const removeEt = findNodeByTestId(tree, 'event-type-remove-wedding');
      await triggerClick(removeEt);

      // Save event types
      const saveEtBtn = findNodeByTestId(tree, 'save-event-types-button');
      await triggerClick(saveEtBtn);

      // Notice inputs & save
      const urlInput = findNodeByTestId(tree, 'notice-policy-url-input');
      triggerChange(urlInput, {
        value: 'https://example.org/privacy',
      });

      const ackEnInput = findNodeByTestId(tree, 'notice-ack-en-input');
      triggerChange(ackEnInput, { value: 'Ack EN' });

      const ackDeInput = findNodeByTestId(tree, 'notice-ack-de-input');
      triggerChange(ackDeInput, { value: 'Ack DE' });

      const saveNoticeBtn = findNodeByTestId(tree, 'save-notice-version-button');
      await triggerClick(saveNoticeBtn);

      // Status actions
      const publishBtn = findNodeByTestId(tree, 'publish-form-button');
      await triggerClick(publishBtn);

      const archiveBtn = findNodeByTestId(tree, 'archive-form-button');
      await triggerClick(archiveBtn);

      const confirmArchiveBtn = findNodeByTestId(tree, 'confirm-archive-button');
      await triggerClick(confirmArchiveBtn);

      const cancelArchiveBtn = findNodeByTestId(tree, 'cancel-archive-button');
      await triggerClick(cancelArchiveBtn);
    });

    it('covers error handling paths when actions fail or throw', async () => {
      mockUpdateInquiryFormAction.mockResolvedValueOnce({ success: false, error: 'Save failed' });
      mockCreateNoticeVersionAction.mockResolvedValueOnce({
        success: false,
        error: 'Notice failed',
      });
      mockPublishInquiryFormAction.mockResolvedValueOnce({
        success: false,
        code: 'PUBLISH_PRECONDITION_FAILED',
      });

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = InquiryFormEditView({
          form: dummyForm,
          noticeVersions: [dummyNoticeVersion],
          locale: 'en',
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const saveGeneralBtn = findNodeByTestId(tree, 'save-general-button');
      await triggerClick(saveGeneralBtn);

      const saveFieldsBtn = findNodeByTestId(tree, 'save-fields-button');
      await triggerClick(saveFieldsBtn);

      const saveNoticeBtn = findNodeByTestId(tree, 'save-notice-version-button');
      await triggerClick(saveNoticeBtn);

      const publishBtn = findNodeByTestId(tree, 'publish-form-button');
      await triggerClick(publishBtn);

      // Throw branches
      mockUpdateInquiryFormAction.mockRejectedValueOnce(new Error('Network error'));
      await triggerClick(saveGeneralBtn);

      mockPublishInquiryFormAction.mockRejectedValueOnce(new Error('Network error'));
      await triggerClick(publishBtn);

      // Unpublish button on published form
      let publishedTree: React.ReactElement | undefined;
      function PublishedWrapper() {
        const rendered = InquiryFormEditView({
          form: { ...dummyForm, status: 'published' },
          noticeVersions: [dummyNoticeVersion],
          locale: 'en',
        });
        publishedTree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<PublishedWrapper />);
      const unpubBtn = findNodeByTestId(publishedTree, 'unpublish-form-button');
      await triggerClick(unpubBtn);

      mockUnpublishInquiryFormAction.mockResolvedValueOnce({ success: false });
      await triggerClick(unpubBtn);

      mockUnpublishInquiryFormAction.mockRejectedValueOnce(new Error('err'));
      await triggerClick(unpubBtn);
    });

    it('exercises all validation and error branches across general, fields, event types, and notice forms', async () => {
      // 1. General settings validation errors: empty name and name > 100
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = InquiryFormEditView({
          form: dummyForm,
          noticeVersions: [dummyNoticeVersion],
          locale: 'en',
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const nameInput = findNodeByTestId(tree, 'general-name-input');
      const generalForm = findNodeByTestId(tree, 'general-form');

      // Empty name validation
      triggerChange(nameInput, { value: '   ' });
      await triggerSubmit(generalForm);

      // Name > 100 validation
      triggerChange(nameInput, { value: 'a'.repeat(101) });
      await triggerSubmit(generalForm);

      // 2. Event Types validation in handleAddEventType
      const etKey = findNodeByTestId(tree, 'new-event-type-key');
      const etEn = findNodeByTestId(tree, 'new-event-type-label-en');
      const etDe = findNodeByTestId(tree, 'new-event-type-label-de');
      const addEtForm = findNodeByTestId(tree, 'add-event-type-form');

      // Invalid key (regex mismatch)
      triggerChange(etKey, { value: 'INVALID_KEY!' });
      await triggerSubmit(addEtForm);

      // Valid key, but empty English label
      triggerChange(etKey, { value: 'party' });
      triggerChange(etEn, { value: '' });
      await triggerSubmit(addEtForm);

      // English label > 60
      triggerChange(etEn, { value: 'a'.repeat(61) });
      await triggerSubmit(addEtForm);

      // Valid English label, but empty German label
      triggerChange(etEn, { value: 'Party' });
      triggerChange(etDe, { value: '' });
      await triggerSubmit(addEtForm);

      // German label > 60
      triggerChange(etDe, { value: 'a'.repeat(61) });
      await triggerSubmit(addEtForm);

      // Duplicate key ('wedding' is already in dummyForm.eventTypes)
      triggerChange(etDe, { value: 'Party DE' });
      triggerChange(etKey, { value: 'wedding' });
      await triggerSubmit(addEtForm);

      // 3. Save Event Types: error and throw branches
      const saveEtBtn = findNodeByTestId(tree, 'save-event-types-button');
      mockUpdateInquiryFormAction.mockResolvedValueOnce({ success: false, error: 'DB error' });
      await triggerClick(saveEtBtn);

      mockUpdateInquiryFormAction.mockRejectedValueOnce(new Error('fail'));
      await triggerClick(saveEtBtn);

      // 4. Privacy Notice version validation branches
      const noticeForm = findNodeByTestId(tree, 'notice-version-form');
      const urlInput = findNodeByTestId(tree, 'notice-policy-url-input');
      const ackEnInput = findNodeByTestId(tree, 'notice-ack-en-input');
      const ackDeInput = findNodeByTestId(tree, 'notice-ack-de-input');

      // Non-https URL
      triggerChange(urlInput, { value: 'http://insecure.example.com' });
      await triggerSubmit(noticeForm);

      // Missing / invalid English text
      triggerChange(urlInput, { value: 'https://secure.example.com' });
      triggerChange(ackEnInput, { value: '' });
      await triggerSubmit(noticeForm);

      // HTML in English text
      triggerChange(ackEnInput, { value: 'Contains <script> alert(1)' });
      await triggerSubmit(noticeForm);

      // English text > 500 chars
      triggerChange(ackEnInput, { value: 'a'.repeat(501) });
      await triggerSubmit(noticeForm);

      // Missing / invalid German text
      triggerChange(ackEnInput, { value: 'Valid acknowledgement text' });
      triggerChange(ackDeInput, { value: '' });
      await triggerSubmit(noticeForm);

      // HTML in German text
      triggerChange(ackDeInput, { value: 'Text mit > Zeichen' });
      await triggerSubmit(noticeForm);

      // German text > 500 chars
      triggerChange(ackDeInput, { value: 'a'.repeat(501) });
      await triggerSubmit(noticeForm);

      // Save Notice Version error and throw branches
      triggerChange(ackDeInput, { value: 'Gültiger Text' });
      mockCreateNoticeVersionAction.mockResolvedValueOnce({ success: false, error: 'Save failed' });
      await triggerSubmit(noticeForm);

      mockCreateNoticeVersionAction.mockRejectedValueOnce(new Error('Network crash'));
      await triggerSubmit(noticeForm);

      // 5. Archive dialog: confirm archive success, failure, and throw branches
      const archiveBtn = findNodeByTestId(tree, 'archive-form-button');
      await triggerClick(archiveBtn);

      const confirmArchiveBtn = findNodeByTestId(tree, 'confirm-archive-button');

      // Archive success
      mockArchiveInquiryFormAction.mockResolvedValueOnce({
        success: true,
        data: { ...dummyForm, status: 'archived' },
      });
      await triggerClick(confirmArchiveBtn);

      // Archive failure
      mockArchiveInquiryFormAction.mockResolvedValueOnce({
        success: false,
        error: 'Cannot archive',
      });
      await triggerClick(confirmArchiveBtn);

      // Archive throw
      mockArchiveInquiryFormAction.mockRejectedValueOnce(new Error('Server down'));
      await triggerClick(confirmArchiveBtn);

      // 6. Form with empty eventTypes but event_type field enabled (missingEventTypes branch)
      const formWithoutEventTypes: InquiryForm = {
        ...dummyForm,
        eventTypes: [],
        fields: dummyForm.fields.map((f) => (f.key === 'event_type' ? { ...f, enabled: true } : f)),
      };
      let noEtTree: React.ReactElement | undefined;
      function NoEtWrapper() {
        const rendered = InquiryFormEditView({
          form: formWithoutEventTypes,
          noticeVersions: [dummyNoticeVersion],
          locale: 'en',
        });
        noEtTree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<NoEtWrapper />);

      const saveFieldsNoEt = findNodeByTestId(noEtTree, 'save-fields-button');
      await triggerClick(saveFieldsNoEt);

      const saveEtNoEt = findNodeByTestId(noEtTree, 'save-event-types-button');
      await triggerClick(saveEtNoEt);

      // 7. Status actions: publish generic failure and unpublish success
      const publishNoEt = findNodeByTestId(noEtTree, 'publish-form-button');
      mockPublishInquiryFormAction.mockResolvedValueOnce({
        success: false,
        error: 'Generic publish failure',
      });
      await triggerClick(publishNoEt);

      mockPublishInquiryFormAction.mockResolvedValueOnce({
        success: true,
        data: { ...formWithoutEventTypes, status: 'published' },
      });
      await triggerClick(publishNoEt);
    });
  });
});

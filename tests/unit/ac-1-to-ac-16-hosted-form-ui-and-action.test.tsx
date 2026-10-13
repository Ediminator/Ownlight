import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
vi.mock('@/server/db/client', () => ({ db: {} }));

const mockRedirect = vi.fn();
const mockNotFound = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    mockNotFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));

let mockHeadersThrow = false;
vi.mock('next/headers', () => ({
  headers: () => {
    if (mockHeadersThrow) {
      return Promise.reject(new Error('Headers unavailable'));
    }
    return Promise.resolve(new Headers({ 'x-forwarded-for': '198.51.100.1' }));
  },
}));

const mockTranslations: Record<string, string> = {
  'inquiry.public.studioProcessesData': 'Studio processes data',
  'inquiry.public.privacyPolicyLink': 'privacy policy',
  'inquiry.public.sensitiveDataHint': 'Please do not include sensitive data',
  'inquiry.public.submit': 'Send inquiry',
  'inquiry.public.submitting': 'Sending...',
  'inquiry.public.errors.summaryTitle': 'Please correct the following errors',
  'inquiry.public.errors.fieldRequired': 'This field is required',
  'inquiry.public.errors.invalidEmail': 'Please enter a valid email address',
  'inquiry.public.errors.emailNoCrlf': 'Email address cannot contain line breaks',
  'inquiry.public.errors.invalidPhone': 'Please enter a valid phone number',
  'inquiry.public.errors.invalidEventType': 'Please select a valid event type',
  'inquiry.public.errors.invalidEventDate': 'Invalid event date',
  'inquiry.public.errors.invalidLocation': 'Invalid location',
  'inquiry.public.errors.messageTooLong': 'Message too long',
  'inquiry.public.errors.acknowledgementRequired': 'Acknowledgement required',
  'inquiry.public.errors.rateLimited': 'Too many attempts',
  'inquiry.public.errors.unavailable': 'Service unavailable',
  'inquiry.public.errors.unverifiedRejected': 'Unverified rejected',
  'inquiry.public.fields.given_name': 'First name',
  'inquiry.public.fields.given_namePlaceholder': 'Jane',
  'inquiry.public.fields.family_name': 'Last name',
  'inquiry.public.fields.family_namePlaceholder': 'Doe',
  'inquiry.public.fields.email': 'Email',
  'inquiry.public.fields.emailPlaceholder': 'jane@example.com',
  'inquiry.public.fields.phone': 'Phone',
  'inquiry.public.fields.phonePlaceholder': '+49...',
  'inquiry.public.fields.event_type': 'Event type',
  'inquiry.public.fields.event_typeSelect': 'Select...',
  'inquiry.public.fields.event_date': 'Event date',
  'inquiry.public.fields.event_location': 'Location',
  'inquiry.public.fields.event_locationPlaceholder': 'City',
  'inquiry.public.fields.message': 'Message',
  'inquiry.public.fields.messagePlaceholder': 'Your inquiry...',
  'inquiry.public.fields.website': 'Website',
  'inquiry.public.fields.notice_acknowledged': 'I acknowledge the privacy policy',
  'inquiry.public.thanks.title': 'Thank you for your inquiry',
  'inquiry.public.thanks.description': 'We will get back to you shortly',
  'inquiry.public.thanks.backHome': 'Back to Home',
};

vi.mock('next-intl', () => ({
  useTranslations: (prefix?: string) => (key: string) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return mockTranslations[fullKey] ?? key;
  },
}));

const mockFormAction = vi.fn();
let mockActionState: [unknown, (payload: FormData) => void, boolean] = [
  null,
  mockFormAction,
  false,
];
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: vi.fn<() => [unknown, (payload: FormData) => void, boolean]>(
      () => mockActionState,
    ),
  };
});

const mockSubmitInquiry = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@/server/inquiry-forms/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/inquiry-forms/submit')>();
  return {
    ...actual,
    submitInquiry: (...args: unknown[]) => mockSubmitInquiry(...args),
  };
});

const mockGetPublishedFormBySlug = vi.fn<(slug: string) => Promise<InquiryForm | null>>();
const mockGetNoticeVersionById = vi.fn<(id: string) => Promise<InquiryFormNoticeVersion | null>>();
const mockGetStudioSettings = vi.fn<() => Promise<{ studio_name: string; timezone: string }>>();

vi.mock('@/server/inquiry-forms/service', () => ({
  getPublishedFormBySlug: (slug: string) => mockGetPublishedFormBySlug(slug),
}));

vi.mock('@/server/inquiry-forms/repo', () => ({
  getNoticeVersionById: (id: string) => mockGetNoticeVersionById(id),
}));

vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: () => mockGetStudioSettings(),
}));

import { submitInquiryAction } from '@/server/inquiry-forms/public-actions';
import { HostedInquiryForm } from '@/app/[locale]/f/[slug]/_components/hosted-inquiry-form';
import HostedFormPage from '@/app/[locale]/f/[slug]/page';
import InquiryThanksPage from '@/app/[locale]/f/[slug]/thanks/page';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';

describe('TASK-0027: Hosted Form UI, Actions, and Pages Unit Tests', () => {
  const mockForm: InquiryForm = {
    id: '01912345-6789-7abc-8def-012345678001',
    name: 'Wedding Inquiries',
    slug: 'wedding-2027',
    status: 'published',
    defaultLocale: 'en',
    acceptUnverified: true,
    autoReplyEnabled: true,
    successRedirectUrl: null,
    currentNoticeVersionId: '01912345-6789-7abc-8def-012345678002',
    createdAt: new Date(),
    updatedAt: new Date(),
    fields: [
      { key: 'given_name', enabled: true, required: true, order: 0 },
      { key: 'family_name', enabled: true, required: true, order: 1 },
      { key: 'email', enabled: true, required: true, order: 2 },
      { key: 'phone', enabled: true, required: true, order: 3 },
      { key: 'event_type', enabled: true, required: true, order: 4 },
      { key: 'event_date', enabled: true, required: true, order: 5 },
      { key: 'event_location', enabled: true, required: true, order: 6 },
      { key: 'message', enabled: true, required: true, order: 7 },
    ],
    eventTypes: [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
    ],
  };

  const mockNoticeVersion: InquiryFormNoticeVersion = {
    id: '01912345-6789-7abc-8def-012345678002',
    formId: mockForm.id,
    version: 1,
    privacyPolicyUrl: 'https://example.com/privacy',
    acknowledgementTextEn: 'I acknowledge the privacy notice EN',
    acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis DE',
    createdByActorId: 'owner',
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadersThrow = false;
    mockActionState = [null, mockFormAction, false];
  });

  describe('submitInquiryAction', () => {
    it('redirects on successful submission with default thanks URL', async () => {
      mockSubmitInquiry.mockResolvedValueOnce({
        success: true,
        outcome: 'success',
        leadId: 'lead-123',
      });

      const formData = new FormData();
      formData.set('slug', 'wedding-2027');
      formData.set('locale', 'en');
      formData.set('given_name', 'Alice');
      formData.set('email', 'alice@example.com');
      formData.set('notice_acknowledged', 'on');
      formData.set('$ACTION_ID_test', 'internal');
      formData.set('_$hidden', 'internal');

      await expect(submitInquiryAction(null, formData)).rejects.toThrow(
        'REDIRECT:/en/f/wedding-2027/thanks',
      );
      expect(mockRedirect).toHaveBeenCalledWith('/en/f/wedding-2027/thanks');
    });

    it('redirects with custom redirectUrl when provided by submitInquiry', async () => {
      mockSubmitInquiry.mockResolvedValueOnce({
        success: true,
        outcome: 'accepted_silently',
        redirectUrl: '/de/f/wedding-2027/thanks',
      });

      const formData = new FormData();
      formData.set('slug', 'wedding-2027');
      formData.set('locale', 'de');
      formData.set('website', 'honeypot');

      await expect(submitInquiryAction(null, formData)).rejects.toThrow(
        'REDIRECT:/de/f/wedding-2027/thanks',
      );
      expect(mockRedirect).toHaveBeenCalledWith('/de/f/wedding-2027/thanks');
    });

    it('returns validation errors and retained values on failure', async () => {
      mockSubmitInquiry.mockResolvedValueOnce({
        success: false,
        outcome: 'validation_failed',
        error: 'Validation failed',
        fieldErrors: {
          given_name: 'This field is required',
          email: 'Please enter a valid email address',
        },
      });

      const formData = new FormData();
      formData.set('slug', 'wedding-2027');
      formData.set('locale', 'en');
      formData.set('given_name', '');
      formData.set('email', 'invalid');

      const result = await submitInquiryAction(null, formData);
      expect(result.success).toBe(false);
      expect(result.outcome).toBe('validation_failed');
      expect(result.error).toBe('Validation failed');
      expect(result.fieldErrors?.given_name).toBe('This field is required');
      expect(result.values?.email).toBe('invalid');
    });

    it('handles headers exception gracefully and passes clientIp null', async () => {
      mockHeadersThrow = true;
      mockSubmitInquiry.mockResolvedValueOnce({
        success: false,
        outcome: 'rate_limited',
        error: 'Too many attempts',
      });

      const formData = new FormData();
      formData.set('slug', 'wedding-2027');
      formData.set('notice_acknowledged', 'true');

      const result = await submitInquiryAction(null, formData);
      expect(result.success).toBe(false);
      expect(mockSubmitInquiry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clientIp: null }),
        expect.anything(),
      );
    });

    it('handles checkbox notice_acknowledged = 1 as true', async () => {
      mockSubmitInquiry.mockResolvedValueOnce({
        success: false,
        outcome: 'validation_failed',
      });

      const formData = new FormData();
      formData.set('slug', 'wedding-2027');
      formData.set('notice_acknowledged', '1');

      await submitInquiryAction(null, formData);
      expect(mockSubmitInquiry).toHaveBeenCalledWith(
        expect.objectContaining({ notice_acknowledged: true }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('HostedInquiryForm Component', () => {
    it('renders all form elements with labels, placeholders, and hint', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="en"
          studioName="Alice Photography"
          timezone="Europe/Berlin"
          acknowledgementText="I acknowledge the privacy notice EN"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('Alice Photography');
      expect(html).toContain('Wedding Inquiries');
      expect(html).toContain('field-given_name');
      expect(html).toContain('field-family_name');
      expect(html).toContain('field-email');
      expect(html).toContain('field-phone');
      expect(html).toContain('field-event_type');
      expect(html).toContain('field-event_date');
      expect(html).toContain('field-event_location');
      expect(html).toContain('field-message');
      expect(html).toContain('field-notice_acknowledged');
      expect(html).toContain('field-website');
      expect(html).toContain('Send inquiry');
    });

    it('renders German event type options when locale is de', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="de"
          studioName="Alice Photography"
          timezone="Europe/Berlin"
          acknowledgementText="Ich nehme die Datenschutzerklärung zur Kenntnis DE"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('Hochzeit');
      expect(html).toContain('Porträt');
    });

    it('renders button with submitting text when isPending is true', () => {
      mockActionState = [null, vi.fn(), true];

      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="en"
          studioName="Alice Photography"
          timezone="Europe/Berlin"
          acknowledgementText="I acknowledge the privacy notice EN"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('Sending...');
    });

    it('renders #error-summary and inline errors when action state has validation failures', () => {
      mockActionState = [
        {
          success: false,
          outcome: 'validation_failed',
          fieldErrors: {
            given_name: 'fieldRequired',
            email: 'invalidEmail',
            phone: 'invalidPhone',
            event_type: 'invalidEventType',
            event_date: 'invalidEventDate',
            event_location: 'invalidLocation',
            message: 'messageTooLong',
            notice_acknowledged: 'acknowledgementRequired',
          },
          values: {
            email: 'bad-email',
          },
        },
        vi.fn(),
        false,
      ];

      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="en"
          studioName="Alice Photography"
          timezone="Europe/Berlin"
          acknowledgementText="I acknowledge the privacy notice EN"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('id="error-summary"');
      expect(html).toContain('Please correct the following errors');
      expect(html).toContain('id="error-given_name"');
      expect(html).toContain('id="error-email"');
      expect(html).toContain('id="error-phone"');
      expect(html).toContain('id="error-event_type"');
      expect(html).toContain('id="error-event_date"');
      expect(html).toContain('id="error-event_location"');
      expect(html).toContain('id="error-message"');
      expect(html).toContain('id="error-notice_acknowledged"');
      expect(html).toContain('value="bad-email"');
    });

    it('renders form-level error when fieldErrors is absent', () => {
      mockActionState = [
        {
          success: false,
          outcome: 'rate_limited',
          error: 'Too many attempts',
        },
        vi.fn(),
        false,
      ];

      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="en"
          studioName="Alice Photography"
          timezone="Europe/Berlin"
          acknowledgementText="I acknowledge the privacy notice EN"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('id="error-summary"');
      expect(html).toContain('Too many attempts');
    });

    it('falls back gracefully when timezone format is invalid', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          locale="en"
          studioName="Alice Photography"
          timezone="INVALID/TIMEZONE/ZONE"
          acknowledgementText="I acknowledge the privacy notice EN"
          privacyPolicyUrl="https://example.com/privacy"
        />,
      );

      expect(html).toContain('Alice Photography');
    });
  });

  describe('HostedFormPage Server Page', () => {
    it('calls notFound when locale is unsupported', async () => {
      await expect(
        HostedFormPage({
          params: Promise.resolve({ locale: 'fr', slug: 'wedding-2027' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('calls notFound when form is not found or has no currentNoticeVersionId', async () => {
      mockGetPublishedFormBySlug.mockResolvedValueOnce(null);

      await expect(
        HostedFormPage({
          params: Promise.resolve({ locale: 'en', slug: 'unknown-form' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('calls notFound when notice version is not found', async () => {
      mockGetPublishedFormBySlug.mockResolvedValueOnce(mockForm);
      mockGetNoticeVersionById.mockResolvedValueOnce(null);

      await expect(
        HostedFormPage({
          params: Promise.resolve({ locale: 'en', slug: 'wedding-2027' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('renders form successfully when valid form and notice version exist', async () => {
      mockGetPublishedFormBySlug.mockResolvedValueOnce(mockForm);
      mockGetNoticeVersionById.mockResolvedValueOnce(mockNoticeVersion);
      mockGetStudioSettings.mockResolvedValueOnce({
        studio_name: 'Studio Test',
        timezone: 'Europe/Berlin',
      });

      const pageElement = await HostedFormPage({
        params: Promise.resolve({ locale: 'en', slug: 'wedding-2027' }),
      });

      const html = renderToStaticMarkup(pageElement);
      expect(html).toContain('Studio Test');
    });

    it('handles studio settings error by falling back to default values', async () => {
      mockGetPublishedFormBySlug.mockResolvedValueOnce(mockForm);
      mockGetNoticeVersionById.mockResolvedValueOnce(mockNoticeVersion);
      mockGetStudioSettings.mockRejectedValueOnce(new Error('DB connection error'));

      const pageElement = await HostedFormPage({
        params: Promise.resolve({ locale: 'de', slug: 'wedding-2027' }),
      });

      const html = renderToStaticMarkup(pageElement);
      expect(html).toContain('Studio');
      expect(html).toContain('Ich nehme die Datenschutzerklärung zur Kenntnis DE');
    });
  });

  describe('InquiryThanksPage', () => {
    it('renders thank you confirmation page without any personal data', () => {
      const html = renderToStaticMarkup(<InquiryThanksPage />);
      expect(html).toContain('Thank you for your inquiry');
      expect(html).toContain('We will get back to you shortly');
      expect(html).toContain('Back to Home');
    });
  });
});

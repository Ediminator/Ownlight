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
  usePathname: () => '/settings/inquiry-forms/test-id',
}));

vi.mock('@/server/inquiry-forms/actions', () => ({
  updateInquiryFormAction: vi.fn(),
  createNoticeVersionAction: vi.fn(),
  publishInquiryFormAction: vi.fn(),
  unpublishInquiryFormAction: vi.fn(),
  archiveInquiryFormAction: vi.fn(),
}));

import {
  InquiryFormEditView,
  generateScriptFreeFormHtml,
} from '@/components/settings/inquiry-form-edit-view';
import { HostedInquiryForm } from '@/app/[locale]/f/[slug]/_components/hosted-inquiry-form';
import EmbedThanksPage from '@/app/[locale]/f/[slug]/embed/thanks/page';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';

describe('AC-10 to AC-13: Embed UI and Share & Embed Settings Panel', () => {
  const mockNotice: InquiryFormNoticeVersion = {
    id: '018f0000-0000-7000-8000-000000000011',
    formId: '018f0000-0000-7000-8000-000000000010',
    version: 1,
    acknowledgementTextEn: 'I acknowledge the privacy notice.',
    acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
    privacyPolicyUrl: 'https://photographer.example/privacy',
    createdByActorId: 'owner-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockForm: InquiryForm = {
    id: '018f0000-0000-7000-8000-000000000010',
    slug: 'inq-embed01',
    name: 'Wedding Inquiries',
    status: 'published',
    defaultLocale: 'en',
    fields: [
      { key: 'given_name', enabled: true, required: true, order: 0 },
      { key: 'family_name', enabled: true, required: false, order: 1 },
      { key: 'email', enabled: true, required: true, order: 2 },
      { key: 'phone', enabled: true, required: false, order: 3 },
      { key: 'message', enabled: true, required: false, order: 4 },
    ],
    eventTypes: [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
    ],
    currentNoticeVersionId: mockNotice.id,
    autoReplyEnabled: true,
    acceptUnverified: true,
    successRedirectUrl: 'https://photographer.example/thank-you',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  describe('AC-10 (R-A): Share & embed settings panel', () => {
    it('AC-10: renders hosted page link, iframe snippet, and script-free form snippet', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView
          form={mockForm}
          noticeVersions={[mockNotice]}
          locale="en"
          baseUrl="https://studio.example"
          allowedEmbedOrigins={['https://photographer.example']}
        />,
      );

      // Section 5 exists
      expect(html).toContain('settings.inquiryForms.shareEmbed.title');

      // Hosted link
      expect(html).toContain('https://studio.example/en/f/inq-embed01');

      // Iframe snippet
      expect(html).toContain(
        '&lt;iframe src=&quot;https://studio.example/en/f/inq-embed01/embed&quot;',
      );
      expect(html).toContain('width=&quot;100%&quot;');
      expect(html).toContain('height=&quot;700&quot;');

      // Script-free form snippet
      expect(html).toContain(
        'action=&quot;https://studio.example/api/public/forms/inq-embed01/submissions&quot;',
      );
      expect(html).toContain('method=&quot;POST&quot;');

      // Copy buttons with accessible aria-live status and testids
      expect(html).toContain('data-testid="copy-hosted-link-button"');
      expect(html).toContain('data-testid="copy-iframe-snippet-button"');
      expect(html).toContain('data-testid="copy-html-snippet-button"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('settings.inquiryForms.shareEmbed.copy');
    });

    it('AC-10: renders empty origins warning banner when allowedEmbedOrigins is empty', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView
          form={mockForm}
          noticeVersions={[mockNotice]}
          locale="en"
          baseUrl="https://studio.example"
          allowedEmbedOrigins={[]}
        />,
      );

      expect(html).toContain('settings.inquiryForms.shareEmbed.warningNoOriginsTitle');
      expect(html).toContain('settings.inquiryForms.shareEmbed.warningNoOrigins');
    });

    it('AC-10: does not render warning banner when allowedEmbedOrigins contains origins', () => {
      const html = renderToStaticMarkup(
        <InquiryFormEditView
          form={mockForm}
          noticeVersions={[mockNotice]}
          locale="en"
          baseUrl="https://studio.example"
          allowedEmbedOrigins={['https://photographer.example']}
        />,
      );

      expect(html).not.toContain('settings.inquiryForms.shareEmbed.warningNoOriginsTitle');
    });

    it('AC-10: generates clean script-free HTML form with all enabled fields, honeypot, and notice', () => {
      const formHtml = generateScriptFreeFormHtml({
        form: mockForm,
        locale: 'en',
        baseUrl: 'https://studio.example',
        acknowledgementText: mockNotice.acknowledgementTextEn,
        privacyPolicyUrl: mockNotice.privacyPolicyUrl,
      });

      // Form tag and action
      expect(formHtml).toContain(
        '<form method="POST" action="https://studio.example/api/public/forms/inq-embed01/submissions"',
      );

      // Honeypot field
      expect(formHtml).toContain('name="website"');
      expect(formHtml).toContain('tabindex="-1"');
      expect(formHtml).toContain('autocomplete="off"');

      // Required and optional fields
      expect(formHtml).toContain('name="given_name" maxlength="100" required');
      expect(formHtml).toContain('name="family_name" maxlength="100"');
      expect(formHtml).toContain('name="email" maxlength="254" required');
      expect(formHtml).toContain('name="phone" maxlength="32"');
      expect(formHtml).toContain(
        '<textarea id="field-message" name="message" rows="4" maxlength="2000"',
      );

      // Privacy notice acknowledgement
      expect(formHtml).toContain('name="notice_acknowledged" required');
      expect(formHtml).toContain('I acknowledge the privacy notice.');

      // Submit button
      expect(formHtml).toContain('<button type="submit"');
    });

    it('AC-10: generates German script-free HTML form when locale is de', () => {
      const formHtml = generateScriptFreeFormHtml({
        form: mockForm,
        locale: 'de',
        baseUrl: 'https://studio.example',
        acknowledgementText: mockNotice.acknowledgementTextDe,
        privacyPolicyUrl: mockNotice.privacyPolicyUrl,
      });

      expect(formHtml).toContain('Ich nehme die Datenschutzerklärung zur Kenntnis.');
      expect(formHtml).toContain('name="locale" value="de"');
    });
  });

  describe('AC-11: Embed page rendering and delivery_mode', () => {
    it('AC-11: HostedInquiryForm with deliveryMode="embed" hides header chrome and renders delivery_mode hidden input', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          acknowledgementText={mockNotice.acknowledgementTextEn}
          privacyPolicyUrl={mockNotice.privacyPolicyUrl}
          studioName="Studio Lumière"
          locale="en"
          timezone="Europe/Berlin"
          deliveryMode="embed"
        />,
      );

      // Studio header chrome is NOT rendered
      expect(html).not.toContain('<header');
      expect(html).not.toContain('Studio Lumière');

      // delivery_mode hidden input is present
      expect(html).toContain('name="delivery_mode"');
      expect(html).toContain('value="embed"');
    });

    it('AC-11: HostedInquiryForm with deliveryMode="hosted" renders studio header chrome', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          acknowledgementText={mockNotice.acknowledgementTextEn}
          privacyPolicyUrl={mockNotice.privacyPolicyUrl}
          studioName="Studio Lumière"
          locale="en"
          timezone="Europe/Berlin"
          deliveryMode="hosted"
        />,
      );

      // Studio header chrome IS rendered
      expect(html).toContain('Studio Lumière');
      expect(html).toContain('value="hosted"');
    });

    it('AC-11: embed thanks page renders chromeless confirmation without back link', () => {
      const html = renderToStaticMarkup(<EmbedThanksPage />);

      expect(html).toContain('inquiry.public.thanks.title');
      expect(html).toContain('inquiry.public.thanks.description');
      // No navigation or back-to-home link
      expect(html).not.toContain('href="/"');
      expect(html).not.toContain('href="/en"');
    });
  });

  describe('AC-13: German embed locale', () => {
    it('AC-13: HostedInquiryForm in German renders German labels and notice text', () => {
      const html = renderToStaticMarkup(
        <HostedInquiryForm
          form={mockForm}
          acknowledgementText={mockNotice.acknowledgementTextDe}
          privacyPolicyUrl={mockNotice.privacyPolicyUrl}
          studioName="Studio Lumière"
          locale="de"
          timezone="Europe/Berlin"
          deliveryMode="embed"
        />,
      );

      // Verify fields
      expect(html).toContain('inquiry.public.fields.given_name');
      expect(html).toContain('inquiry.public.fields.family_name');
      expect(html).toContain('inquiry.public.fields.email');
      expect(html).toContain('inquiry.public.fields.phone');
      expect(html).toContain('inquiry.public.fields.message');

      // German notice text
      expect(html).toContain('Ich nehme die Datenschutzerklärung zur Kenntnis.');
      expect(html).toContain('inquiry.public.submit');
    });

    it('AC-13: embed thanks page in German renders German confirmation', () => {
      const html = renderToStaticMarkup(<EmbedThanksPage />);

      expect(html).toContain('inquiry.public.thanks.title');
      expect(html).toContain('inquiry.public.thanks.description');
    });
  });
});

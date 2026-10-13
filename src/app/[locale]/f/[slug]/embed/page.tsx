import { notFound } from 'next/navigation';
import { getPublishedFormBySlug } from '@/server/inquiry-forms/service';
import { getNoticeVersionById } from '@/server/inquiry-forms/repo';
import { getStudioSettings } from '@/server/settings/repo';
import { HostedInquiryForm } from '../_components/hosted-inquiry-form';
import { routing } from '@/i18n/routing';
import { getEmbedOrigins } from '@/env';

export const dynamic = 'force-dynamic';

interface EmbedFormPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Public iframe embed inquiry form page (AC-1, AC-2, AC-11, AC-12, AC-13).
 * Clean, chrome-less variant without application shell or studio header chrome.
 * Never reads owner session or cookies.
 * 404 parity for unknown, draft, and archived forms, or when embed origins are not configured.
 */
export default async function EmbedFormPage({ params }: EmbedFormPageProps) {
  const { locale, slug } = await params;
  if (!routing.locales.includes(locale as 'en' | 'de')) {
    notFound();
  }

  // Private by default: if no embed origins configured, return 404 (AC-2)
  const allowedOrigins = getEmbedOrigins();
  if (allowedOrigins.length === 0) {
    notFound();
  }

  const form = await getPublishedFormBySlug(slug);
  if (!form?.currentNoticeVersionId) {
    notFound();
  }

  const noticeVersion = await getNoticeVersionById(form.currentNoticeVersionId);
  if (!noticeVersion) {
    notFound();
  }

  let studioName = 'Studio';
  let timezone = 'UTC';
  try {
    const settings = await getStudioSettings();
    studioName = settings.studio_name;
    timezone = settings.timezone;
  } catch {
    studioName = 'Studio';
    timezone = 'UTC';
  }

  const acknowledgementText =
    locale === 'de' ? noticeVersion.acknowledgementTextDe : noticeVersion.acknowledgementTextEn;

  return (
    <div className="w-full max-w-2xl mx-auto px-2 py-4 sm:px-4">
      <HostedInquiryForm
        form={form}
        locale={locale as 'en' | 'de'}
        studioName={studioName}
        timezone={timezone}
        acknowledgementText={acknowledgementText}
        privacyPolicyUrl={noticeVersion.privacyPolicyUrl}
        deliveryMode="embed"
      />
    </div>
  );
}

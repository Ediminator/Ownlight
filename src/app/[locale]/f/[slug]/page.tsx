import { notFound } from 'next/navigation';
import { getPublishedFormBySlug } from '@/server/inquiry-forms/service';
import { getNoticeVersionById } from '@/server/inquiry-forms/repo';
import { getStudioSettings } from '@/server/settings/repo';
import { HostedInquiryForm } from './_components/hosted-inquiry-form';
import { routing } from '@/i18n/routing';

export const dynamic = 'force-dynamic';

interface HostedFormPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Public hosted inquiry form page (AC-1, AC-8, AC-10, AC-11, AC-12, AC-13).
 * Never reads owner session or cookies.
 * 404 parity for unknown, draft, and archived forms.
 */
export default async function HostedFormPage({ params }: HostedFormPageProps) {
  const { locale, slug } = await params;
  if (!routing.locales.includes(locale as 'en' | 'de')) {
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
    <div className="w-full max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <HostedInquiryForm
        form={form}
        locale={locale as 'en' | 'de'}
        studioName={studioName}
        timezone={timezone}
        acknowledgementText={acknowledgementText}
        privacyPolicyUrl={noticeVersion.privacyPolicyUrl}
      />
    </div>
  );
}

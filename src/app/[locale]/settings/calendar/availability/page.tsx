import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import {
  getAvailabilitySchedules,
  getAllAvailabilityOverrides,
  getBookingTypes,
} from '@/server/calendar/service';
import { AvailabilitySettingsView } from '@/components/calendar/settings/availability-settings-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AvailabilitySettingsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'settings.availability' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title =
      locale === 'de'
        ? 'Verfügbarkeit & Buchungsarten · Ownlight'
        : 'Availability & Booking Types · Ownlight';
    return { title };
  }
}

export default async function AvailabilitySettingsPage({
  params,
  searchParams,
}: AvailabilitySettingsPageProps) {
  const { locale } = await params;

  // Enforce studio owner authentication (AC-8)
  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/calendar/availability`);
  }

  const query = await searchParams;
  const defaultTab =
    query.tab === 'overrides' || query.tab === 'booking-types' ? query.tab : 'schedules';

  // Fetch initial data in parallel
  const [schedules, overrides, bookingTypesList] = await Promise.all([
    getAvailabilitySchedules(),
    getAllAvailabilityOverrides(),
    getBookingTypes(true), // include inactive
  ]);

  return (
    <div className="container mx-auto px-4 py-6" data-testid="availability-settings-page">
      <AvailabilitySettingsView
        initialSchedules={schedules}
        initialOverrides={overrides}
        initialBookingTypes={bookingTypesList}
        locale={locale}
        defaultTab={defaultTab}
      />
    </div>
  );
}

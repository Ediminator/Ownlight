import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { findBookingTypeBySlug } from '@/server/calendar/repo';
import { getStudioSettings } from '@/server/settings/repo';
import { PublicBookingScheduler } from '@/components/calendar/public/public-booking-scheduler';
import { BookingClosedView } from '@/components/calendar/public/booking-closed-view';

export const dynamic = 'force-dynamic';

interface BookingPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: BookingPageProps): Promise<Metadata> {
  const { slug } = await params;
  const bookingType = await findBookingTypeBySlug(slug);

  let studioName = 'Ownlight Studio';
  try {
    const settings = await getStudioSettings();
    if (settings.studio_name) {
      studioName = settings.studio_name;
    }
  } catch {
    studioName = 'Ownlight Studio';
  }

  if (!bookingType?.isActive) {
    return {
      title: `Bookings Closed | ${studioName}`,
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${bookingType.title} | ${studioName}`,
    description:
      bookingType.description ?? `Book an appointment for ${bookingType.title} with ${studioName}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Public Booking Scheduler page at /book/[slug] (AC-1, AC-9).
 * Unauthenticated, no owner session or cookies read, 404/closed-notice parity.
 */
export default async function BookingPage({ params }: BookingPageProps) {
  const { locale, slug } = await params;

  if (!routing.locales.includes(locale as 'en' | 'de')) {
    notFound();
  }

  const bookingType = await findBookingTypeBySlug(slug);

  let studioName = 'Ownlight Studio';
  let studioTimezone = 'Europe/Berlin';
  try {
    const settings = await getStudioSettings();
    if (settings.studio_name) {
      studioName = settings.studio_name;
    }
    if (settings.timezone) {
      studioTimezone = settings.timezone;
    }
  } catch {
    studioName = 'Ownlight Studio';
    studioTimezone = 'Europe/Berlin';
  }

  // If booking type does not exist or is inactive, render closed notice (AC-9)
  if (!bookingType?.isActive) {
    return <BookingClosedView studioName={studioName} bookingTypeTitle={bookingType?.title} />;
  }

  return (
    <PublicBookingScheduler
      bookingType={{
        id: bookingType.id,
        slug: bookingType.slug,
        title: bookingType.title,
        description: bookingType.description,
        durationMinutes: bookingType.durationMinutes,
        locationType: bookingType.locationType,
        locationDetails: bookingType.locationDetails,
      }}
      studioName={studioName}
      studioTimezone={studioTimezone}
      locale={locale as 'en' | 'de'}
    />
  );
}

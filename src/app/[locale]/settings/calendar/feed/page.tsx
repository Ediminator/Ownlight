import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { getOrCreateActiveFeed } from '@/server/calendar/service';
import { CalendarFeedView } from '@/components/calendar/settings/calendar-feed-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface CalendarFeedPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'settings.calendarFeed' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title =
      locale === 'de'
        ? 'Kalender-Feed-Abonnement · Ownlight'
        : 'Calendar Feed Subscription · Ownlight';
    return { title };
  }
}

export default async function CalendarFeedPage({ params }: CalendarFeedPageProps) {
  const { locale } = await params;

  let authContext;
  try {
    authContext = await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/calendar/feed`);
  }

  const { feed, token } = await getOrCreateActiveFeed(authContext.user.id);

  return (
    <div className="container mx-auto px-4 py-6">
      <CalendarFeedView initialFeed={feed} initialToken={token} locale={locale} />
    </div>
  );
}

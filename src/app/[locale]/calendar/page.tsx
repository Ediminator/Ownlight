import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { CalendarView } from '@/components/calendar/calendar-view';
import { getUnifiedCalendarEvents } from '@/server/calendar/service';
import { getMonthBoundaries, parseIsoDate } from '@/client/calendar/grid-math';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface CalendarPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; date?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'calendar' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Studiokalender · Ownlight' : 'Studio Calendar · Ownlight';
    return { title };
  }
}

export default async function CalendarPage({ params, searchParams }: CalendarPageProps) {
  const { locale } = await params;

  // Enforce studio owner authentication (AC-9, ADR-0017)
  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/calendar`);
    return null;
  }

  const query = await searchParams;
  const initialView =
    query.view === 'week' || query.view === 'day' || query.view === 'month' ? query.view : 'month';

  const initialDateStr = query.date;
  const baseDate = initialDateStr ? parseIsoDate(initialDateStr) : new Date();

  // Fetch initial events for current visible month window
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = locale === 'de' ? 1 : 0;
  const bounds = getMonthBoundaries(year, month, firstDay);

  const initialEvents = await getUnifiedCalendarEvents({
    startDate: bounds.gridStart,
    endDate: bounds.gridEnd,
  });

  const t = await getTranslations({ locale, namespace: 'pages.calendar' });

  return (
    <div
      className="container mx-auto px-4 py-6 max-w-7xl space-y-6"
      data-testid="calendar-container"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <CalendarView
        initialEvents={initialEvents}
        locale={locale}
        initialDate={initialDateStr}
        initialView={initialView}
      />
    </div>
  );
}

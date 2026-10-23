import { redirect } from 'next/navigation';

export default async function CalendarSettingsRootPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const query = searchParams ? await searchParams : {};
  if (query.tab === 'availability' || query.tab === 'schedules' || query.tab === 'overrides') {
    redirect(`/${locale}/settings/calendar/availability`);
  }
  redirect(`/${locale}/settings/calendar/feed`);
}

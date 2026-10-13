import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { getLeadCounts, listLeads } from '@/server/leads/service';
import { LEAD_STATUSES, type LeadStatus } from '@/server/db/schema/leads';
import { LeadInbox } from '@/components/leads/lead-inbox';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LeadsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'leads' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Anfragen · Ownlight' : 'Leads · Ownlight';
    return { title };
  }
}

export default async function LeadsPage({ params, searchParams }: LeadsPageProps) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/leads`);
    return null;
  }

  const query = await searchParams;
  const rawStatus = query.status;
  const status: LeadStatus | undefined =
    rawStatus && LEAD_STATUSES.includes(rawStatus as LeadStatus)
      ? (rawStatus as LeadStatus)
      : undefined;

  const emailQuery = query.q && query.q.trim().length > 0 ? query.q.trim() : undefined;
  const rawPage = parseInt(query.page ?? '1', 10);
  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const [counts, leadsResult] = await Promise.all([
    getLeadCounts(),
    listLeads({
      status,
      emailQuery,
      page,
      limit: 25,
    }),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <LeadInbox
        initialLeads={leadsResult.leads}
        initialCounts={counts}
        locale={locale}
        initialStatus={status ?? 'all'}
        initialEmailQuery={emailQuery ?? ''}
        initialPage={page}
        hasMore={leadsResult.hasMore}
      />
    </div>
  );
}

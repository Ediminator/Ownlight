import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { getLeadWithDetails } from '@/server/leads/service';
import { LeadDetailView } from '@/components/leads/lead-detail-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LeadDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'leads' });
    const leadWithDetails = await getLeadWithDetails(id);
    const name = leadWithDetails
      ? [leadWithDetails.lead.givenName, leadWithDetails.lead.familyName]
          .filter(Boolean)
          .join(' ') || id
      : id;
    return {
      title: `${name} · ${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Anfrage · Ownlight' : 'Lead · Ownlight';
    return { title };
  }
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { locale, id } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/leads/${id}`);
    return null;
  }

  // Validate UUID syntax
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
  if (!isUuid) {
    notFound();
  }

  const leadWithDetails = await getLeadWithDetails(id);
  if (!leadWithDetails) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <LeadDetailView leadWithDetails={leadWithDetails} locale={locale} />
    </div>
  );
}

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireOwner } from '@/server/auth/guards';
import { getClient } from '@/server/clients/service';
import { listTimeline } from '@/server/timeline/service';
import { listConsentsForClient } from '@/server/consents/repo';
import { getStudioSettings } from '@/server/settings/repo';
import { getLegalHold } from '@/server/clients/legal-hold-repo';
import { getClientRetentionMonths } from '@/server/retention/policy';
import { getProjectsForClient } from '@/server/projects/service';
import { ClientProfile } from '@/components/clients/client-profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ClientProfilePageProps {
  params: Promise<{ locale: string; clientId: string }>;
}

const uuidSchema = z.string().uuid();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; clientId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'clients.profile' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Kundenprofil · Ownlight' : 'Client profile · Ownlight';
    return { title };
  }
}

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { locale, clientId } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/clients/${clientId}`);
    return null;
  }

  // AC-6: Random UUID or non-UUID value renders localized not-found page (HTTP 404)
  const uuidParsed = uuidSchema.safeParse(clientId);
  if (!uuidParsed.success) {
    notFound();
    return null;
  }

  const [clientRes, timelineRes, consentsData, settings, legalHold, projectsData] =
    await Promise.all([
      getClient(clientId),
      listTimeline(clientId).catch(() => null),
      listConsentsForClient(clientId).catch(() => null),
      getStudioSettings().catch(() => null),
      getLegalHold(clientId).catch(() => null),
      getProjectsForClient(clientId).catch(() => []),
    ]);

  if (!clientRes.success) {
    notFound();
    return null;
  }

  const studioTimezone = settings?.timezone ?? 'UTC';

  return (
    <div className="container mx-auto px-4 py-6">
      <ClientProfile
        clientData={clientRes.data}
        locale={locale}
        studioTimezone={studioTimezone}
        initialTimeline={timelineRes?.success ? timelineRes.data : undefined}
        initialConsents={consentsData ?? undefined}
        initialLegalHold={legalHold}
        retentionMonths={getClientRetentionMonths()}
        initialProjects={projectsData}
      />
    </div>
  );
}

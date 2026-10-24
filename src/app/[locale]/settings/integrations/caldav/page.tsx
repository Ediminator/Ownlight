import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { getCaldavAccountStatus } from '@/server/integrations/caldav/repo';
import { CaldavIntegrationView } from '@/components/settings/caldav-integration-view';

export default async function CaldavIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/integrations/caldav`);
  }

  const status = await getCaldavAccountStatus();

  return (
    <div className="container mx-auto px-4 py-6">
      <CaldavIntegrationView initialStatus={status} locale={locale} />
    </div>
  );
}

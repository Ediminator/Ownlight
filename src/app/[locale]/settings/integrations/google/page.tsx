import { redirect } from 'next/navigation';
import { env } from '@/env';
import { requireOwner } from '@/server/auth/guards';
import { getGoogleIntegrationStatus } from '@/server/integrations/google/service';
import { GoogleIntegrationView } from '@/components/settings/google-integration-view';

export default async function GoogleIntegrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ success?: string; error?: string }>;
}) {
  const { locale } = await params;
  const query = searchParams ? await searchParams : {};

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/integrations/google`);
  }

  const status = await getGoogleIntegrationStatus();
  let baseUrl = process.env.AUTH_URL;
  if (!baseUrl) {
    try {
      baseUrl = env.AUTH_URL;
    } catch {
      baseUrl = 'http://localhost:3000';
    }
  }
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/integrations/google/callback`;

  let initialNotification: { type: 'success' | 'error'; code: string } | null = null;
  if (query.success) {
    initialNotification = { type: 'success', code: query.success };
  } else if (query.error) {
    initialNotification = { type: 'error', code: query.error };
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <GoogleIntegrationView
        initialStatus={status}
        locale={locale}
        redirectUri={redirectUri}
        initialNotification={initialNotification}
      />
    </div>
  );
}

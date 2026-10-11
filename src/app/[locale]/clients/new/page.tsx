import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { getStudioSettings } from '@/server/settings/repo';
import { ClientCreateForm } from '@/components/clients/client-create-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ClientCreatePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'clients.form' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Neuer Kunde · Ownlight' : 'New client · Ownlight';
    return { title };
  }
}

export default async function ClientCreatePage({ params }: ClientCreatePageProps) {
  const { locale } = await params;

  // AC-14: Redirect unauthenticated requests to sign-in
  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/clients/new`);
    return null;
  }

  const settings = await getStudioSettings().catch(() => null);
  const defaultLocale = settings?.default_locale === 'de' ? 'de' : 'en';

  return (
    <div className="container mx-auto px-4 py-8">
      <ClientCreateForm locale={locale} defaultLocale={defaultLocale} />
    </div>
  );
}

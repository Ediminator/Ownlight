import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ClientEditPageProps {
  params: Promise<{ locale: string; clientId: string }>;
}

export default async function ClientEditPage({ params }: ClientEditPageProps) {
  const { locale, clientId } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/clients/${clientId}/edit`);
    return null;
  }

  redirect(`/${locale}/clients/${clientId}?edit=true`);
}

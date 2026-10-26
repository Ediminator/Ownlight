import { notFound } from 'next/navigation';
import { isSetupAvailable, isSetupTokenRequired } from '@/server/auth/setup';
import { SetupForm } from '@/components/auth/setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const available = await isSetupAvailable();

  // If owner already exists, permanently disable setup with 404
  if (!available) {
    notFound();
  }

  const requireToken = isSetupTokenRequired();

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <SetupForm locale={locale} requireToken={requireToken} />
    </div>
  );
}

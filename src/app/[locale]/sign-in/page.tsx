import { isSetupAvailable } from '@/server/auth/setup';
import { SignInForm } from '@/components/auth/sign-in-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const setupAvailable = await isSetupAvailable();

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <SignInForm locale={locale} setupAvailable={setupAvailable} />
    </div>
  );
}

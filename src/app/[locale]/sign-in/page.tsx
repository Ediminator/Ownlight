import { SignInForm } from '@/components/auth/sign-in-form';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <SignInForm locale={locale} />
    </div>
  );
}

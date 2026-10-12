import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { NewInquiryFormView } from '@/components/settings/new-inquiry-form-view';

export default async function NewInquiryFormPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/inquiry-forms/new`);
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <NewInquiryFormView locale={locale} />
    </div>
  );
}

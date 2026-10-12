import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { listForms } from '@/server/inquiry-forms/service';
import { InquiryFormsListView } from '@/components/settings/inquiry-forms-list-view';

export default async function InquiryFormsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/inquiry-forms`);
  }

  const forms = await listForms();

  return (
    <div className="container mx-auto px-4 py-6">
      <InquiryFormsListView forms={forms} locale={locale} />
    </div>
  );
}

import { redirect, notFound } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { getForm, getNoticeVersions } from '@/server/inquiry-forms/service';
import { InquiryFormEditView } from '@/components/settings/inquiry-form-edit-view';

export default async function EditInquiryFormPage({
  params,
}: {
  params: Promise<{ locale: string; id?: string; formId?: string }>;
}) {
  const { locale, id: rawId, formId: rawFormId } = await params;
  const id = rawId ?? rawFormId;

  if (!id) {
    notFound();
  }

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/inquiry-forms/${id}`);
  }

  const [form, noticeVersions] = await Promise.all([getForm(id), getNoticeVersions(id)]);

  if (!form) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <InquiryFormEditView form={form} noticeVersions={noticeVersions} locale={locale} />
    </div>
  );
}

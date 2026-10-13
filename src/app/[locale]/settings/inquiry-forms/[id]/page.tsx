import { redirect, notFound } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { getForm, getNoticeVersions } from '@/server/inquiry-forms/service';
import { InquiryFormEditView } from '@/components/settings/inquiry-form-edit-view';
import { getEmbedOrigins, clientEnv } from '@/env';

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

  const allowedEmbedOrigins = getEmbedOrigins();
  const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return (
    <div className="container mx-auto px-4 py-6">
      <InquiryFormEditView
        form={form}
        noticeVersions={noticeVersions}
        locale={locale}
        baseUrl={baseUrl}
        allowedEmbedOrigins={allowedEmbedOrigins}
      />
    </div>
  );
}

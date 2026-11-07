import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { listContractTemplates } from '@/server/contracts/template-repo';
import { getStudioSigningProfile } from '@/server/studio/signing-settings';
import { SettingsNav } from '@/components/settings/settings-nav';
import { ContractsSettingsView } from '@/components/settings/contracts-settings-view';

export default async function ContractsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/contracts`);
  }

  const [templates, signingProfile] = await Promise.all([
    listContractTemplates(),
    getStudioSigningProfile(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6">
      <SettingsNav />
      <ContractsSettingsView initialTemplates={templates} initialSigningSettings={signingProfile} />
    </div>
  );
}

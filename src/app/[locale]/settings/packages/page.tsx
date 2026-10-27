import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import { listPackages } from '@/server/packages/repo';
import { listCatalogueItems } from '@/server/catalogue/repo';
import { getStudioTaxSettings } from '@/server/studio/tax-settings';
import { PackagesView } from '@/components/settings/packages/packages-view';

export default async function PackagesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/packages`);
  }

  const [packages, catalogueItems, taxSettings] = await Promise.all([
    listPackages(),
    listCatalogueItems(),
    getStudioTaxSettings(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6">
      <PackagesView
        initialPackages={packages}
        initialCatalogueItems={catalogueItems}
        initialTaxSettings={taxSettings}
        locale={locale}
      />
    </div>
  );
}

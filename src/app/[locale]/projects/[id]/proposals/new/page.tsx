import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireOwner } from '@/server/auth/guards';
import { getProjectDetail } from '@/server/projects/service';
import { listPackages } from '@/server/packages/repo';
import { listCatalogueItems } from '@/server/catalogue/repo';
import { getStudioTaxSettings } from '@/server/studio/tax-settings';
import { ProposalBuilderView } from '@/components/proposals/proposal-builder-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ProposalNewPageProps {
  params: Promise<{ locale: string; id: string }>;
}

const uuidSchema = z.string().uuid();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const uuidParsed = uuidSchema.safeParse(id);
  if (!uuidParsed.success) {
    return { title: 'New Proposal · Ownlight' };
  }

  try {
    const detail = await getProjectDetail(id);
    if (!detail) {
      return { title: 'Project Not Found · Ownlight' };
    }
    return {
      title: `New Proposal · ${detail.project.title} · Ownlight`,
    };
  } catch {
    return { title: 'New Proposal · Ownlight' };
  }
}

export default async function ProposalNewPage({ params }: ProposalNewPageProps) {
  const { locale, id } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/projects/${id}/proposals/new`);
    return null;
  }

  const uuidParsed = uuidSchema.safeParse(id);
  if (!uuidParsed.success) {
    notFound();
    return null;
  }

  const [projectDetail, packages, catalogueItems, studioSettings] = await Promise.all([
    getProjectDetail(id),
    listPackages({ isActive: true }),
    listCatalogueItems({ isActive: true }),
    getStudioTaxSettings(),
  ]);

  if (!projectDetail) {
    notFound();
    return null;
  }

  return (
    <ProposalBuilderView
      project={projectDetail.project}
      client={projectDetail.client}
      packages={packages}
      catalogueItems={catalogueItems}
      studioSettings={studioSettings}
      proposal={null}
      locale={locale}
    />
  );
}

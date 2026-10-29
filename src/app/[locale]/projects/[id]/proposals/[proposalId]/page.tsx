import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireOwner } from '@/server/auth/guards';
import { getProjectDetail } from '@/server/projects/service';
import { getProposalById } from '@/server/proposals/repo';
import { listPackages } from '@/server/packages/repo';
import { listCatalogueItems } from '@/server/catalogue/repo';
import { getStudioTaxSettings } from '@/server/studio/tax-settings';
import { ProposalBuilderView } from '@/components/proposals/proposal-builder-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ProposalEditPageProps {
  params: Promise<{ locale: string; id: string; proposalId: string }>;
}

const uuidSchema = z.string().uuid();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string; proposalId: string }>;
}): Promise<Metadata> {
  const { proposalId } = await params;
  const uuidParsed = uuidSchema.safeParse(proposalId);
  if (!uuidParsed.success) {
    return { title: 'Proposal · Ownlight' };
  }

  try {
    const proposal = await getProposalById(proposalId);
    if (!proposal) {
      return { title: 'Proposal Not Found · Ownlight' };
    }
    return {
      title: `${proposal.title} · Ownlight`,
    };
  } catch {
    return { title: 'Proposal · Ownlight' };
  }
}

export default async function ProposalEditPage({ params }: ProposalEditPageProps) {
  const { locale, id, proposalId } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/projects/${id}/proposals/${proposalId}`);
    return null;
  }

  const idParsed = uuidSchema.safeParse(id);
  const proposalIdParsed = uuidSchema.safeParse(proposalId);
  if (!idParsed.success || !proposalIdParsed.success) {
    notFound();
    return null;
  }

  const [projectDetail, proposal, packages, catalogueItems, studioSettings] = await Promise.all([
    getProjectDetail(id),
    getProposalById(proposalId),
    listPackages({ isActive: true }),
    listCatalogueItems({ isActive: true }),
    getStudioTaxSettings(),
  ]);

  if (!projectDetail || !proposal) {
    notFound();
    return null;
  }

  // Ensure proposal belongs to this project
  if (proposal.projectId !== id) {
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
      proposal={proposal}
      locale={locale}
    />
  );
}

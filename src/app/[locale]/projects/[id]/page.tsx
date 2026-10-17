import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireOwner } from '@/server/auth/guards';
import { getProjectDetail } from '@/server/projects/service';
import { ProjectDetailView } from '@/components/projects/project-detail-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ProjectDetailPageProps {
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
    return { title: 'Project · Ownlight' };
  }

  try {
    const detail = await getProjectDetail(id);
    if (!detail) {
      return { title: 'Project Not Found · Ownlight' };
    }
    return {
      title: `${detail.project.title} · Ownlight`,
    };
  } catch {
    return { title: 'Project · Ownlight' };
  }
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { locale, id } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/projects/${id}`);
    return null;
  }

  const uuidParsed = uuidSchema.safeParse(id);
  if (!uuidParsed.success) {
    notFound();
    return null;
  }

  const projectDetail = await getProjectDetail(id);
  if (!projectDetail) {
    notFound();
    return null;
  }

  return <ProjectDetailView initialData={projectDetail} locale={locale} />;
}

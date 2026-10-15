import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LayoutGrid, List } from 'lucide-react';
import { requireOwner } from '@/server/auth/guards';
import { getKanbanBoardData } from '@/server/projects/service';
import { getClientList } from '@/server/clients/service';
import { KanbanBoard } from '@/components/projects/kanban-board';
import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ProjectsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'projects' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title =
      locale === 'de' ? 'Projekte & Pipeline · Ownlight' : 'Projects & Pipeline · Ownlight';
    return { title };
  }
}

export default async function ProjectsPage({ params, searchParams }: ProjectsPageProps) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/projects`);
    return null;
  }

  const query = await searchParams;
  const isListView = query.view === 'list';

  let t = (key: string) => key;
  try {
    t = await getTranslations({ locale, namespace: 'projects' });
  } catch {
    const isDe = locale === 'de';
    const map = new Map<string, string>([
      ['title', isDe ? 'Projekte & Pipeline' : 'Projects & Pipeline'],
      [
        'description',
        isDe
          ? 'Verwalten Sie Fotoprojekte und Workflows.'
          : 'Manage photography commissions and workflows across pipeline stages.',
      ],
      ['viewToggle.board', 'Board'],
      ['viewToggle.list', isDe ? 'Liste' : 'List'],
      ['viewToggle.boardAria', 'Switch to Kanban board view'],
      ['viewToggle.listAria', 'Switch to list view'],
      ['list.placeholderTitle', 'Project Directory & List View'],
      [
        'list.placeholderDesc',
        'The tabular list view with search and advanced filters will be available in the next release (TASK-0037).',
      ],
      ['list.backToBoard', 'Back to Kanban Board'],
    ]);
    t = (key: string) => map.get(key) ?? key;
  }

  const [kanbanData, clientsRes] = await Promise.all([getKanbanBoardData(), getClientList(1, 100)]);

  const clients = clientsRes.success
    ? clientsRes.data.items.map((c) => ({ id: c.id, displayName: c.displayName }))
    : [];

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      {/* Top Action Bar */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <h1
            data-testid="projects-page-heading"
            className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Switcher Toggle (Board vs List) */}
          <div
            role="group"
            aria-label={t('title')}
            className="inline-flex rounded-lg border border-border bg-muted/50 p-1 text-muted-foreground shadow-2xs"
          >
            <Link
              href={`/${locale}/projects?view=board`}
              data-testid="view-toggle-board"
              aria-label={t('viewToggle.boardAria')}
              aria-current={!isListView ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[32px]',
                !isListView
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'hover:text-foreground hover:bg-background/50',
              )}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              <span>{t('viewToggle.board')}</span>
            </Link>

            <Link
              href={`/${locale}/projects?view=list`}
              data-testid="view-toggle-list"
              aria-label={t('viewToggle.listAria')}
              aria-current={isListView ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[32px]',
                isListView
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'hover:text-foreground hover:bg-background/50',
              )}
            >
              <List className="h-4 w-4" aria-hidden="true" />
              <span>{t('viewToggle.list')}</span>
            </Link>
          </div>

          {/* New Project Action Button & Dialog */}
          <NewProjectDialog clients={clients} />
        </div>
      </header>

      {/* Main Content Area: Board or List View */}
      {isListView ? (
        <div
          data-testid="projects-list-view"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-card-foreground shadow-2xs space-y-4"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <List className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-semibold text-foreground">{t('list.placeholderTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('list.placeholderDesc')}</p>
          </div>
          <Link
            href={`/${locale}/projects?view=board`}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground min-h-[44px] sm:min-h-[36px]"
          >
            {t('list.backToBoard')}
          </Link>
        </div>
      ) : (
        <KanbanBoard
          initialStages={kanbanData.stages}
          initialProjects={kanbanData.projects}
          locale={locale}
        />
      )}
    </div>
  );
}

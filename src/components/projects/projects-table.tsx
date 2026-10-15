'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Search,
  X,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreVertical,
  ExternalLink,
  Trash2,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { getStageCategoryBadgeClasses } from './kanban-column';
import { CreateProjectDialog } from './create-project-dialog';
import { deleteProjectAction, transitionProjectStageAction } from '@/server/projects/actions';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

export type SortColumn = 'title' | 'client' | 'date' | 'value' | 'lastActivity';
export type SortDirection = 'asc' | 'desc';

export interface ProjectsTableProps {
  projects: KanbanProject[];
  stages: PipelineStage[];
  locale?: string;
  clients: { id: string; displayName: string }[];
  searchParams?: {
    stage?: string;
    type?: string;
    date?: string;
    view?: string;
  };
}

export function ProjectsTable({
  projects: initialProjects,
  stages,
  locale = 'en',
  clients,
  searchParams,
}: ProjectsTableProps) {
  const t = useTranslations('projects');
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();

  // 1. In-memory search state (ADR-0010 compliance: NEVER in URL, NEVER logged)
  const [searchQuery, setSearchQuery] = React.useState('');

  // 2. Filter states synchronized with URL search params (derived directly to avoid cascading effect renders)
  const stageFilter = searchParams?.stage ?? currentSearchParams.get('stage') ?? 'all';
  const typeFilter = searchParams?.type ?? currentSearchParams.get('type') ?? 'all';
  const dateFilter = searchParams?.date ?? currentSearchParams.get('date') ?? 'all';

  // Update URL search parameters when filters change (keeping search query strictly out of URL/logs!)
  const updateUrlFilters = React.useCallback(
    (newStage: string, newType: string, newDate: string) => {
      const params = new URLSearchParams();
      params.set('view', 'list');

      if (newStage && newStage !== 'all') {
        params.set('stage', newStage);
      }
      if (newType && newType !== 'all') {
        params.set('type', newType);
      }
      if (newDate && newDate !== 'all') {
        params.set('date', newDate);
      }

      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router],
  );

  const handleStageChange = (val: string) => {
    updateUrlFilters(val, typeFilter, dateFilter);
  };

  const handleTypeChange = (val: string) => {
    updateUrlFilters(stageFilter, val, dateFilter);
  };

  const handleDateChange = (val: string) => {
    updateUrlFilters(stageFilter, typeFilter, val);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    updateUrlFilters('all', 'all', 'all');
  };

  // 3. Sorting state
  const [sortColumn, setSortColumn] = React.useState<SortColumn>('title');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('asc');

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      // For date/value, default to descending; for text, ascending
      setSortDirection(
        col === 'date' || col === 'value' || col === 'lastActivity' ? 'desc' : 'asc',
      );
    }
  };

  // 4. Localized helpers
  const stageMap = React.useMemo(() => {
    return new Map<string, PipelineStage>(stages.map((s) => [s.id, s]));
  }, [stages]);

  const getStageName = React.useCallback(
    (stageKey: string, fallbackName?: string): string => {
      try {
        const val = t(`stages.${stageKey}`);
        if (val && !val.includes(`stages.${stageKey}`)) return val;
      } catch {
        // fallback
      }
      return fallbackName ?? stageKey;
    },
    [t],
  );

  const getTypeLabel = React.useCallback(
    (key: string): string => {
      const lower = key.toLowerCase();
      try {
        const val = t(`types.${lower}`);
        if (val && !val.includes(`types.${lower}`)) return val;
      } catch {
        // fallback
      }
      return key.charAt(0).toUpperCase() + key.slice(1);
    },
    [t],
  );

  // 5. In-Memory Filter & Search Evaluation
  const filteredAndSortedProjects = React.useMemo(() => {
    const now = new Date();
    const query = searchQuery.trim().toLowerCase();

    return initialProjects
      .filter((project) => {
        // Stage filter
        if (stageFilter !== 'all') {
          if (project.stageKey !== stageFilter && project.stageId !== stageFilter) {
            return false;
          }
        }

        // Type filter
        if (typeFilter !== 'all') {
          if (project.projectTypeKey.toLowerCase() !== typeFilter.toLowerCase()) {
            return false;
          }
        }

        // Date filter
        if (dateFilter !== 'all') {
          if (dateFilter === 'unscheduled') {
            if (project.primaryShootStartsAt !== null) return false;
          } else if (dateFilter === 'upcoming') {
            if (!project.primaryShootStartsAt) return false;
            if (new Date(project.primaryShootStartsAt) < now) return false;
          } else if (dateFilter === 'past') {
            if (!project.primaryShootStartsAt) return false;
            if (new Date(project.primaryShootStartsAt) >= now) return false;
          }
        }

        // In-memory substring search (matching title, client display name, or shoot location)
        if (query) {
          const matchTitle = project.title.toLowerCase().includes(query);
          const matchClient = project.clientDisplayName.toLowerCase().includes(query);
          const matchLocation = Boolean(
            project.primaryShootLocationName?.toLowerCase().includes(query),
          );
          if (!matchTitle && !matchClient && !matchLocation) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        switch (sortColumn) {
          case 'title':
            cmp = a.title.localeCompare(b.title, locale);
            break;
          case 'client':
            cmp = a.clientDisplayName.localeCompare(b.clientDisplayName, locale);
            break;
          case 'date': {
            const timeA = a.primaryShootStartsAt ? new Date(a.primaryShootStartsAt).getTime() : 0;
            const timeB = b.primaryShootStartsAt ? new Date(b.primaryShootStartsAt).getTime() : 0;
            cmp = timeA - timeB;
            break;
          }
          case 'value': {
            const valA = a.priceMinor ?? -1;
            const valB = b.priceMinor ?? -1;
            cmp = valA - valB;
            break;
          }
          case 'lastActivity': {
            const timeA = new Date(a.lastActivityAt).getTime();
            const timeB = new Date(b.lastActivityAt).getTime();
            cmp = timeA - timeB;
            break;
          }
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
  }, [
    initialProjects,
    searchQuery,
    stageFilter,
    typeFilter,
    dateFilter,
    sortColumn,
    sortDirection,
    locale,
  ]);

  // Project Actions handlers
  const handleMoveStage = async (projectId: string, targetStageId: string) => {
    await transitionProjectStageAction({ projectId, targetStageId });
    router.refresh();
  };

  const handleDeleteProject = async (projectId: string, projectTitle: string) => {
    if (confirm(t('table.deleteConfirm', { title: projectTitle }))) {
      await deleteProjectAction({ projectId });
      router.refresh();
    }
  };

  const isFiltered =
    searchQuery.trim() !== '' ||
    stageFilter !== 'all' ||
    typeFilter !== 'all' ||
    dateFilter !== 'all';

  return (
    <div className="space-y-4" data-testid="projects-table-container">
      {/* Multi-faceted Filter Bar & Search */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        {/* In-Memory Search Component (ADR-0010 Strict Compliance) */}
        <div className="relative flex-1 max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
            <Search className="h-4 w-4" aria-hidden="true" />
          </div>
          <input
            type="text"
            data-testid="project-search-input"
            aria-label={t('search.label')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            placeholder={t('search.placeholder')}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
          />
          <button
            type="button"
            data-testid="project-search-clear-btn"
            aria-label={t('search.clear')}
            onClick={() => {
              setSearchQuery('');
            }}
            aria-hidden={!searchQuery}
            className={cn(
              'absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted-foreground hover:text-foreground',
              !searchQuery && 'hidden',
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Dropdown Filters (Stage, Type, Date) & Clear button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Stage Filter */}
          <div className="min-w-[130px]">
            <label htmlFor="filter-stage" className="sr-only">
              {t('filters.stage')}
            </label>
            <select
              id="filter-stage"
              data-testid="project-filter-stage"
              value={stageFilter}
              onChange={(e) => {
                handleStageChange(e.target.value);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
            >
              <option value="all">{t('filters.allStages')}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.key}>
                  {getStageName(stage.key, stage.name)}
                </option>
              ))}
            </select>
          </div>

          {/* Type Filter */}
          <div className="min-w-[130px]">
            <label htmlFor="filter-type" className="sr-only">
              {t('filters.type')}
            </label>
            <select
              id="filter-type"
              data-testid="project-filter-type"
              value={typeFilter}
              onChange={(e) => {
                handleTypeChange(e.target.value);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
            >
              <option value="all">{t('filters.allTypes')}</option>
              <option value="wedding">{t('types.wedding')}</option>
              <option value="portrait">{t('types.portrait')}</option>
              <option value="commercial">{t('types.commercial')}</option>
              <option value="event">{t('types.event')}</option>
              <option value="video">{t('types.video')}</option>
              <option value="general">{t('types.general')}</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="min-w-[130px]">
            <label htmlFor="filter-date" className="sr-only">
              {t('filters.date')}
            </label>
            <select
              id="filter-date"
              data-testid="project-filter-date"
              value={dateFilter}
              onChange={(e) => {
                handleDateChange(e.target.value);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs sm:text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
            >
              <option value="all">{t('filters.allDates')}</option>
              <option value="upcoming">{t('filters.upcoming')}</option>
              <option value="past">{t('filters.past')}</option>
              <option value="unscheduled">{t('filters.unscheduled')}</option>
            </select>
          </div>

          {/* Clear Filters Button */}
          {isFiltered && (
            <Button
              type="button"
              variant="ghost"
              data-testid="project-filters-clear-btn"
              onClick={handleClearFilters}
              className="text-xs sm:text-sm text-muted-foreground hover:text-foreground min-h-[44px] sm:min-h-[36px]"
            >
              <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              <span>{t('filters.clear')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Projects Data Table or Empty State */}
      {filteredAndSortedProjects.length === 0 ? (
        <div
          data-testid="projects-table-empty"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center text-card-foreground shadow-2xs space-y-4"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FolderOpen className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-semibold text-foreground">{t('table.emptyTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('table.emptyDescription')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {isFiltered && (
              <Button
                type="button"
                variant="outline"
                data-testid="projects-empty-clear-btn"
                onClick={handleClearFilters}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {t('filters.clear')}
              </Button>
            )}
            <CreateProjectDialog
              clients={clients}
              stages={stages}
              locale={locale}
              trigger={
                <Button
                  type="button"
                  data-testid="projects-empty-create-btn"
                  className="min-h-[44px] sm:min-h-[36px]"
                >
                  <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                  <span>{t('table.emptyCreate')}</span>
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-2xs">
          <table
            data-testid="projects-table"
            role="table"
            className="w-full text-left text-sm border-collapse"
          >
            <thead className="bg-muted/50 border-b border-border text-xs uppercase font-medium text-muted-foreground">
              <tr>
                {/* Title */}
                <th
                  scope="col"
                  aria-sort={
                    sortColumn === 'title'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-4 py-3"
                >
                  <button
                    type="button"
                    data-testid="sort-header-title"
                    onClick={() => {
                      handleSort('title');
                    }}
                    className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span>{t('table.title')}</span>
                    {sortColumn === 'title' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown
                        className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </th>

                {/* Client */}
                <th
                  scope="col"
                  aria-sort={
                    sortColumn === 'client'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-4 py-3"
                >
                  <button
                    type="button"
                    data-testid="sort-header-client"
                    onClick={() => {
                      handleSort('client');
                    }}
                    className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span>{t('table.client')}</span>
                    {sortColumn === 'client' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown
                        className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </th>

                {/* Type */}
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  {t('table.type')}
                </th>

                {/* Stage */}
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  {t('table.stage')}
                </th>

                {/* Shoot Date */}
                <th
                  scope="col"
                  aria-sort={
                    sortColumn === 'date'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-4 py-3"
                >
                  <button
                    type="button"
                    data-testid="sort-header-date"
                    onClick={() => {
                      handleSort('date');
                    }}
                    className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span>{t('table.shootDate')}</span>
                    {sortColumn === 'date' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown
                        className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </th>

                {/* Tasks */}
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  {t('table.tasks')}
                </th>

                {/* Value */}
                <th
                  scope="col"
                  aria-sort={
                    sortColumn === 'value'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-4 py-3 text-right"
                >
                  <button
                    type="button"
                    data-testid="sort-header-value"
                    onClick={() => {
                      handleSort('value');
                    }}
                    className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ml-auto"
                  >
                    <span>{t('table.value')}</span>
                    {sortColumn === 'value' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown
                        className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </th>

                {/* Last Activity */}
                <th
                  scope="col"
                  aria-sort={
                    sortColumn === 'lastActivity'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-4 py-3 hidden md:table-cell"
                >
                  <button
                    type="button"
                    data-testid="sort-header-lastActivity"
                    onClick={() => {
                      handleSort('lastActivity');
                    }}
                    className="group inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span>{t('table.lastActivity')}</span>
                    {sortColumn === 'lastActivity' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown
                        className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </th>

                {/* Actions */}
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">{t('table.actions')}</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border text-foreground">
              {filteredAndSortedProjects.map((project) => {
                const stage = stageMap.get(project.stageId);
                const stageCategory = stage?.category ?? 'inquiry';
                const formattedPrice =
                  project.priceMinor !== null
                    ? formatCurrency(project.priceMinor, project.currency, locale)
                    : t('table.noValue');

                const formattedShoot = project.primaryShootStartsAt
                  ? formatDateTime(project.primaryShootStartsAt, locale)
                  : t('table.noShootDate');

                const otherStages = stages.filter((s) => s.id !== project.stageId);

                return (
                  <tr
                    key={project.id}
                    data-testid={`project-table-row-${project.id}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {/* Title */}
                    <td className="px-4 py-3 font-semibold text-foreground">
                      <Link
                        href={`/${locale}/projects/${project.id}`}
                        data-testid={`project-table-title-${project.id}`}
                        className="hover:text-primary hover:underline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring inline-block max-w-xs truncate"
                      >
                        {project.title}
                      </Link>
                      {project.primaryShootLocationName && (
                        <div
                          data-testid={`project-table-location-${project.id}`}
                          className="text-xs text-muted-foreground truncate max-w-xs font-normal"
                        >
                          {project.primaryShootLocationName}
                        </div>
                      )}
                    </td>

                    {/* Client */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/${locale}/clients/${project.clientId}`}
                        data-testid={`project-table-client-${project.id}`}
                        className="hover:text-primary hover:underline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring inline-block max-w-[180px] truncate"
                      >
                        {project.clientDisplayName}
                      </Link>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <span
                        data-testid={`project-table-type-${project.id}`}
                        className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                      >
                        {getTypeLabel(project.projectTypeKey)}
                      </span>
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <span
                        data-testid={`project-table-stage-${project.id}`}
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
                          getStageCategoryBadgeClasses(stageCategory),
                        )}
                      >
                        {getStageName(project.stageKey, stage?.name)}
                      </span>
                    </td>

                    {/* Shoot Date */}
                    <td
                      data-testid={`project-table-date-${project.id}`}
                      className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap"
                    >
                      {formattedShoot}
                    </td>

                    {/* Tasks Progress */}
                    <td className="px-4 py-3">
                      <span
                        data-testid={`project-table-tasks-${project.id}`}
                        className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        {project.completedTaskCount}/{project.taskCount}
                      </span>
                    </td>

                    {/* Value */}
                    <td
                      data-testid={`project-table-value-${project.id}`}
                      className="px-4 py-3 text-right font-medium whitespace-nowrap"
                    >
                      {formattedPrice}
                    </td>

                    {/* Last Activity */}
                    <td
                      data-testid={`project-table-activity-${project.id}`}
                      className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell"
                    >
                      {formatDateTime(project.lastActivityAt, locale)}
                    </td>

                    {/* Actions dropdown (modal={false} to avoid aria-hidden traps) */}
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`project-actions-trigger-${project.id}`}
                            aria-label={t('table.actionsFor', { title: project.title })}
                            className="h-8 w-8 p-0"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-48"
                          data-testid={`project-actions-menu-${project.id}`}
                        >
                          <DropdownMenuLabel className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {project.title}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />

                          {/* View Project link */}
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/${locale}/projects/${project.id}`}
                              data-testid={`project-action-view-${project.id}`}
                              className="flex items-center min-h-[44px] sm:min-h-[36px] cursor-pointer"
                            >
                              <ExternalLink
                                className="h-4 w-4 mr-2 text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span>{t('table.viewProject')}</span>
                            </Link>
                          </DropdownMenuItem>

                          {/* Move to stage submenu */}
                          {otherStages.length > 0 && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger
                                data-testid={`project-action-move-${project.id}`}
                                className="min-h-[44px] sm:min-h-[36px] cursor-pointer"
                              >
                                <ArrowRight
                                  className="h-4 w-4 mr-2 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span>{t('table.moveStage')}</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent
                                data-testid={`move-subcontent-${project.id}`}
                                className="w-44"
                              >
                                {otherStages.map((s) => (
                                  <DropdownMenuItem
                                    key={s.id}
                                    data-testid={`project-move-target-${project.id}-${s.key}`}
                                    onClick={() => {
                                      void handleMoveStage(project.id, s.id);
                                    }}
                                    className="min-h-[44px] sm:min-h-[36px] cursor-pointer"
                                  >
                                    <span>{getStageName(s.key, s.name)}</span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}

                          <DropdownMenuSeparator />

                          {/* Delete Project */}
                          <DropdownMenuItem
                            data-testid={`project-action-delete-${project.id}`}
                            onClick={() => {
                              void handleDeleteProject(project.id, project.title);
                            }}
                            className="text-red-700 dark:text-red-200 focus:text-red-800 dark:focus:text-red-100 font-medium min-h-[44px] sm:min-h-[36px] cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                            <span>{t('table.deleteProject')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

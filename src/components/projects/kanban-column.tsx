'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FolderKanban } from 'lucide-react';
import { ProjectCard } from './project-card';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

export interface KanbanColumnProps {
  stage: PipelineStage;
  allStages: PipelineStage[];
  projects: KanbanProject[];
  locale: string;
  studioCurrency?: string;
  onMoveToStage: (project: KanbanProject, targetStageId: string) => void;
  onProjectDrop: (projectId: string, targetStageId: string) => void;
  draggingProjectId: string | null;
  setDraggingProjectId: (id: string | null) => void;
  transitioningProjectIds: Set<string>;
}

export function getStageCategoryBadgeClasses(category: string): string {
  switch (category) {
    case 'inquiry':
      return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700';
    case 'booked':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border-blue-300 dark:border-blue-700';
    case 'in_progress':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border-amber-300 dark:border-amber-700';
    case 'review':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-purple-300 dark:border-purple-700';
    case 'completed':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700';
    case 'archived':
    default:
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700';
  }
}

export function KanbanColumn({
  stage,
  allStages,
  projects,
  locale,
  studioCurrency = 'EUR',
  onMoveToStage,
  onProjectDrop,
  draggingProjectId,
  setDraggingProjectId,
  transitioningProjectIds,
}: KanbanColumnProps) {
  const t = useTranslations('projects');
  const [isDragOver, setIsDragOver] = React.useState(false);

  // Localized stage name
  const stageName = t.has(`stages.${stage.key}`) ? t(`stages.${stage.key}`) : stage.name;

  // Sum total monetary value in minor units
  const totalValueMinor = React.useMemo(() => {
    return projects.reduce((sum, p) => sum + (p.priceMinor ?? 0), 0);
  }, [projects]);

  // Formatted total pipeline value
  const formattedTotalValue = React.useMemo(() => {
    return formatCurrency(totalValueMinor, studioCurrency, locale);
  }, [totalValueMinor, studioCurrency, locale]);

  const badgeColorClass = getStageCategoryBadgeClasses(stage.category);

  return (
    <section
      aria-labelledby={`kanban-column-heading-${stage.key}`}
      data-testid={`kanban-column-${stage.key}`}
      className="flex flex-col w-72 sm:w-80 shrink-0 rounded-xl border border-border bg-muted/30 p-3 shadow-xs"
    >
      {/* Column Header */}
      <header className="flex flex-col gap-2 pb-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              id={`kanban-column-heading-${stage.key}`}
              data-testid={`kanban-column-title-${stage.key}`}
              className="text-sm font-semibold tracking-tight text-foreground truncate"
            >
              {stageName}
            </h2>

            {/* Category Color Badge */}
            <span
              data-testid={`kanban-column-category-${stage.key}`}
              className={cn(
                'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold border uppercase tracking-wide',
                badgeColorClass,
              )}
            >
              {stage.category}
            </span>
          </div>

          {/* Project Count Badge */}
          <span
            data-testid={`kanban-column-count-${stage.key}`}
            className="inline-flex items-center justify-center rounded-full bg-background border border-border px-2 py-0.5 text-xs font-semibold text-foreground shadow-2xs"
            aria-label={t('column.projectCount', { count: projects.length })}
          >
            {projects.length}
          </span>
        </div>

        {/* Total Pipeline Monetary Value */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid={`kanban-column-total-${stage.key}`}>
            {t('column.totalValue', { value: formattedTotalValue })}
          </span>
        </div>
      </header>

      {/* HTML5 Drag & Drop Drop Zone */}
      <div
        data-testid={`kanban-column-dropzone-${stage.key}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const projectId = e.dataTransfer.getData('text/plain');
          if (projectId) {
            onProjectDrop(projectId, stage.id);
          }
        }}
        className={cn(
          'flex flex-col flex-1 gap-3 py-3 rounded-lg transition-all min-h-[350px]',
          isDragOver && 'bg-primary/5 ring-2 ring-primary ring-dashed rounded-lg p-2',
        )}
      >
        {/* Visual Drop Indicator */}
        {isDragOver && (
          <div
            data-testid={`drop-indicator-${stage.key}`}
            className="h-16 rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center text-xs font-medium text-primary animate-pulse"
          >
            {t('column.dropIndicator')}
          </div>
        )}

        {/* Projects Cards List */}
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            stages={allStages}
            locale={locale}
            onMoveToStage={onMoveToStage}
            onDragStart={(id) => {
              setDraggingProjectId(id);
            }}
            onDragEnd={() => {
              setDraggingProjectId(null);
            }}
            isDragging={draggingProjectId === project.id}
            isTransitioning={transitioningProjectIds.has(project.id)}
          />
        ))}

        {/* Empty State Indicator */}
        {projects.length === 0 && !isDragOver && (
          <div
            data-testid={`kanban-column-empty-${stage.key}`}
            className="flex flex-col items-center justify-center flex-1 rounded-lg border border-dashed border-border/80 bg-background/50 p-6 text-center text-xs text-muted-foreground"
          >
            <FolderKanban className="h-6 w-6 mb-2 text-muted-foreground/40" aria-hidden="true" />
            <span>{t('column.empty')}</span>
          </div>
        )}
      </div>
    </section>
  );
}

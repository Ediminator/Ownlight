'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Calendar, CheckSquare, MoreVertical, ArrowRight } from 'lucide-react';
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
import { formatCurrency, formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

export interface ProjectCardProps {
  project: KanbanProject;
  stages: PipelineStage[];
  locale: string;
  onMoveToStage: (project: KanbanProject, targetStageId: string) => void;
  onDragStart?: (projectId: string) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isTransitioning?: boolean;
}

export function ProjectCard({
  project,
  stages,
  locale,
  onMoveToStage,
  onDragStart,
  onDragEnd,
  isDragging = false,
  isTransitioning = false,
}: ProjectCardProps) {
  const t = useTranslations('projects');

  // Localized stage name helper
  const getStageName = React.useCallback(
    (stage: PipelineStage): string => {
      return t.has(`stages.${stage.key}`) ? t(`stages.${stage.key}`) : stage.name;
    },
    [t],
  );

  // Formatted price
  const formattedPrice = React.useMemo(() => {
    if (project.priceMinor === null) return null;
    return formatCurrency(project.priceMinor, project.currency, locale);
  }, [project.priceMinor, project.currency, locale]);

  // Formatted shoot date
  const formattedShootDate = React.useMemo(() => {
    if (!project.primaryShootStartsAt) return null;
    return formatDate(project.primaryShootStartsAt, locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [project.primaryShootStartsAt, locale]);

  // Project type label
  const projectTypeLabel = React.useMemo(() => {
    const key = project.projectTypeKey.toLowerCase();
    if (t.has(`types.${key}`)) {
      return t(`types.${key}`);
    }
    return project.projectTypeKey.charAt(0).toUpperCase() + project.projectTypeKey.slice(1);
  }, [project.projectTypeKey, t]);

  // Other available stages
  const targetStages = React.useMemo(
    () => stages.filter((s) => s.id !== project.stageId),
    [stages, project.stageId],
  );

  return (
    <div
      role="article"
      aria-roledescription="project card"
      draggable={!isTransitioning}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', project.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(project.id);
      }}
      onDragEnd={() => {
        onDragEnd?.();
      }}
      data-testid={`project-card-${project.id}`}
      className={cn(
        'group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm transition-all hover:shadow-md cursor-grab active:cursor-grabbing focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
        isDragging && 'opacity-40 scale-[0.98] border-dashed border-primary',
        isTransitioning && 'opacity-60 pointer-events-none',
      )}
    >
      {/* Top Header: Title & Action Menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/${locale}/projects/${project.id}`}
            data-testid={`project-card-title-${project.id}`}
            className="block truncate font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm text-sm sm:text-base min-h-[24px] leading-6"
            aria-label={t('card.projectLinkAria', { title: project.title })}
          >
            {project.title}
          </Link>

          <Link
            href={`/${locale}/clients/${project.clientId}`}
            data-testid={`project-card-client-${project.id}`}
            className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm min-h-[24px] leading-6"
            aria-label={t('card.clientLinkAria', { name: project.clientDisplayName })}
          >
            {project.clientDisplayName}
          </Link>
        </div>

        {/* Action Menu (Accessible Keyboard Alternative - SC 2.5.7 & SC 2.1.1) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid={`project-actions-trigger-${project.id}`}
              aria-label={t('card.actionsFor', { title: project.title })}
              className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] -mr-1 -mt-1 shrink-0 transition-colors"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56"
            data-testid={`project-actions-menu-${project.id}`}
          >
            <DropdownMenuLabel className="truncate text-xs font-semibold text-muted-foreground">
              {project.title}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Move to stage submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                data-testid="project-action-move-trigger"
                className="min-h-[44px] sm:min-h-[36px] cursor-pointer"
              >
                <ArrowRight className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
                <span>{t('card.moveToStage')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                data-testid={`move-to-stage-subcontent-${project.id}`}
                className="w-48"
              >
                {targetStages.map((stage) => (
                  <DropdownMenuItem
                    key={stage.id}
                    data-testid={`project-action-move-${stage.key}`}
                    onClick={() => {
                      onMoveToStage(project, stage.id);
                    }}
                    className="min-h-[44px] sm:min-h-[36px] cursor-pointer"
                  >
                    <span>{getStageName(stage)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Middle row: Project Type Badge & Primary Shoot Date */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          data-testid={`project-card-type-${project.id}`}
          className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 font-medium text-secondary-foreground"
        >
          {projectTypeLabel}
        </span>

        {formattedShootDate ? (
          <span
            data-testid={`project-card-shoot-date-${project.id}`}
            className="inline-flex items-center gap-1 text-muted-foreground"
          >
            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{formattedShootDate}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-xs italic">{t('card.noShootDate')}</span>
        )}
      </div>

      {/* Footer row: Task Progress Pill & Formatted Price */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-xs">
        <span
          data-testid={`project-card-tasks-${project.id}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium',
            project.taskCount > 0
              ? project.completedTaskCount === project.taskCount
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <CheckSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {project.taskCount > 0
              ? t('card.tasksCount', {
                  completed: project.completedTaskCount,
                  total: project.taskCount,
                })
              : t('card.noTasks')}
          </span>
        </span>

        {formattedPrice && (
          <span
            data-testid={`project-card-price-${project.id}`}
            className="font-semibold text-foreground inline-flex items-center"
          >
            {formattedPrice}
          </span>
        )}
      </div>
    </div>
  );
}

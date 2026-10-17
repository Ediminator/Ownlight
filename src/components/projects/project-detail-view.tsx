'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  Loader2,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type {
  ProjectDetailData,
  ProjectDetailShootLocation,
  ProjectDetailTimelineItem,
  ProjectDetailParticipant,
} from '@/server/projects/service';
import type { Project, Shoot, ProjectTask, PipelineStage } from '@/server/db/schema/projects';
import {
  updateProjectAction,
  deleteProjectAction,
  transitionProjectStageAction,
} from '@/server/projects/actions';
import { TaskWarningDialog, type IncompleteTaskItem } from './task-warning-dialog';
import { ShootsSection } from './shoots-section';
import { LocationsSection } from './locations-section';
import { TimelineScheduleSection } from './timeline-schedule-section';
import { ParticipantsSection } from './participants-section';
import { StageTasksSection } from './stage-tasks-section';

export interface ProjectDetailViewProps {
  initialData: ProjectDetailData;
  locale: string;
}

type TabKey = 'all' | 'shoots' | 'locations' | 'timeline' | 'participants' | 'tasks';

const PROJECT_TYPES = [
  'wedding',
  'portrait',
  'commercial',
  'event',
  'video',
  'general',
  'engagement',
  'editorial',
];

export function ProjectDetailView({ initialData, locale }: ProjectDetailViewProps) {
  const router = useRouter();
  const t = useTranslations('projects');
  const tDetail = useTranslations('projects.detail');

  // State
  const [project, setProject] = React.useState<Project>(initialData.project);
  const [shoots, setShoots] = React.useState<Shoot[]>(initialData.shoots);
  const [locations, setLocations] = React.useState<ProjectDetailShootLocation[]>(
    initialData.locations,
  );
  const [timelineItems, setTimelineItems] = React.useState<ProjectDetailTimelineItem[]>(
    initialData.timelineItems,
  );
  const [participants, setParticipants] = React.useState<ProjectDetailParticipant[]>(
    initialData.participants,
  );
  const [tasks, setTasks] = React.useState<ProjectTask[]>(initialData.tasks);
  const [currentStage, setCurrentStage] = React.useState<PipelineStage | null>(
    initialData.currentStage,
  );
  const stages = initialData.stages;
  const client = initialData.client;
  const clientContacts = initialData.clientContacts;

  const [activeTab, setActiveTab] = React.useState<TabKey>('all');

  // Stage transition warning dialog state
  const [pendingTargetStageId, setPendingTargetStageId] = React.useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = React.useState(false);
  const [transitionError, setTransitionError] = React.useState<string | null>(null);

  // Edit Project dialog state
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(project.title);
  const [editType, setEditType] = React.useState(project.projectTypeKey);
  const [editPrice, setEditPrice] = React.useState(
    project.priceMinor !== null ? (project.priceMinor / 100).toString() : '',
  );
  const [editNotes, setEditNotes] = React.useState(project.notes ?? '');
  const [isSavingProject, setIsSavingProject] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete Project dialog state
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // Localized helpers
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

  // Formatted price
  const formattedPrice = React.useMemo(() => {
    if (project.priceMinor === null) return t('table.noValue');
    return formatCurrency(project.priceMinor, project.currency, locale);
  }, [project.priceMinor, project.currency, locale, t]);

  // Stage progress calculations
  const sortedStages = React.useMemo(() => {
    return [...stages].sort((a, b) => a.position - b.position);
  }, [stages]);

  const currentStageIndex = React.useMemo(() => {
    return sortedStages.findIndex((s) => s.id === project.stageId);
  }, [sortedStages, project.stageId]);

  // Handle stage stepper click
  const handleStageClick = (targetStageId: string) => {
    if (targetStageId === project.stageId || isTransitioning) return;

    // Check for incomplete tasks in the current stage
    const incompleteTasks: IncompleteTaskItem[] = tasks
      .filter((task) => !task.isCompleted && (task.stageId === project.stageId || !task.stageId))
      .map((task) => ({ id: task.id, title: task.title }));

    if (incompleteTasks.length > 0) {
      setPendingTargetStageId(targetStageId);
    } else {
      void performStageTransition(targetStageId);
    }
  };

  const performStageTransition = async (targetStageId: string) => {
    setIsTransitioning(true);
    setTransitionError(null);

    try {
      const res = await transitionProjectStageAction({
        projectId: project.id,
        targetStageId,
      });

      if (!res.success) {
        setTransitionError(res.error || tDetail('stageChangeFailed'));
        return;
      }

      const nextStage = stages.find((s) => s.id === targetStageId) ?? null;
      setProject((prev) => ({ ...prev, stageId: targetStageId }));
      setCurrentStage(nextStage);
      setPendingTargetStageId(null);
      router.refresh();
    } catch {
      setTransitionError(tDetail('stageChangeFailed'));
    } finally {
      setIsTransitioning(false);
    }
  };

  // Edit Project submit
  const handleSaveProject = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) {
      setEditError(t('create.errorTitleRequired'));
      return;
    }

    setIsSavingProject(true);
    setEditError(null);

    const priceMinor = editPrice.trim() !== '' ? Math.round(parseFloat(editPrice) * 100) : null;

    try {
      const res = await updateProjectAction({
        projectId: project.id,
        title: editTitle.trim(),
        projectTypeKey: editType,
        priceMinor,
        notes: editNotes.trim() || null,
      });

      if (!res.success) {
        setEditError(res.error || tDetail('saveChanges'));
        return;
      }

      setProject((prev) => ({
        ...prev,
        title: editTitle.trim(),
        projectTypeKey: editType,
        priceMinor,
        notes: editNotes.trim() || null,
      }));
      setIsEditOpen(false);
      router.refresh();
    } catch {
      setEditError(tDetail('saveChanges'));
    } finally {
      setIsSavingProject(false);
    }
  };

  // Delete Project submit
  const handleDeleteProject = async () => {
    setIsDeleting(true);
    try {
      const res = await deleteProjectAction({ projectId: project.id });
      if (res.success) {
        router.push(`/${locale}/projects`);
      }
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const targetStageObj = sortedStages.find((s) => s.id === pendingTargetStageId);
  const currentStageIncompleteTasks: IncompleteTaskItem[] = tasks
    .filter((task) => !task.isCompleted && (task.stageId === project.stageId || !task.stageId))
    .map((task) => ({ id: task.id, title: task.title }));

  // Tabs metadata
  const tabList: { key: TabKey; label: string; count?: number }[] = [
    { key: 'all', label: tDetail('tabs.all') },
    { key: 'shoots', label: tDetail('tabs.shoots'), count: shoots.length },
    { key: 'locations', label: tDetail('tabs.locations'), count: locations.length },
    { key: 'timeline', label: tDetail('tabs.timeline'), count: timelineItems.length },
    { key: 'participants', label: tDetail('tabs.participants'), count: participants.length },
    {
      key: 'tasks',
      label: tDetail('tabs.tasks'),
      count: tasks.filter((t) => t.stageId === project.stageId || !t.stageId).length,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Back Link */}
      <nav aria-label="Breadcrumb" data-testid="project-breadcrumb">
        <Link
          href={`/${locale}/projects`}
          data-testid="project-back-link"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px] sm:min-h-[32px]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>{tDetail('backToProjects')}</span>
        </Link>
      </nav>

      {/* Header Card */}
      <header className="rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                data-testid="project-type-badge"
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground"
              >
                {getTypeLabel(project.projectTypeKey)}
              </span>
              <span
                data-testid="project-price"
                className="inline-flex items-center gap-1 text-sm font-semibold text-foreground px-2 py-0.5 rounded-md bg-muted/60"
              >
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {formattedPrice}
              </span>
            </div>

            <h1
              data-testid="project-title"
              className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl break-words"
            >
              {project.title}
            </h1>

            {/* Client Card Link */}
            <div className="pt-1">
              <Link
                href={`/${locale}/clients/${project.clientId}`}
                data-testid="project-client-link"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm py-1 min-h-[44px] sm:min-h-[32px]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {client.displayName.charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-foreground">{client.displayName}</span>
              </Link>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="edit-project-btn"
              onClick={() => {
                setEditTitle(project.title);
                setEditType(project.projectTypeKey);
                setEditPrice(
                  project.priceMinor !== null ? (project.priceMinor / 100).toString() : '',
                );
                setEditNotes(project.notes ?? '');
                setEditError(null);
                setIsEditOpen(true);
              }}
              className="min-h-[44px] sm:min-h-[36px] gap-1.5"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>{tDetail('editProject')}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="delete-project-btn"
              onClick={() => {
                setIsDeleteOpen(true);
              }}
              className="min-h-[44px] sm:min-h-[36px] gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>{tDetail('deleteProject')}</span>
            </Button>
          </div>
        </div>

        {/* Stage Progress Stepper */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            {t('table.stage')}
          </p>
          <nav aria-label="Project stages" data-testid="stage-stepper" className="w-full">
            <ol className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {sortedStages.map((stage, idx) => {
                const isCurrent = stage.id === project.stageId;
                const isPast = currentStageIndex > -1 && idx < currentStageIndex;

                return (
                  <li key={stage.id} className="relative">
                    <button
                      type="button"
                      data-testid={`stage-step-${stage.key}`}
                      aria-current={isCurrent ? 'step' : undefined}
                      disabled={isTransitioning}
                      onClick={() => {
                        handleStageClick(stage.id);
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-medium transition-all min-h-[44px] min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isCurrent
                          ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                          : isPast
                            ? 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
                            : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40',
                      )}
                    >
                      {isCurrent ? (
                        <Circle className="h-4 w-4 fill-primary text-primary shrink-0" />
                      ) : isPast ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                      )}
                      <span className="truncate min-w-0">
                        {getStageName(stage.key, stage.name)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {transitionError && (
            <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {transitionError}
            </p>
          )}
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="border-b border-border">
        <div
          role="tablist"
          aria-label="Project sections"
          className="flex flex-wrap gap-2 -mb-px overflow-x-auto py-1"
        >
          {tabList.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`tab-${tab.key}`}
                data-testid={`tab-${tab.key}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => {
                  setActiveTab(tab.key);
                }}
                className={cn(
                  'inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-b-2 transition-colors min-h-[44px] sm:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md',
                  isActive
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={cn(
                      'ml-1 px-1.5 py-0.2 rounded-full text-xs font-bold',
                      isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels Content */}
      <main className="space-y-8">
        {activeTab === 'all' && (
          <div id="panel-all" role="tabpanel" aria-labelledby="tab-all" className="space-y-10">
            <ShootsSection
              projectId={project.id}
              shoots={shoots}
              locale={locale}
              onShootsChange={setShoots}
            />
            <LocationsSection
              projectId={project.id}
              shoots={shoots}
              locations={locations}
              locale={locale}
              onLocationsChange={setLocations}
            />
            <TimelineScheduleSection
              projectId={project.id}
              shoots={shoots}
              locations={locations}
              timelineItems={timelineItems}
              locale={locale}
              onTimelineItemsChange={setTimelineItems}
            />
            <ParticipantsSection
              projectId={project.id}
              participants={participants}
              clientContacts={clientContacts}
              locale={locale}
              onParticipantsChange={setParticipants}
            />
            <StageTasksSection
              projectId={project.id}
              currentStage={currentStage}
              tasks={tasks}
              locale={locale}
              onTasksChange={setTasks}
            />
          </div>
        )}

        {activeTab === 'shoots' && (
          <div id="panel-shoots" role="tabpanel" aria-labelledby="tab-shoots">
            <ShootsSection
              projectId={project.id}
              shoots={shoots}
              locale={locale}
              onShootsChange={setShoots}
            />
          </div>
        )}

        {activeTab === 'locations' && (
          <div id="panel-locations" role="tabpanel" aria-labelledby="tab-locations">
            <LocationsSection
              projectId={project.id}
              shoots={shoots}
              locations={locations}
              locale={locale}
              onLocationsChange={setLocations}
            />
          </div>
        )}

        {activeTab === 'timeline' && (
          <div id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline">
            <TimelineScheduleSection
              projectId={project.id}
              shoots={shoots}
              locations={locations}
              timelineItems={timelineItems}
              locale={locale}
              onTimelineItemsChange={setTimelineItems}
            />
          </div>
        )}

        {activeTab === 'participants' && (
          <div id="panel-participants" role="tabpanel" aria-labelledby="tab-participants">
            <ParticipantsSection
              projectId={project.id}
              participants={participants}
              clientContacts={clientContacts}
              locale={locale}
              onParticipantsChange={setParticipants}
            />
          </div>
        )}

        {activeTab === 'tasks' && (
          <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
            <StageTasksSection
              projectId={project.id}
              currentStage={currentStage}
              tasks={tasks}
              locale={locale}
              onTasksChange={setTasks}
            />
          </div>
        )}
      </main>

      {/* Advisory Stage Transition Warning Dialog */}
      {pendingTargetStageId && targetStageObj && (
        <TaskWarningDialog
          open={Boolean(pendingTargetStageId)}
          onOpenChange={(open) => {
            if (!open) setPendingTargetStageId(null);
          }}
          currentStageName={getStageName(
            currentStage?.key ?? 'inquiry',
            currentStage?.name ?? 'Current',
          )}
          targetStageName={getStageName(targetStageObj.key, targetStageObj.name)}
          incompleteTasks={currentStageIncompleteTasks}
          onConfirm={() => {
            void performStageTransition(pendingTargetStageId);
          }}
          onCancel={() => {
            setPendingTargetStageId(null);
          }}
          isConfirming={isTransitioning}
        />
      )}

      {/* Edit Project Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent
          className="max-w-lg"
          data-testid="edit-project-dialog"
          closeAriaLabel={tDetail('cancel')}
        >
          <form
            onSubmit={(e) => {
              void handleSaveProject(e);
            }}
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-foreground">
                {tDetail('editModalTitle')}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t('create.description')}
              </DialogDescription>
            </DialogHeader>

            {editError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium"
              >
                {editError}
              </div>
            )}

            <div className="space-y-4 text-left">
              {/* Project Title */}
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-project-title"
                  className="text-xs font-semibold text-foreground"
                >
                  {t('create.projectTitle')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="edit-project-title"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                  }}
                  data-testid="edit-project-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              {/* Project Type */}
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-project-type"
                  className="text-xs font-semibold text-foreground"
                >
                  {t('create.projectType')}
                </label>
                <select
                  id="edit-project-type"
                  value={editType}
                  onChange={(e) => {
                    setEditType(e.target.value);
                  }}
                  data-testid="edit-project-type-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                >
                  {PROJECT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {getTypeLabel(pt)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Agreed Price */}
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-project-price"
                  className="text-xs font-semibold text-foreground"
                >
                  {t('create.price')}
                </label>
                <input
                  id="edit-project-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editPrice}
                  onChange={(e) => {
                    setEditPrice(e.target.value);
                  }}
                  data-testid="edit-project-price-input"
                  placeholder={t('create.pricePlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-project-notes"
                  className="text-xs font-semibold text-foreground"
                >
                  {t('create.notes')}
                </label>
                <textarea
                  id="edit-project-notes"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => {
                    setEditNotes(e.target.value);
                  }}
                  data-testid="edit-project-notes-input"
                  placeholder={t('create.notesPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditOpen(false);
                }}
                disabled={isSavingProject}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isSavingProject}
                data-testid="edit-project-submit-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isSavingProject ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    {tDetail('saving')}
                  </>
                ) : (
                  tDetail('saveChanges')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent
          className="max-w-md"
          data-testid="delete-project-dialog"
          closeAriaLabel={tDetail('cancel')}
        >
          <div className="space-y-4">
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  {tDetail('deleteProject')}
                </DialogTitle>
              </div>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed pt-2">
                {tDetail('deleteConfirm')}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDeleteOpen(false);
                }}
                disabled={isDeleting}
                data-testid="delete-project-cancel-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void handleDeleteProject();
                }}
                disabled={isDeleting}
                data-testid="delete-project-confirm-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    {tDetail('deleting')}
                  </>
                ) : (
                  tDetail('deleteProject')
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

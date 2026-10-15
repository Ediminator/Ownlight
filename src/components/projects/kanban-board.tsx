'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, X } from 'lucide-react';
import { KanbanColumn } from './kanban-column';
import { TaskWarningDialog, type IncompleteTaskItem } from './task-warning-dialog';
import { transitionProjectStageAction } from '@/server/projects/actions';
import type { KanbanProject } from '@/server/projects/service';
import type { PipelineStage } from '@/server/db/schema/projects';

export interface KanbanBoardProps {
  initialStages: PipelineStage[];
  initialProjects: KanbanProject[];
  locale: string;
  studioCurrency?: string;
}

interface PendingTransition {
  project: KanbanProject;
  targetStageId: string;
  sourceStageId: string;
  incompleteTasks: IncompleteTaskItem[];
}

export function KanbanBoard({
  initialStages,
  initialProjects,
  locale,
  studioCurrency = 'EUR',
}: KanbanBoardProps) {
  const t = useTranslations('projects');

  // Stages sorted by position ASC
  const stages = React.useMemo(() => {
    return [...initialStages].sort((a, b) => a.position - b.position);
  }, [initialStages]);

  const stageMap = React.useMemo(() => {
    return new Map<string, PipelineStage>(stages.map((s) => [s.id, s]));
  }, [stages]);

  // Projects state for optimistic updates
  const [projects, setProjects] = React.useState<KanbanProject[]>(initialProjects);
  const [prevInitialProjects, setPrevInitialProjects] = React.useState(initialProjects);
  if (prevInitialProjects !== initialProjects) {
    setPrevInitialProjects(initialProjects);
    setProjects(initialProjects);
  }

  // Transitioning and drag states
  const [draggingProjectId, setDraggingProjectId] = React.useState<string | null>(null);
  const [transitioningProjectIds, setTransitioningProjectIds] = React.useState<Set<string>>(
    new Set(),
  );

  // Advisory task dialog state
  const [pendingTransition, setPendingTransition] = React.useState<PendingTransition | null>(null);
  const [isConfirmingDialog, setIsConfirmingDialog] = React.useState(false);

  // ARIA Live region announcement state (WCAG 2.2 SC 2.1.1 & SC 2.5.7)
  const [liveAnnouncement, setLiveAnnouncement] = React.useState<string>('');

  // Toast notification state
  const [toast, setToast] = React.useState<{ message: string } | null>(null);

  // Auto-dismiss toast after 6 seconds
  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  // Localized stage name helper
  const getStageName = React.useCallback(
    (stageId: string): string => {
      const stage = stageMap.get(stageId);
      if (!stage) return 'Unknown Stage';
      return t.has(`stages.${stage.key}`) ? t(`stages.${stage.key}`) : stage.name;
    },
    [stageMap, t],
  );

  // Executes transition with optimistic UI and error rollback (AC-2, AC-3, AC-6)
  const executeTransition = React.useCallback(
    async (project: KanbanProject, targetStageId: string) => {
      const targetStage = stageMap.get(targetStageId);
      if (!targetStage) return;

      const previousProjects = [...projects];

      // Optimistic update
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, stageId: targetStageId, stageKey: targetStage.key } : p,
        ),
      );

      // Track in-flight transition
      setTransitioningProjectIds((prev) => new Set(prev).add(project.id));

      try {
        const result = await transitionProjectStageAction({
          projectId: project.id,
          targetStageId,
        });

        if (!result.success) {
          throw new Error(result.error || 'TRANSITION_FAILED');
        }

        // Live announcement on success
        const targetStageName = getStageName(targetStageId);
        setLiveAnnouncement(
          t('announcements.stageChanged', {
            title: project.title,
            stage: targetStageName,
          }),
        );
      } catch {
        // Rollback on failure (AC-6)
        setProjects(previousProjects);
        setToast({ message: t('toast.stageChangeError') });

        const targetStageName = getStageName(targetStageId);
        setLiveAnnouncement(
          t('announcements.stageChangeFailed', {
            title: project.title,
            stage: targetStageName,
          }),
        );
      } finally {
        setTransitioningProjectIds((prev) => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });
      }
    },
    [projects, stageMap, getStageName, t],
  );

  // Checks advisory tasks before initiating transition (AC-4)
  const initiateTransition = React.useCallback(
    (project: KanbanProject, targetStageId: string) => {
      if (project.stageId === targetStageId) return;

      // Incomplete tasks for the current stage
      const incompleteInCurrentStage = project.incompleteTasks.filter(
        (t) => !t.stageId || t.stageId === project.stageId,
      );

      if (incompleteInCurrentStage.length > 0) {
        // Show advisory task warning dialog (AC-4)
        setPendingTransition({
          project,
          targetStageId,
          sourceStageId: project.stageId,
          incompleteTasks: incompleteInCurrentStage,
        });
      } else {
        // No incomplete tasks, transition immediately
        void executeTransition(project, targetStageId);
      }
    },
    [executeTransition],
  );

  // Drop handler for native HTML5 drag-and-drop (AC-2)
  const handleProjectDrop = React.useCallback(
    (projectId: string, targetStageId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      initiateTransition(project, targetStageId);
    },
    [projects, initiateTransition],
  );

  // Keyboard menu move handler (AC-3)
  const handleMoveToStage = React.useCallback(
    (project: KanbanProject, targetStageId: string) => {
      initiateTransition(project, targetStageId);
    },
    [initiateTransition],
  );

  // Confirmation handler for advisory dialog (AC-4)
  const handleConfirmTaskWarning = React.useCallback(async () => {
    if (!pendingTransition) return;
    setIsConfirmingDialog(true);
    const { project, targetStageId } = pendingTransition;
    setPendingTransition(null);
    setIsConfirmingDialog(false);
    await executeTransition(project, targetStageId);
  }, [pendingTransition, executeTransition]);

  // Cancel handler for advisory dialog (AC-4)
  const handleCancelTaskWarning = React.useCallback(() => {
    setPendingTransition(null);
  }, []);

  return (
    <div className="relative flex flex-col gap-4">
      {/* ARIA Live Region for Screen Readers (WCAG 2.2 SC 2.1.1 & SC 2.5.7) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="kanban-live-region"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      {/* Kanban Horizontal Board Container */}
      <div className="overflow-x-auto pb-6 pt-2 focus:outline-none">
        <div className="flex gap-4 min-w-max items-start">
          {stages.map((stage) => {
            const stageProjects = projects.filter((p) => p.stageId === stage.id);
            return (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                allStages={stages}
                projects={stageProjects}
                locale={locale}
                studioCurrency={studioCurrency}
                onMoveToStage={handleMoveToStage}
                onProjectDrop={handleProjectDrop}
                draggingProjectId={draggingProjectId}
                setDraggingProjectId={(id) => {
                  setDraggingProjectId(id);
                }}
                transitioningProjectIds={transitioningProjectIds}
              />
            );
          })}
        </div>
      </div>

      {/* Advisory Task Warning Dialog (AC-4) */}
      {pendingTransition && (
        <TaskWarningDialog
          open={Boolean(pendingTransition)}
          onOpenChange={(open) => {
            if (!open) {
              handleCancelTaskWarning();
            }
          }}
          currentStageName={getStageName(pendingTransition.sourceStageId)}
          targetStageName={getStageName(pendingTransition.targetStageId)}
          incompleteTasks={pendingTransition.incompleteTasks}
          onConfirm={() => {
            void handleConfirmTaskWarning();
          }}
          onCancel={handleCancelTaskWarning}
          isConfirming={isConfirmingDialog}
        />
      )}

      {/* Error Toast Notification (AC-6) */}
      {toast && (
        <div
          role="alert"
          data-testid="kanban-error-toast"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive text-destructive-foreground px-4 py-3 shadow-xl max-w-md animate-in fade-in slide-in-from-bottom-3"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium leading-snug flex-1">{toast.message}</p>
          <button
            type="button"
            data-testid="kanban-error-toast-dismiss"
            onClick={() => {
              setToast(null);
            }}
            aria-label="Dismiss error notification"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-destructive-foreground/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

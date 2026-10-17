'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckSquare, Square, Plus, Trash2, Calendar, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/formatters';
import type { ProjectTask, PipelineStage } from '@/server/db/schema/projects';
import {
  createProjectTaskAction,
  toggleProjectTaskAction,
  deleteProjectTaskAction,
} from '@/server/projects/actions';

export interface StageTasksSectionProps {
  projectId: string;
  currentStage: PipelineStage | null;
  tasks: ProjectTask[];
  locale: string;
  onTasksChange?: (tasks: ProjectTask[]) => void;
}

export function StageTasksSection({
  projectId,
  currentStage,
  tasks: initialTasks,
  locale,
  onTasksChange,
}: StageTasksSectionProps) {
  const t = useTranslations('projects.detail.tasks');
  const tDetail = useTranslations('projects.detail');

  const [tasks, setTasks] = React.useState<ProjectTask[]>(initialTasks);

  // Filter tasks for the current stage (or all if no current stage)
  const stageTasks = React.useMemo(() => {
    if (!currentStage) return tasks;
    return tasks.filter((t) => t.stageId === currentStage.id);
  }, [tasks, currentStage]);

  const completedCount = React.useMemo(
    () => stageTasks.filter((t) => t.isCompleted).length,
    [stageTasks],
  );
  const totalCount = stageTasks.length;

  // Add Task State
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Toggling Task In-Flight Tracker
  const [togglingTaskIds, setTogglingTaskIds] = React.useState<Set<string>>(new Set());

  // Delete Task State
  const [deletingTask, setDeletingTask] = React.useState<ProjectTask | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    setTitle('');
    setDueDate('');
    setAddError(null);
    setIsAddOpen(true);
  };

  const handleCreateTask = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAdding) return;

    if (!title.trim()) {
      setAddError('Task title is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await createProjectTaskAction({
        projectId,
        stageId: currentStage?.id ?? null,
        title: title.trim(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        order: tasks.length + 1,
      });

      if (!res.success) {
        setAddError(res.error);
        return;
      }

      const created = res.data.task;
      const updated = [...tasks, created].sort((a, b) => a.order - b.order);
      setTasks(updated);
      onTasksChange?.(updated);
      setIsAddOpen(false);
    } catch {
      setAddError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleTask = async (task: ProjectTask) => {
    if (togglingTaskIds.has(task.id)) return;

    const nextCompleted = !task.isCompleted;

    // Immediate optimistic update
    const previousTasks = [...tasks];
    const optimisticTasks = tasks.map((t) =>
      t.id === task.id ? { ...t, isCompleted: nextCompleted } : t,
    );
    setTasks(optimisticTasks);
    onTasksChange?.(optimisticTasks);

    setTogglingTaskIds((prev) => new Set(prev).add(task.id));

    try {
      const res = await toggleProjectTaskAction({ taskId: task.id });
      if (!res.success) {
        // Rollback on failure
        setTasks(previousTasks);
        onTasksChange?.(previousTasks);
      }
    } catch {
      setTasks(previousTasks);
      onTasksChange?.(previousTasks);
    } finally {
      setTogglingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  const handleDeleteTask = async () => {
    if (!deletingTask || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteProjectTaskAction({
        taskId: deletingTask.id,
      });

      if (!res.success) {
        setDeleteError(res.error);
        return;
      }

      const updated = tasks.filter((t) => t.id !== deletingTask.id);
      setTasks(updated);
      onTasksChange?.(updated);
      setDeletingTask(null);
    } catch {
      setDeleteError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="stage-tasks-section-heading"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="stage-tasks-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 id="stage-tasks-section-heading" className="text-lg font-semibold text-foreground">
              {t('title')}
            </h2>
            {currentStage && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold capitalize">
                {currentStage.name}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>

        <div className="flex items-center gap-3">
          <span
            data-testid="stage-tasks-counter"
            className="text-xs font-medium text-muted-foreground whitespace-nowrap bg-muted px-2.5 py-1 rounded-md"
          >
            {t('counter', { completed: completedCount, total: totalCount })}
          </span>

          <Button
            type="button"
            onClick={handleOpenAdd}
            data-testid="add-task-btn"
            className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{t('addTask')}</span>
          </Button>
        </div>
      </div>

      {stageTasks.length === 0 ? (
        <p
          className="text-sm text-muted-foreground py-6 text-center"
          data-testid="stage-tasks-empty"
        >
          {t('empty')}
        </p>
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="stage-tasks-list"
        >
          {stageTasks.map((task) => {
            const isToggling = togglingTaskIds.has(task.id);
            const formattedDueDate = task.dueDate
              ? formatDate(task.dueDate, locale, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : null;

            return (
              <li
                key={task.id}
                className={`flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/30 ${
                  task.isCompleted ? 'bg-muted/10' : ''
                }`}
                data-testid={`task-item-${task.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleTask(task);
                    }}
                    disabled={isToggling}
                    data-testid={`task-checkbox-${task.id}`}
                    aria-label={task.isCompleted ? t('completedAria') : t('incompleteAria')}
                    aria-checked={task.isCompleted}
                    role="checkbox"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] cursor-pointer"
                  >
                    {isToggling ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : task.isCompleted ? (
                      <CheckSquare
                        className="h-5 w-5 fill-primary/10 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <Square className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <span
                      data-testid={`task-title-${task.id}`}
                      className={`block text-sm font-medium transition-all ${
                        task.isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'
                      }`}
                    >
                      {task.title}
                    </span>

                    {formattedDueDate && (
                      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground mt-0.5">
                        <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{formattedDueDate}</span>
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDeletingTask(task);
                    setDeleteError(null);
                  }}
                  data-testid={`delete-task-btn-${task.id}`}
                  aria-label={`${t('deleteTask')}: ${task.title}`}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center shrink-0 transition-colors"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Task Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-testid="add-task-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateTask(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('addTask')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="add-task-error"
              >
                {addError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="add-task-title"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('titleLabel')}
                </label>
                <input
                  id="add-task-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                  placeholder={t('titlePlaceholder')}
                  data-testid="add-task-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="add-task-due-date"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('dueDateLabel')}
                </label>
                <input
                  id="add-task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                  }}
                  data-testid="add-task-due-date-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddOpen(false);
                }}
                disabled={isAdding}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isAdding}
                data-testid="add-task-submit-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isAdding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    <span>{t('submitting')}</span>
                  </>
                ) : (
                  <span>{t('submit')}</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Task Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingTask)}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
      >
        <DialogContent data-testid="delete-task-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteTask')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
              data-testid="delete-task-error"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeletingTask(null);
              }}
              disabled={isDeleting}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {tDetail('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDeleteTask();
              }}
              disabled={isDeleting}
              data-testid="delete-task-confirm-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  <span>{tDetail('deleting')}</span>
                </>
              ) : (
                <span>{t('deleteTask')}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

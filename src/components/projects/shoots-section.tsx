'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Plus, Pencil, Trash2, Globe, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatters';
import type { Shoot } from '@/server/db/schema/projects';
import { createShootAction, updateShootAction, deleteShootAction } from '@/server/projects/actions';

export interface ShootsSectionProps {
  projectId: string;
  shoots: Shoot[];
  locale: string;
  onShootsChange?: (shoots: Shoot[]) => void;
}

function calculateDuration(startsAt: Date | string, endsAt: Date | string | null): string | null {
  if (!endsAt) return null;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const diffMinutes = Math.round((end - start) / (1000 * 60));
  if (diffMinutes <= 0) return null;

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (hours === 0) return `${String(minutes)}m`;
  if (minutes === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(minutes)}m`;
}

function toLocalDatetimeInputString(date: Date | string | null): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
}

export function ShootsSection({
  projectId,
  shoots: initialShoots,
  locale,
  onShootsChange,
}: ShootsSectionProps) {
  const t = useTranslations('projects.detail.shoots');
  const tDetail = useTranslations('projects.detail');

  const [shoots, setShoots] = React.useState<Shoot[]>(initialShoots);

  // Add Shoot Modal State
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [addTitle, setAddTitle] = React.useState('');
  const [addStartsAt, setAddStartsAt] = React.useState('');
  const [addEndsAt, setAddEndsAt] = React.useState('');
  const [addTimezone, setAddTimezone] = React.useState('Europe/Berlin');
  const [addNotes, setAddNotes] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Edit Shoot Modal State
  const [editingShoot, setEditingShoot] = React.useState<Shoot | null>(null);
  const [editTitle, setEditTitle] = React.useState('');
  const [editStartsAt, setEditStartsAt] = React.useState('');
  const [editEndsAt, setEditEndsAt] = React.useState('');
  const [editTimezone, setEditTimezone] = React.useState('Europe/Berlin');
  const [editNotes, setEditNotes] = React.useState('');
  const [isEditing, setIsEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete Shoot Modal State
  const [deletingShoot, setDeletingShoot] = React.useState<Shoot | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    setAddTitle('');
    // Default to tomorrow 10:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(18, 0, 0, 0);

    setAddStartsAt(toLocalDatetimeInputString(tomorrow));
    setAddEndsAt(toLocalDatetimeInputString(tomorrowEnd));
    setAddTimezone('Europe/Berlin');
    setAddNotes('');
    setAddError(null);
    setIsAddOpen(true);
  };

  const handleCreateShoot = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAdding) return;

    if (!addStartsAt) {
      setAddError('Start date and time is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await createShootAction({
        projectId,
        title: addTitle.trim() ? addTitle.trim() : 'Shoot',
        startsAt: new Date(addStartsAt).toISOString(),
        endsAt: addEndsAt ? new Date(addEndsAt).toISOString() : null,
        timezone: addTimezone.trim() ? addTimezone.trim() : 'Europe/Berlin',
        notes: addNotes.trim() ? addNotes.trim() : null,
      });

      if (!res.success) {
        setAddError(res.error);
        return;
      }

      const created = res.data.shoot;
      const updated = [...shoots, created].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
      setShoots(updated);
      onShootsChange?.(updated);
      setIsAddOpen(false);
    } catch {
      setAddError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleOpenEdit = (shoot: Shoot) => {
    setEditingShoot(shoot);
    setEditTitle(shoot.title);
    setEditStartsAt(toLocalDatetimeInputString(shoot.startsAt));
    setEditEndsAt(toLocalDatetimeInputString(shoot.endsAt));
    setEditTimezone(shoot.timezone);
    setEditNotes(shoot.notes ?? '');
    setEditError(null);
  };

  const handleUpdateShoot = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editingShoot || isEditing) return;

    setIsEditing(true);
    setEditError(null);

    try {
      const res = await updateShootAction({
        shootId: editingShoot.id,
        title: editTitle.trim() ? editTitle.trim() : 'Shoot',
        startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : undefined,
        endsAt: editEndsAt ? new Date(editEndsAt).toISOString() : null,
        timezone: editTimezone.trim() ? editTimezone.trim() : 'Europe/Berlin',
        notes: editNotes.trim() ? editNotes.trim() : null,
      });

      if (!res.success) {
        setEditError(res.error);
        return;
      }

      const updatedShoot = res.data.shoot;
      const updatedList = shoots
        .map((s) => (s.id === updatedShoot.id ? updatedShoot : s))
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

      setShoots(updatedList);
      onShootsChange?.(updatedList);
      setEditingShoot(null);
    } catch {
      setEditError('An unexpected error occurred');
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteShoot = async () => {
    if (!deletingShoot || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteShootAction({
        shootId: deletingShoot.id,
      });

      if (!res.success) {
        setDeleteError(res.error);
        return;
      }

      const updatedList = shoots.filter((s) => s.id !== deletingShoot.id);
      setShoots(updatedList);
      onShootsChange?.(updatedList);
      setDeletingShoot(null);
    } catch {
      setDeleteError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="shoots-section-heading"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="shoots-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div>
          <h2 id="shoots-section-heading" className="text-lg font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('description')}</p>
        </div>

        <Button
          type="button"
          onClick={handleOpenAdd}
          data-testid="add-shoot-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('addShoot')}</span>
        </Button>
      </div>

      {shoots.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center" data-testid="shoots-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="space-y-3" data-testid="shoots-list">
          {shoots.map((shoot) => {
            const formattedStart = formatDateTime(shoot.startsAt, locale, {
              timeZone: shoot.timezone,
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            const formattedEnd = shoot.endsAt
              ? formatDateTime(shoot.endsAt, locale, {
                  timeZone: shoot.timezone,
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : null;

            const duration = calculateDuration(shoot.startsAt, shoot.endsAt);

            return (
              <div
                key={shoot.id}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xs hover:shadow-xs transition-all space-y-3"
                data-testid={`shoot-card-${shoot.id}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="space-y-1">
                    <h3
                      className="font-semibold text-foreground text-base"
                      data-testid={`shoot-title-${shoot.id}`}
                    >
                      {shoot.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid={`shoot-time-${shoot.id}`}
                      >
                        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {formattedStart}
                          {formattedEnd && ` – ${formattedEnd}`}
                        </span>
                      </span>

                      {duration && (
                        <span className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{t('duration', { duration })}</span>
                        </span>
                      )}

                      <span
                        data-testid={`shoot-timezone-${shoot.id}`}
                        className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-secondary-foreground text-2xs"
                      >
                        <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{shoot.timezone}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        handleOpenEdit(shoot);
                      }}
                      data-testid={`edit-shoot-btn-${shoot.id}`}
                      aria-label={`${t('editShoot')}: ${shoot.title}`}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeletingShoot(shoot);
                        setDeleteError(null);
                      }}
                      data-testid={`delete-shoot-btn-${shoot.id}`}
                      aria-label={`${t('deleteShoot')}: ${shoot.title}`}
                      className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {shoot.notes && (
                  <div
                    className="rounded bg-muted/40 p-2.5 text-xs text-muted-foreground space-y-1"
                    data-testid={`shoot-notes-${shoot.id}`}
                  >
                    <div className="flex items-center gap-1.5 font-medium text-foreground text-2xs uppercase tracking-wider">
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      <span>{t('notesLabel')}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{shoot.notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Shoot Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-testid="add-shoot-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateShoot(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('addShoot')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="add-shoot-error"
              >
                {addError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="add-shoot-title"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('titleLabel')}
                </label>
                <input
                  id="add-shoot-title"
                  type="text"
                  required
                  value={addTitle}
                  onChange={(e) => {
                    setAddTitle(e.target.value);
                  }}
                  placeholder={t('titlePlaceholder')}
                  data-testid="add-shoot-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="add-shoot-starts-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('startsAtLabel')}
                  </label>
                  <input
                    id="add-shoot-starts-at"
                    type="datetime-local"
                    required
                    value={addStartsAt}
                    onChange={(e) => {
                      setAddStartsAt(e.target.value);
                    }}
                    data-testid="add-shoot-starts-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="add-shoot-ends-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('endsAtLabel')}
                  </label>
                  <input
                    id="add-shoot-ends-at"
                    type="datetime-local"
                    value={addEndsAt}
                    onChange={(e) => {
                      setAddEndsAt(e.target.value);
                    }}
                    data-testid="add-shoot-ends-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="add-shoot-timezone"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('timezoneLabel')}
                </label>
                <input
                  id="add-shoot-timezone"
                  type="text"
                  required
                  value={addTimezone}
                  onChange={(e) => {
                    setAddTimezone(e.target.value);
                  }}
                  data-testid="add-shoot-timezone-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="add-shoot-notes"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('notesLabel')}
                </label>
                <textarea
                  id="add-shoot-notes"
                  rows={3}
                  value={addNotes}
                  onChange={(e) => {
                    setAddNotes(e.target.value);
                  }}
                  placeholder={t('notesPlaceholder')}
                  data-testid="add-shoot-notes-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                data-testid="add-shoot-submit-btn"
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

      <Dialog
        open={Boolean(editingShoot)}
        onOpenChange={(open) => {
          if (!open) setEditingShoot(null);
        }}
      >
        <DialogContent data-testid="edit-shoot-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleUpdateShoot(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('editShoot')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {editError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="edit-shoot-error"
              >
                {editError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="edit-shoot-title"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('titleLabel')}
                </label>
                <input
                  id="edit-shoot-title"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                  }}
                  data-testid="edit-shoot-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="edit-shoot-starts-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('startsAtLabel')}
                  </label>
                  <input
                    id="edit-shoot-starts-at"
                    type="datetime-local"
                    required
                    value={editStartsAt}
                    onChange={(e) => {
                      setEditStartsAt(e.target.value);
                    }}
                    data-testid="edit-shoot-starts-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-shoot-ends-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('endsAtLabel')}
                  </label>
                  <input
                    id="edit-shoot-ends-at"
                    type="datetime-local"
                    value={editEndsAt}
                    onChange={(e) => {
                      setEditEndsAt(e.target.value);
                    }}
                    data-testid="edit-shoot-ends-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-shoot-timezone"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('timezoneLabel')}
                </label>
                <input
                  id="edit-shoot-timezone"
                  type="text"
                  required
                  value={editTimezone}
                  onChange={(e) => {
                    setEditTimezone(e.target.value);
                  }}
                  data-testid="edit-shoot-timezone-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-shoot-notes"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('notesLabel')}
                </label>
                <textarea
                  id="edit-shoot-notes"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => {
                    setEditNotes(e.target.value);
                  }}
                  data-testid="edit-shoot-notes-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingShoot(null);
                }}
                disabled={isEditing}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isEditing}
                data-testid="edit-shoot-submit-btn"
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {isEditing ? (
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

      {/* Delete Shoot Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingShoot)}
        onOpenChange={(open) => {
          if (!open) setDeletingShoot(null);
        }}
      >
        <DialogContent data-testid="delete-shoot-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteShoot')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
              data-testid="delete-shoot-error"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeletingShoot(null);
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
                void handleDeleteShoot();
              }}
              disabled={isDeleting}
              data-testid="delete-shoot-confirm-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  <span>{tDetail('deleting')}</span>
                </>
              ) : (
                <span>{t('deleteShoot')}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

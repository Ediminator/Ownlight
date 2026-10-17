'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock, Plus, Pencil, Trash2, MapPin, Loader2 } from 'lucide-react';
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
import type {
  ProjectDetailShootLocation,
  ProjectDetailTimelineItem,
} from '@/server/projects/service';
import {
  createShootTimelineItemAction,
  updateShootTimelineItemAction,
  deleteShootTimelineItemAction,
} from '@/server/projects/actions';

export interface TimelineScheduleSectionProps {
  projectId: string;
  shoots: Shoot[];
  locations: ProjectDetailShootLocation[];
  timelineItems: ProjectDetailTimelineItem[];
  locale: string;
  onTimelineItemsChange?: (items: ProjectDetailTimelineItem[]) => void;
}

function toLocalDatetimeInputString(date: Date | string | null): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = String(d.getFullYear());
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function TimelineScheduleSection({
  shoots,
  locations,
  timelineItems: initialItems,
  locale,
  onTimelineItemsChange,
}: TimelineScheduleSectionProps) {
  const t = useTranslations('projects.detail.timeline');
  const tDetail = useTranslations('projects.detail');

  const [items, setItems] = React.useState<ProjectDetailTimelineItem[]>(initialItems);

  // Add Item State
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [addShootId, setAddShootId] = React.useState(shoots[0]?.id ?? '');
  const [addLocationId, setAddLocationId] = React.useState<string>('');
  const [addTitle, setAddTitle] = React.useState('');
  const [addStartsAt, setAddStartsAt] = React.useState('');
  const [addEndsAt, setAddEndsAt] = React.useState('');
  const [addDescription, setAddDescription] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Edit Item State
  const [editingItem, setEditingItem] = React.useState<ProjectDetailTimelineItem | null>(null);
  const [editLocationId, setEditLocationId] = React.useState<string>('');
  const [editTitle, setEditTitle] = React.useState('');
  const [editStartsAt, setEditStartsAt] = React.useState('');
  const [editEndsAt, setEditEndsAt] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [isEditing, setIsEditing] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete Item State
  const [deletingItem, setDeletingItem] = React.useState<ProjectDetailTimelineItem | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleOpenAdd = () => {
    const shoot = shoots[0];
    setAddShootId(shoot?.id ?? '');
    setAddLocationId('');
    setAddTitle('');

    // Default start time to shoot start time or now
    const baseDate = shoot?.startsAt ? new Date(shoot.startsAt) : new Date();
    setAddStartsAt(toLocalDatetimeInputString(baseDate));
    const endDate = new Date(baseDate);
    endDate.setHours(endDate.getHours() + 1);
    setAddEndsAt(toLocalDatetimeInputString(endDate));
    setAddDescription('');
    setAddError(null);
    setIsAddOpen(true);
  };

  const handleCreateItem = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAdding) return;

    if (!addShootId) {
      setAddError('A shoot session is required');
      return;
    }
    if (!addTitle.trim()) {
      setAddError('Title is required');
      return;
    }
    if (!addStartsAt) {
      setAddError('Start time is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await createShootTimelineItemAction({
        shootId: addShootId,
        locationId: addLocationId ? addLocationId : null,
        title: addTitle.trim(),
        startsAt: new Date(addStartsAt).toISOString(),
        endsAt: addEndsAt ? new Date(addEndsAt).toISOString() : null,
        description: addDescription.trim() ? addDescription.trim() : null,
        order: items.length + 1,
      });

      if (!res.success) {
        setAddError(res.error);
        return;
      }

      const shootObj = shoots.find((s) => s.id === addShootId);
      const locObj = locations.find((l) => l.id === addLocationId);
      const createdItem: ProjectDetailTimelineItem = {
        ...(res.data.item as ProjectDetailTimelineItem),
        shootTitle: shootObj?.title,
        locationName: locObj?.name ?? null,
      };

      const updated = [...items, createdItem].sort((a, b) => {
        const timeDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.order - b.order;
      });

      setItems(updated);
      onTimelineItemsChange?.(updated);
      setIsAddOpen(false);
    } catch {
      setAddError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleOpenEdit = (item: ProjectDetailTimelineItem) => {
    setEditingItem(item);
    setEditLocationId(item.locationId ?? '');
    setEditTitle(item.title);
    setEditStartsAt(toLocalDatetimeInputString(item.startsAt));
    setEditEndsAt(toLocalDatetimeInputString(item.endsAt));
    setEditDescription(item.description ?? '');
    setEditError(null);
  };

  const handleUpdateItem = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editingItem || isEditing) return;

    if (!editTitle.trim()) {
      setEditError('Title is required');
      return;
    }

    setIsEditing(true);
    setEditError(null);

    try {
      const res = await updateShootTimelineItemAction({
        itemId: editingItem.id,
        locationId: editLocationId ? editLocationId : null,
        title: editTitle.trim(),
        startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : undefined,
        endsAt: editEndsAt ? new Date(editEndsAt).toISOString() : null,
        description: editDescription.trim() ? editDescription.trim() : null,
      });

      if (!res.success) {
        setEditError(res.error);
        return;
      }

      const updated = res.data.item as ProjectDetailTimelineItem;
      const locObj = locations.find((l) => l.id === editLocationId);

      const updatedList = items
        .map((i) =>
          i.id === updated.id
            ? {
                ...updated,
                shootTitle: i.shootTitle,
                locationName: locObj?.name ?? null,
              }
            : i,
        )
        .sort((a, b) => {
          const timeDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.order - b.order;
        });

      setItems(updatedList);
      onTimelineItemsChange?.(updatedList);
      setEditingItem(null);
    } catch {
      setEditError('An unexpected error occurred');
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItem || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteShootTimelineItemAction({
        itemId: deletingItem.id,
      });

      if (!res.success) {
        setDeleteError(res.error);
        return;
      }

      const updatedList = items.filter((i) => i.id !== deletingItem.id);
      setItems(updatedList);
      onTimelineItemsChange?.(updatedList);
      setDeletingItem(null);
    } catch {
      setDeleteError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section
      aria-labelledby="timeline-section-heading"
      className="rounded-lg border bg-card p-4 sm:p-6 text-card-foreground shadow-sm space-y-4"
      data-testid="timeline-section"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div>
          <h2 id="timeline-section-heading" className="text-lg font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('description')}</p>
        </div>

        <Button
          type="button"
          onClick={handleOpenAdd}
          disabled={shoots.length === 0}
          data-testid="add-timeline-item-btn"
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('addItem')}</span>
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center" data-testid="timeline-empty">
          {t('empty')}
        </p>
      ) : (
        <div
          className="relative pl-6 space-y-6 before:absolute before:bottom-2 before:top-2 before:left-[11px] before:w-0.5 before:bg-border"
          data-testid="timeline-list"
        >
          {items.map((item) => {
            const shootObj = shoots.find((s) => s.id === item.shootId);
            const tz = shootObj?.timezone ?? 'Europe/Berlin';

            const startTime = formatDateTime(item.startsAt, locale, {
              timeZone: tz,
              hour: '2-digit',
              minute: '2-digit',
            });

            const endTime = item.endsAt
              ? formatDateTime(item.endsAt, locale, {
                  timeZone: tz,
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : null;

            return (
              <div
                key={item.id}
                className="relative flex items-start gap-3 group"
                data-testid={`timeline-item-${item.id}`}
              >
                {/* Timeline node marker */}
                <div className="absolute -left-6 mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-background border-2 border-primary text-primary">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                </div>

                <div className="flex-1 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xs group-hover:shadow-xs transition-all space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-mono text-xs font-semibold text-primary inline-flex items-center"
                          data-testid={`timeline-time-${item.id}`}
                        >
                          {startTime}
                          {endTime && ` – ${endTime}`}
                        </span>

                        {item.locationName && (
                          <span
                            data-testid={`timeline-location-${item.id}`}
                            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-2xs font-medium text-secondary-foreground"
                          >
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>{item.locationName}</span>
                          </span>
                        )}

                        {item.shootTitle && shoots.length > 1 && (
                          <span className="inline-flex items-center rounded border border-border px-1.5 py-0.2 text-2xs text-muted-foreground">
                            {item.shootTitle}
                          </span>
                        )}
                      </div>

                      <h3
                        className="font-semibold text-foreground text-sm sm:text-base"
                        data-testid={`timeline-title-${item.id}`}
                      >
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 self-end sm:self-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          handleOpenEdit(item);
                        }}
                        data-testid={`edit-timeline-item-btn-${item.id}`}
                        aria-label={`${t('editItem')}: ${item.title}`}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeletingItem(item);
                          setDeleteError(null);
                        }}
                        data-testid={`delete-timeline-item-btn-${item.id}`}
                        aria-label={`${t('deleteItem')}: ${item.title}`}
                        className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {item.description && (
                    <p
                      className="text-xs text-muted-foreground whitespace-pre-wrap pt-1"
                      data-testid={`timeline-description-${item.id}`}
                    >
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Timeline Item Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent data-testid="add-timeline-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleCreateItem(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('addItem')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="add-timeline-error"
              >
                {addError}
              </div>
            )}

            <div className="space-y-3">
              {shoots.length > 1 && (
                <div>
                  <label
                    htmlFor="add-timeline-shoot"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('shootLabel')}
                  </label>
                  <select
                    id="add-timeline-shoot"
                    value={addShootId}
                    onChange={(e) => {
                      setAddShootId(e.target.value);
                    }}
                    data-testid="add-timeline-shoot-select"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  >
                    {shoots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  htmlFor="add-timeline-title"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('titleLabel')}
                </label>
                <input
                  id="add-timeline-title"
                  type="text"
                  required
                  value={addTitle}
                  onChange={(e) => {
                    setAddTitle(e.target.value);
                  }}
                  placeholder={t('titlePlaceholder')}
                  data-testid="add-timeline-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="add-timeline-location"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('locationLabel')}
                </label>
                <select
                  id="add-timeline-location"
                  value={addLocationId}
                  onChange={(e) => {
                    setAddLocationId(e.target.value);
                  }}
                  data-testid="add-timeline-location-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                >
                  <option value="">{t('noLocation')}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="add-timeline-starts-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('startsAtLabel')}
                  </label>
                  <input
                    id="add-timeline-starts-at"
                    type="datetime-local"
                    required
                    value={addStartsAt}
                    onChange={(e) => {
                      setAddStartsAt(e.target.value);
                    }}
                    data-testid="add-timeline-starts-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="add-timeline-ends-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('endsAtLabel')}
                  </label>
                  <input
                    id="add-timeline-ends-at"
                    type="datetime-local"
                    value={addEndsAt}
                    onChange={(e) => {
                      setAddEndsAt(e.target.value);
                    }}
                    data-testid="add-timeline-ends-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="add-timeline-description"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('descriptionLabel')}
                </label>
                <textarea
                  id="add-timeline-description"
                  rows={3}
                  value={addDescription}
                  onChange={(e) => {
                    setAddDescription(e.target.value);
                  }}
                  placeholder={t('descriptionPlaceholder')}
                  data-testid="add-timeline-description-input"
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
                data-testid="add-timeline-submit-btn"
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

      {/* Edit Timeline Item Dialog */}
      <Dialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
      >
        <DialogContent data-testid="edit-timeline-dialog" className="max-w-md">
          <form
            onSubmit={(e) => {
              void handleUpdateItem(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('editItem')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {editError && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
                data-testid="edit-timeline-error"
              >
                {editError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="edit-timeline-title"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('titleLabel')}
                </label>
                <input
                  id="edit-timeline-title"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                  }}
                  data-testid="edit-timeline-title-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-timeline-location"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('locationLabel')}
                </label>
                <select
                  id="edit-timeline-location"
                  value={editLocationId}
                  onChange={(e) => {
                    setEditLocationId(e.target.value);
                  }}
                  data-testid="edit-timeline-location-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                >
                  <option value="">{t('noLocation')}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="edit-timeline-starts-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('startsAtLabel')}
                  </label>
                  <input
                    id="edit-timeline-starts-at"
                    type="datetime-local"
                    required
                    value={editStartsAt}
                    onChange={(e) => {
                      setEditStartsAt(e.target.value);
                    }}
                    data-testid="edit-timeline-starts-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-timeline-ends-at"
                    className="block text-xs font-medium text-foreground mb-1"
                  >
                    {t('endsAtLabel')}
                  </label>
                  <input
                    id="edit-timeline-ends-at"
                    type="datetime-local"
                    value={editEndsAt}
                    onChange={(e) => {
                      setEditEndsAt(e.target.value);
                    }}
                    data-testid="edit-timeline-ends-at-input"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-timeline-description"
                  className="block text-xs font-medium text-foreground mb-1"
                >
                  {t('descriptionLabel')}
                </label>
                <textarea
                  id="edit-timeline-description"
                  rows={3}
                  value={editDescription}
                  onChange={(e) => {
                    setEditDescription(e.target.value);
                  }}
                  data-testid="edit-timeline-description-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingItem(null);
                }}
                disabled={isEditing}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {tDetail('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isEditing}
                data-testid="edit-timeline-submit-btn"
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

      {/* Delete Timeline Item Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingItem)}
        onOpenChange={(open) => {
          if (!open) setDeletingItem(null);
        }}
      >
        <DialogContent data-testid="delete-timeline-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteItem')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-xs text-destructive"
              data-testid="delete-timeline-error"
            >
              {deleteError}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeletingItem(null);
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
                void handleDeleteItem();
              }}
              disabled={isDeleting}
              data-testid="delete-timeline-confirm-btn"
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  <span>{tDetail('deleting')}</span>
                </>
              ) : (
                <span>{t('deleteItem')}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

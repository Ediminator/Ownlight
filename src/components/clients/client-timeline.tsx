'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Clock,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Plus,
  UserPlus,
  UserCheck,
  UserMinus,
  FileText,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import type { ResolvedTimelineItem } from '@/server/timeline/repo';
import { formatDateTime } from '@/lib/formatters';
import { addNoteAction, deleteNoteAction, listTimelineAction } from '@/server/timeline/actions';
import { getClientErrorMessage } from '@/lib/client-errors';
import { EditNoteDialog } from './edit-note-dialog';
import { ConfirmDialog } from './confirm-dialog';

export interface ClientTimelineProps {
  clientId: string;
  locale: string;
  studioTimezone: string;
  initialItems?: ResolvedTimelineItem[];
  initialNextCursor?: string | null;
}

export function ClientTimeline({
  clientId,
  locale,
  studioTimezone,
  initialItems = [],
  initialNextCursor = null,
}: ClientTimelineProps) {
  const t = useTranslations('clients.timeline');
  const tErrors = useTranslations('clients.errors');

  // Timeline events & pagination state
  const [items, setItems] = React.useState<ResolvedTimelineItem[]>(initialItems);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [paginationError, setPaginationError] = React.useState<string | null>(null);

  // Focus restoration on Load More (AC-14)
  const [focusTargetIndex, setFocusTargetIndex] = React.useState<number | null>(null);
  const itemRefs = React.useRef<Map<number, HTMLLIElement>>(new Map());

  // Note composer state
  const [noteText, setNoteText] = React.useState('');
  const [isSubmittingNote, setIsSubmittingNote] = React.useState(false);
  const [composerError, setComposerError] = React.useState<string | null>(null);

  // Edit note dialog state
  const [editingNote, setEditingNote] = React.useState<{
    id: string;
    noteId: string;
    body: string;
  } | null>(null);
  const editTriggerRef = React.useRef<HTMLElement | null>(null);

  // Delete note dialog state
  const [deletingNote, setDeletingNote] = React.useState<{
    id: string;
    noteId: string;
    body: string;
  } | null>(null);
  const [isDeletingNote, setIsDeletingNote] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const deleteTriggerRef = React.useRef<HTMLElement | null>(null);

  // Focus management after Load More (AC-14)
  React.useEffect(() => {
    if (focusTargetIndex !== null) {
      const el = itemRefs.current.get(focusTargetIndex);
      if (el) {
        el.focus();
        setFocusTargetIndex(null);
      }
    }
  }, [items, focusTargetIndex]);

  // Handle adding a new note
  const handleAddNote = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isSubmittingNote) return;

    const trimmed = noteText.trim();
    if (trimmed.length === 0 || noteText.length > 5000) {
      setComposerError(tErrors('VALIDATION_FAILED'));
      return;
    }

    setIsSubmittingNote(true);
    setComposerError(null);

    try {
      const res = await addNoteAction({ clientId, body: noteText });
      if (!res.success) {
        setComposerError(getClientErrorMessage(res.code, tErrors));
        return;
      }

      // Refresh timeline from top
      const listRes = await listTimelineAction({ clientId });
      if (listRes.success) {
        setItems(listRes.data.items);
        setNextCursor(listRes.data.nextCursor);
      }
      setNoteText('');
    } catch {
      setComposerError(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // Handle keyset pagination "Load more"
  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setPaginationError(null);

    try {
      const prevCount = items.length;
      const res = await listTimelineAction({ clientId, cursor: nextCursor });
      if (!res.success) {
        setPaginationError(getClientErrorMessage(res.code, tErrors));
        return;
      }

      setItems((prev) => [...prev, ...res.data.items]);
      setNextCursor(res.data.nextCursor);
      setFocusTargetIndex(prevCount);
    } catch {
      setPaginationError(tErrors('GENERIC_ERROR'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Handle successful edit
  const handleNoteEditSuccess = (updatedBody: string) => {
    if (!editingNote) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === editingNote.id ? { ...it, noteBody: updatedBody, edited: true } : it,
      ),
    );
    setEditingNote(null);
  };

  // Handle confirmed delete
  const handleConfirmDelete = async () => {
    if (!deletingNote || isDeletingNote) return;
    setIsDeletingNote(true);
    setDeleteError(null);

    try {
      const res = await deleteNoteAction({
        clientId,
        noteId: deletingNote.noteId,
      });

      if (!res.success) {
        setDeleteError(getClientErrorMessage(res.code, tErrors));
        return;
      }

      setItems((prev) => prev.filter((it) => it.id !== deletingNote.id));
      setDeletingNote(null);
    } catch {
      setDeleteError(tErrors('GENERIC_ERROR'));
    } finally {
      setIsDeletingNote(false);
    }
  };

  return (
    <section
      aria-labelledby="timeline-heading"
      className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-6 max-w-full overflow-x-hidden"
      data-testid="client-timeline-section"
    >
      {/* Section Header */}
      <div className="flex items-center gap-2 border-b pb-3">
        <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2
          id="timeline-heading"
          className="text-lg font-semibold text-foreground"
          data-testid="timeline-heading"
        >
          {t('title')}
        </h2>
      </div>

      {/* Note Composer (AC-12, AC-13) */}
      <form
        onSubmit={(e) => {
          void handleAddNote(e);
        }}
        className="space-y-3"
        data-testid="timeline-note-composer-form"
      >
        {composerError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 p-3 text-red-900 dark:text-red-200 text-sm font-medium flex items-center gap-2"
            data-testid="timeline-composer-error"
          >
            <AlertCircle
              className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
              aria-hidden="true"
            />
            <span>{composerError}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="timeline-note-composer"
            className="text-sm font-medium text-foreground block"
          >
            {t('composer.label')}
          </label>
          <textarea
            id="timeline-note-composer"
            aria-describedby="timeline-note-counter timeline-note-hint"
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
            }}
            placeholder={t('composer.placeholder')}
            maxLength={5000}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[80px]"
            data-testid="timeline-note-textarea"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            id="timeline-note-counter"
            className="text-xs text-muted-foreground"
            aria-live="polite"
            data-testid="timeline-note-counter"
          >
            {t('composer.counter', { count: noteText.length, max: '5,000' })}
          </span>

          <button
            type="submit"
            disabled={isSubmittingNote || noteText.trim().length === 0}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[36px] min-w-[24px]"
            data-testid="timeline-note-submit-btn"
          >
            {isSubmittingNote ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />
                <span>{t('composer.submitting')}</span>
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                <span>{t('composer.submit')}</span>
              </>
            )}
          </button>
        </div>

        {/* Visible hint under composer (AC-12, AC-13) */}
        <p
          id="timeline-note-hint"
          className="text-xs text-muted-foreground leading-relaxed"
          data-testid="timeline-composer-hint"
        >
          {t('composer.hint')}
        </p>
      </form>

      {/* Ordered List of Events Newest First (AC-13) */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4" data-testid="timeline-empty-message">
          {t('empty')}
        </p>
      ) : (
        <ol
          aria-labelledby="timeline-heading"
          className="space-y-4 divide-y divide-border"
          data-testid="timeline-events-list"
        >
          {items.map((event, idx) => {
            const isNote = event.type === 'note.created';
            const notePreview = event.noteBody
              ? event.noteBody.slice(0, 30).replace(/\n/g, ' ')
              : '';
            const subjectId = event.subjectId;

            return (
              <li
                key={event.id}
                ref={(node) => {
                  if (node) {
                    itemRefs.current.set(idx, node);
                  } else {
                    itemRefs.current.delete(idx);
                  }
                }}
                tabIndex={-1}
                className="pt-4 first:pt-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                data-testid={`timeline-event-${event.id}`}
                data-event-type={event.type}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 text-sm">
                  {/* Event Type & Icon */}
                  <div className="flex items-start gap-2 flex-1">
                    <span className="mt-0.5 text-muted-foreground shrink-0" aria-hidden="true">
                      {event.type === 'client.created' && (
                        <UserPlus className="h-4 w-4 text-primary" />
                      )}
                      {event.type === 'client.contact.added' && (
                        <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      )}
                      {event.type === 'client.contact.removed' && (
                        <UserMinus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      )}
                      {event.type === 'consent.granted' && (
                        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      )}
                      {event.type === 'consent.withdrawn' && (
                        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      )}
                      {isNote && <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                    </span>

                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                        {event.type === 'client.created' && (
                          <span>{t('events.client_created')}</span>
                        )}
                        {event.type === 'client.contact.added' && (
                          <span>
                            {event.contactName
                              ? t('events.client_contact_added', { name: event.contactName })
                              : t('events.client_contact_added_deleted')}
                          </span>
                        )}
                        {event.type === 'client.contact.removed' && (
                          <span>{t('events.client_contact_removed')}</span>
                        )}
                        {event.type === 'consent.granted' && (
                          <span>
                            {event.contactName
                              ? `${event.contactName}: ${t('events.consent_granted', {
                                  purpose:
                                    typeof event.data.purpose === 'string'
                                      ? event.data.purpose
                                      : '',
                                })}`
                              : t('events.consent_granted', {
                                  purpose:
                                    typeof event.data.purpose === 'string'
                                      ? event.data.purpose
                                      : '',
                                })}
                          </span>
                        )}
                        {event.type === 'consent.withdrawn' && (
                          <span>
                            {event.contactName
                              ? `${event.contactName}: ${t('events.consent_withdrawn', {
                                  purpose:
                                    typeof event.data.purpose === 'string'
                                      ? event.data.purpose
                                      : '',
                                })}`
                              : t('events.consent_withdrawn', {
                                  purpose:
                                    typeof event.data.purpose === 'string'
                                      ? event.data.purpose
                                      : '',
                                })}
                          </span>
                        )}
                        {isNote && (
                          <>
                            <span>{t('events.note_created')}</span>
                            {event.edited && (
                              <span
                                className="text-xs text-muted-foreground font-normal italic ml-1"
                                data-testid={`note-edited-marker-${event.id}`}
                              >
                                {t('note.edited')}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      {/* Plain Text Note Body Preserving Line Breaks (AC-5, AC-6, AC-9) */}
                      {isNote && event.noteBody && (
                        <p
                          className="text-foreground whitespace-pre-wrap break-words text-sm pt-1 leading-relaxed"
                          data-testid={`note-body-${event.id}`}
                        >
                          {event.noteBody}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Date & Note Action Buttons */}
                  <div className="flex items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground shrink-0 mt-1 sm:mt-0">
                    <time dateTime={new Date(event.occurredAt).toISOString()}>
                      {formatDateTime(event.occurredAt, locale, { timeZone: studioTimezone })}
                    </time>

                    {isNote && subjectId && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            editTriggerRef.current = e.currentTarget;
                            setEditingNote({
                              id: event.id,
                              noteId: subjectId,
                              body: event.noteBody ?? '',
                            });
                          }}
                          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          aria-label={`${t('note.edit')}: ${notePreview}`}
                          data-testid={`edit-note-btn-${event.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            deleteTriggerRef.current = e.currentTarget;
                            setDeletingNote({
                              id: event.id,
                              noteId: subjectId,
                              body: event.noteBody ?? '',
                            });
                            setDeleteError(null);
                          }}
                          className="rounded p-1 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[32px] min-w-[32px] flex items-center justify-center"
                          aria-label={`${t('note.delete')}: ${notePreview}`}
                          data-testid={`delete-note-btn-${event.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Pagination: Load More Button (AC-7, AC-14) */}
      {nextCursor && (
        <div className="pt-2 text-center">
          {paginationError && <p className="text-xs text-destructive mb-2">{paginationError}</p>}
          <button
            type="button"
            onClick={() => {
              void handleLoadMore();
            }}
            disabled={isLoadingMore}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] w-full sm:w-auto"
            data-testid="timeline-load-more-btn"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                <span>{t('pagination.loading')}</span>
              </>
            ) : (
              <span>{t('pagination.loadMore')}</span>
            )}
          </button>
        </div>
      )}

      {/* Edit Note Modal */}
      {editingNote && (
        <EditNoteDialog
          clientId={clientId}
          noteId={editingNote.noteId}
          initialBody={editingNote.body}
          isOpen={Boolean(editingNote)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingNote(null);
            }
          }}
          triggerRef={editTriggerRef}
          onSuccess={handleNoteEditSuccess}
        />
      )}

      {/* Delete Note Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deletingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingNote(null);
            setDeleteError(null);
          }
        }}
        title={t('note.deleteTitle')}
        description={t('note.deleteConfirm')}
        confirmLabel={t('note.delete')}
        errorMessage={deleteError}
        isSubmitting={isDeletingNote}
        triggerRef={deleteTriggerRef}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />
    </section>
  );
}

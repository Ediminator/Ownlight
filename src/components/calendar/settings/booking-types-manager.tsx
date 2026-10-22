'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { BookingType, BookingLocationType } from '@/server/db/schema/calendar';
import { COLOR_OPTIONS, getColorDotClass, type ColorOption } from './availability-helpers';
import {
  validateBookingTypeFormState,
  submitBookingTypeCreate,
  submitBookingTypeUpdate,
  submitBookingTypeDelete,
  copyPublicBookingLink,
  getBookingLocationBadgeInfo,
  createInitialBookingTypesState,
  bookingTypesReducer,
  type BookingTypeFormState,
} from './availability-view-model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Copy,
  Check,
  Edit2,
  Trash2,
  Video,
  Phone,
  MapPin,
  Clock,
  Calendar,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function BookingLocationIcon({ locationType }: { locationType: BookingLocationType }) {
  const info = getBookingLocationBadgeInfo(locationType);
  if (info.iconType === 'phone') {
    return <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
  }
  if (info.iconType === 'map-pin') {
    return <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
  }
  return <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
}

interface BookingTypesManagerProps {
  initialBookingTypes: BookingType[];
  locale?: string;
  defaultDialogOpen?: boolean;
  defaultEditingItem?: BookingType | null;
  defaultDeleteTarget?: BookingType | null;
  initialNotification?: {
    type: 'success' | 'error';
    message: string;
  } | null;
  initialFormError?: string | null;
  initialFormValues?: Partial<BookingTypeFormState>;
  initialCopiedSlug?: string | null;
}

export function BookingTypesManager({
  initialBookingTypes,
  defaultDialogOpen = false,
  defaultEditingItem = null,
  defaultDeleteTarget = null,
  initialNotification = null,
  initialFormError = null,
  initialFormValues,
  initialCopiedSlug = null,
}: BookingTypesManagerProps) {
  const t = useTranslations('settings.availability.bookingTypes');

  const [state, dispatch] = React.useReducer(bookingTypesReducer, undefined, () =>
    createInitialBookingTypesState(
      initialBookingTypes,
      defaultDialogOpen,
      defaultEditingItem,
      defaultDeleteTarget,
      initialNotification,
      initialFormError,
      initialFormValues,
      initialCopiedSlug,
    ),
  );

  const {
    bookingTypes,
    isDialogOpen,
    editingItem,
    deleteTarget,
    formValues,
    formError,
    isSubmitting,
    copiedSlug,
    notification,
  } = state;

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    const isNumber = type === 'number';
    const parsedValue = isCheckbox
      ? (e.target as HTMLInputElement).checked
      : isNumber
        ? Number(value)
        : value;

    dispatch({
      type: 'UPDATE_FORM_FIELD',
      name,
      value: parsedValue,
    });
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      dispatch({ type: 'CLOSE_DIALOG' });
    }
  };

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (!open) {
      dispatch({ type: 'CLOSE_DELETE' });
    }
  };

  const handleAction = (e: React.SyntheticEvent) => {
    const target = e.currentTarget as HTMLElement;
    const action = target.dataset.action;

    if (action === 'open-new') {
      dispatch({ type: 'OPEN_NEW' });
      return;
    }

    if (action === 'close-dialog') {
      dispatch({ type: 'CLOSE_DIALOG' });
      return;
    }

    if (action === 'open-edit') {
      const slug = target.dataset.slug;
      const item = bookingTypes.find((b) => b.slug === slug);
      if (item) {
        dispatch({ type: 'OPEN_EDIT', item });
      }
      return;
    }

    if (action === 'open-delete') {
      const slug = target.dataset.slug;
      const item = bookingTypes.find((b) => b.slug === slug);
      if (item) {
        dispatch({ type: 'OPEN_DELETE', item });
      }
      return;
    }

    if (action === 'close-delete') {
      dispatch({ type: 'CLOSE_DELETE' });
      return;
    }

    if (action === 'dismiss') {
      dispatch({ type: 'SET_NOTIFICATION', notification: null });
      return;
    }

    if (action === 'color') {
      const colorVal = target.dataset.color as ColorOption | undefined;
      if (colorVal) {
        dispatch({ type: 'SET_COLOR', color: colorVal });
      }
      return;
    }

    if (action === 'copy') {
      const slug = target.dataset.slug;
      if (slug) {
        void (async () => {
          await copyPublicBookingLink(slug);
          dispatch({ type: 'SET_COPIED_SLUG', slug });
          setTimeout(() => {
            dispatch({ type: 'SET_COPIED_SLUG', slug: null });
          }, 2500);
        })();
      }
      return;
    }

    if (action === 'confirm-delete') {
      if (!deleteTarget) return;
      dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
      void (async () => {
        try {
          const res = await submitBookingTypeDelete(deleteTarget.id);
          if (res.success) {
            dispatch({
              type: 'DELETE_SUCCESS',
              id: deleteTarget.id,
              message: t('successDeleted'),
            });
          } else {
            dispatch({
              type: 'SET_NOTIFICATION',
              notification: { type: 'error', message: res.error ?? t('errorDeleteFailed') },
            });
          }
        } catch {
          dispatch({
            type: 'SET_NOTIFICATION',
            notification: { type: 'error', message: t('errorDeleteFailed') },
          });
        } finally {
          dispatch({ type: 'SET_SUBMITTING', isSubmitting: false });
        }
      })();
      return;
    }

    // Default action is form submit
    e.preventDefault();
    dispatch({ type: 'SET_FORM_ERROR', error: null });

    const validation = validateBookingTypeFormState(formValues, {
      titleRequired: t('errorTitleRequired'),
      slugRequired: t('errorSlugRequired'),
      slugInvalid: t('errorInvalidSlug'),
      durationMin: t('errorDurationMin'),
      noticeMin: t('errorNoticeMin'),
      horizonMin: t('errorHorizonMin'),
    });

    if (validation) {
      dispatch({ type: 'SET_FORM_ERROR', error: validation });
      return;
    }

    dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
    void (async () => {
      try {
        if (editingItem) {
          const res = await submitBookingTypeUpdate(editingItem.id, formValues);
          if (res.success && res.data) {
            dispatch({
              type: 'SAVE_SUCCESS',
              item: res.data,
              isEdit: true,
              message: t('successUpdated'),
            });
          } else {
            dispatch({
              type: 'SET_FORM_ERROR',
              error: res.error ?? t('errorSaveFailed'),
            });
          }
        } else {
          const res = await submitBookingTypeCreate(formValues);
          if (res.success && res.data) {
            dispatch({
              type: 'SAVE_SUCCESS',
              item: res.data,
              isEdit: false,
              message: t('successCreated'),
            });
          } else {
            dispatch({
              type: 'SET_FORM_ERROR',
              error: res.error ?? t('errorSaveFailed'),
            });
          }
        }
      } catch {
        dispatch({ type: 'SET_FORM_ERROR', error: t('errorSaveFailed') });
      } finally {
        dispatch({ type: 'SET_SUBMITTING', isSubmitting: false });
      }
    })();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          type="button"
          data-testid="new-booking-type-btn"
          data-action="open-new"
          onClick={handleAction}
          className="flex items-center gap-2 self-start sm:self-auto min-h-[38px]"
        >
          <Plus className="h-4 w-4" />
          <span>{t('newBookingType')}</span>
        </Button>
      </div>

      {notification && (
        <div
          role="status"
          aria-live="polite"
          data-testid="availability-notification"
          className={cn(
            'rounded-md p-4 flex items-center justify-between text-sm transition-all',
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-destructive/10 text-destructive border border-destructive/20',
          )}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            data-action="dismiss"
            onClick={handleAction}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={t('dismissNotification')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Booking Types List */}
      {bookingTypes.length === 0 ? (
        <div
          data-testid="booking-types-empty"
          className="rounded-lg border border-dashed p-8 text-center bg-card/50"
        >
          <Calendar className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{t('emptyDesc')}</p>
        </div>
      ) : (
        <div
          data-testid="booking-types-list"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {bookingTypes.map((bt) => {
            const isCopied = copiedSlug === bt.slug;
            const locationInfo = getBookingLocationBadgeInfo(bt.locationType);

            return (
              <div
                key={bt.id}
                data-testid={`booking-type-card-${bt.slug}`}
                className={cn(
                  'rounded-lg border bg-card p-5 shadow-xs flex flex-col justify-between transition-all relative overflow-hidden',
                  !bt.isActive && 'opacity-70 bg-muted/20 border-dashed',
                )}
              >
                {/* Color Stripe / Dot */}
                <div
                  className={cn('absolute top-0 left-0 right-0 h-1.5', getColorDotClass(bt.color))}
                  aria-hidden="true"
                />

                <div className="space-y-3 pt-1">
                  {/* Header: Title and Active Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-base text-foreground leading-tight">
                        {bt.title}
                      </h3>
                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                        /book/{bt.slug}
                      </p>
                    </div>
                    {bt.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-2xs font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                        {t('badgeActive')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-2xs font-semibold uppercase tracking-wider bg-muted text-muted-foreground border shrink-0">
                        {t('badgeInactive')}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  {bt.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{bt.description}</p>
                  )}

                  {/* Metadata Chips */}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pt-1">
                    <span className="inline-flex items-center gap-1.5 bg-muted/40 px-2 py-1 rounded">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('minutesLabel', { minutes: bt.durationMinutes })}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-muted/40 px-2 py-1 rounded">
                      <BookingLocationIcon locationType={bt.locationType} />
                      <span>{t(locationInfo.labelKey)}</span>
                    </span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-4 mt-4 border-t gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`copy-booking-type-link-${bt.slug}`}
                    data-action="copy"
                    data-slug={bt.slug}
                    onClick={handleAction}
                    className="flex items-center gap-1.5 text-xs h-8"
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600 font-medium">{t('copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>{t('copyLink')}</span>
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-testid={`edit-booking-type-${bt.slug}`}
                      data-action="open-edit"
                      data-slug={bt.slug}
                      onClick={handleAction}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={`${t('editAria')} ${bt.title}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-testid={`delete-booking-type-${bt.slug}`}
                      data-action="open-delete"
                      data-slug={bt.slug}
                      onClick={handleAction}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      aria-label={`${t('deleteAria')} ${bt.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Booking Type Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          data-testid="booking-type-dialog"
          className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto"
          aria-describedby="booking-type-dialog-desc"
        >
          <form onSubmit={handleAction} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{editingItem ? t('dialogEditTitle') : t('dialogNewTitle')}</DialogTitle>
              <DialogDescription id="booking-type-dialog-desc">
                {editingItem ? t('dialogEditDesc') : t('dialogNewDesc')}
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <div
                role="alert"
                data-testid="booking-type-form-error"
                className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-xs font-medium text-destructive flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4 py-1">
              {/* Title & Slug */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-title-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldTitle')}
                  </label>
                  <input
                    type="text"
                    id="booking-type-title-input"
                    name="title"
                    data-testid="booking-type-title-input"
                    required
                    placeholder={t('titlePlaceholder')}
                    value={formValues.title}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="booking-type-slug-input"
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {t('fieldSlug')}
                    </label>
                    {!formValues.slugManuallyEdited && (
                      <span className="text-2xs text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span>{t('autoSlug')}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex rounded-md border border-input shadow-xs overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                    <span className="bg-muted px-3 py-2 text-xs text-muted-foreground select-none border-r font-mono flex items-center">
                      /book/
                    </span>
                    <input
                      type="text"
                      id="booking-type-slug-input"
                      name="slug"
                      data-testid="booking-type-slug-input"
                      required
                      value={formValues.slug}
                      onChange={handleInputChange}
                      placeholder="consultation"
                      className="flex-1 bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label
                  htmlFor="booking-type-description-input"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t('fieldDescription')}
                </label>
                <textarea
                  id="booking-type-description-input"
                  name="description"
                  data-testid="booking-type-description-input"
                  rows={2}
                  placeholder={t('descriptionPlaceholder')}
                  value={formValues.description}
                  onChange={handleInputChange}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>

              {/* Timing Grid: Duration, Buffers */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-duration-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldDuration')}
                  </label>
                  <input
                    type="number"
                    id="booking-type-duration-input"
                    name="durationMinutes"
                    data-testid="booking-type-duration-input"
                    min={5}
                    max={480}
                    step={5}
                    value={formValues.durationMinutes}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-buffer-before-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldBufferBefore')}
                  </label>
                  <input
                    type="number"
                    id="booking-type-buffer-before-input"
                    name="bufferBeforeMinutes"
                    data-testid="booking-type-buffer-before-input"
                    min={0}
                    max={240}
                    step={5}
                    value={formValues.bufferBeforeMinutes}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-buffer-after-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldBufferAfter')}
                  </label>
                  <input
                    type="number"
                    id="booking-type-buffer-after-input"
                    name="bufferAfterMinutes"
                    data-testid="booking-type-buffer-after-input"
                    min={0}
                    max={240}
                    step={5}
                    value={formValues.bufferAfterMinutes}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Notice & Horizon */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-notice-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldMinNotice')}
                  </label>
                  <input
                    type="number"
                    id="booking-type-notice-input"
                    name="minNoticeHours"
                    data-testid="booking-type-notice-input"
                    min={0}
                    max={720}
                    value={formValues.minNoticeHours}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-horizon-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldMaxFuture')}
                  </label>
                  <input
                    type="number"
                    id="booking-type-horizon-input"
                    name="maxFutureDays"
                    data-testid="booking-type-horizon-input"
                    min={1}
                    max={365}
                    value={formValues.maxFutureDays}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Location Type & Details */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-location-type-select"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldLocationType')}
                  </label>
                  <select
                    id="booking-type-location-type-select"
                    name="locationType"
                    data-testid="booking-type-location-type-select"
                    value={formValues.locationType}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="google_meet">{t('locationGoogleMeet')}</option>
                    <option value="phone">{t('locationPhone')}</option>
                    <option value="in_person">{t('locationInPerson')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-location-details-input"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t('fieldLocationDetails')}
                  </label>
                  <input
                    type="text"
                    id="booking-type-location-details-input"
                    name="locationDetails"
                    data-testid="booking-type-location-details-input"
                    placeholder={
                      formValues.locationType === 'phone'
                        ? t('detailsPlaceholderPhone')
                        : formValues.locationType === 'in_person'
                          ? t('detailsPlaceholderInPerson')
                          : t('detailsPlaceholderMeet')
                    }
                    value={formValues.locationDetails}
                    onChange={handleInputChange}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Color Selector */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  {t('fieldColor')}
                </span>
                <div
                  className="flex items-center gap-2 flex-wrap"
                  role="radiogroup"
                  aria-label={t('fieldColor')}
                >
                  {COLOR_OPTIONS.map((colorKey) => {
                    const isSelected = formValues.color === colorKey;
                    return (
                      <button
                        key={colorKey}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        data-testid={`booking-type-color-${colorKey}`}
                        data-action="color"
                        data-color={colorKey}
                        onClick={handleAction}
                        className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center transition-all border',
                          getColorDotClass(colorKey),
                          isSelected
                            ? 'ring-2 ring-primary ring-offset-2 scale-110'
                            : 'opacity-70 hover:opacity-100',
                        )}
                        aria-label={colorKey}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-white drop-shadow-xs" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="booking-type-active-toggle"
                  name="isActive"
                  data-testid="booking-type-active-toggle"
                  checked={formValues.isActive}
                  onChange={handleInputChange}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary focus:ring-offset-background"
                />
                <label
                  htmlFor="booking-type-active-toggle"
                  className="text-sm font-medium select-none cursor-pointer"
                >
                  {t('fieldIsActive')}
                </label>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                data-action="close-dialog"
                onClick={handleAction}
                data-testid="booking-type-cancel-btn"
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="booking-type-submit-btn">
                {isSubmitting
                  ? t('saving')
                  : editingItem
                    ? t('saveChanges')
                    : t('createBookingType')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={handleDeleteDialogOpenChange}>
        <DialogContent
          data-testid="delete-booking-type-dialog"
          className="sm:max-w-[420px]"
          aria-describedby="delete-booking-type-desc"
        >
          <DialogHeader>
            <DialogTitle>{t('dialogDeleteTitle')}</DialogTitle>
            <DialogDescription id="delete-booking-type-desc">
              {t('dialogDeleteDesc', { title: deleteTarget?.title ?? '' })}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              data-action="close-delete"
              onClick={handleAction}
              data-testid="cancel-delete-booking-type-btn"
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting}
              data-action="confirm-delete"
              onClick={handleAction}
              data-testid="confirm-delete-booking-type-btn"
            >
              {isSubmitting ? t('deleting') : t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

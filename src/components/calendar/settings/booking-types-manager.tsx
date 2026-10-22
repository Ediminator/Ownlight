'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { BookingType, BookingLocationType } from '@/server/db/schema/calendar';
import {
  createBookingTypeAction,
  updateBookingTypeAction,
  deleteBookingTypeAction,
} from '@/server/calendar/availability-actions';
import { generateSlug, isValidSlug } from '@/lib/slug';
import { COLOR_OPTIONS, getColorDotClass, type ColorOption } from './availability-helpers';
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

interface BookingTypesManagerProps {
  initialBookingTypes: BookingType[];
  locale?: string;
}

export function BookingTypesManager({ initialBookingTypes }: BookingTypesManagerProps) {
  const t = useTranslations('settings.availability.bookingTypes');

  const [bookingTypes, setBookingTypes] = React.useState<BookingType[]>(initialBookingTypes);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<BookingType | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<BookingType | null>(null);

  // Form State
  const [title, setTitle] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState(30);
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = React.useState(0);
  const [bufferAfterMinutes, setBufferAfterMinutes] = React.useState(15);
  const [minNoticeHours, setMinNoticeHours] = React.useState(24);
  const [maxFutureDays, setMaxFutureDays] = React.useState(60);
  const [locationType, setLocationType] = React.useState<BookingLocationType>('google_meet');
  const [locationDetails, setLocationDetails] = React.useState('');
  const [color, setColor] = React.useState<ColorOption>('indigo');
  const [isActive, setIsActive] = React.useState(true);

  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copiedSlug, setCopiedSlug] = React.useState<string | null>(null);
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const resetForm = () => {
    setTitle('');
    setSlug('');
    setSlugManuallyEdited(false);
    setDescription('');
    setDurationMinutes(30);
    setBufferBeforeMinutes(0);
    setBufferAfterMinutes(15);
    setMinNoticeHours(24);
    setMaxFutureDays(60);
    setLocationType('google_meet');
    setLocationDetails('');
    setColor('indigo');
    setIsActive(true);
    setFormError(null);
    setEditingItem(null);
  };

  const handleOpenNew = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (item: BookingType) => {
    setEditingItem(item);
    setTitle(item.title);
    setSlug(item.slug);
    setSlugManuallyEdited(true);
    setDescription(item.description ?? '');
    setDurationMinutes(item.durationMinutes);
    setBufferBeforeMinutes(item.bufferBeforeMinutes);
    setBufferAfterMinutes(item.bufferAfterMinutes);
    setMinNoticeHours(item.minNoticeHours);
    setMaxFutureDays(item.maxFutureDays);
    setLocationType(item.locationType);
    setLocationDetails(item.locationDetails ?? '');
    setColor(item.color as ColorOption);
    setIsActive(item.isActive);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugManuallyEdited && !editingItem) {
      setSlug(generateSlug(val));
    }
  };

  const handleSlugChange = (val: string) => {
    setSlugManuallyEdited(true);
    setSlug(val.toLowerCase().trim());
  };

  const handleCopyLink = async (targetSlug: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/book/${targetSlug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Ignore clipboard write rejection in headless/unfocused contexts
    }
    setCopiedSlug(targetSlug);
    setTimeout(() => {
      setCopiedSlug(null);
    }, 2500);
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setFormError(t('errorTitleRequired'));
      return;
    }

    if (!isValidSlug(slug)) {
      setFormError(t('errorInvalidSlug'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingItem) {
        // Update
        const res = await updateBookingTypeAction(editingItem.id, {
          title: title.trim(),
          slug: slug.trim(),
          description: description.trim() ? description.trim() : null,
          durationMinutes,
          bufferBeforeMinutes,
          bufferAfterMinutes,
          minNoticeHours,
          maxFutureDays,
          locationType,
          locationDetails: locationDetails.trim() ? locationDetails.trim() : null,
          color,
          isActive,
        });

        if (res.success) {
          setBookingTypes((prev) =>
            prev.map((item) => (item.id === editingItem.id ? res.data : item)),
          );
          setIsDialogOpen(false);
          resetForm();
          setNotification({
            type: 'success',
            message: t('successUpdated'),
          });
        } else {
          setFormError(res.error || t('errorSaveFailed'));
        }
      } else {
        // Create
        const res = await createBookingTypeAction({
          title: title.trim(),
          slug: slug.trim(),
          description: description.trim() ? description.trim() : null,
          durationMinutes,
          bufferBeforeMinutes,
          bufferAfterMinutes,
          minNoticeHours,
          maxFutureDays,
          locationType,
          locationDetails: locationDetails.trim() ? locationDetails.trim() : null,
          color,
          isActive,
        });

        if (res.success) {
          setBookingTypes((prev) => [...prev, res.data]);
          setIsDialogOpen(false);
          resetForm();
          setNotification({
            type: 'success',
            message: t('successCreated'),
          });
        } else {
          setFormError(res.error || t('errorSaveFailed'));
        }
      }
    } catch {
      setFormError(t('errorSaveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setIsSubmitting(true);
    try {
      const res = await deleteBookingTypeAction(deleteTarget.id);
      if (res.success) {
        setBookingTypes((prev) => prev.filter((b) => b.id !== deleteTarget.id));
        setNotification({
          type: 'success',
          message: t('successDeleted'),
        });
        setDeleteTarget(null);
      } else {
        setNotification({
          type: 'error',
          message: res.error || t('errorDeleteFailed'),
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: t('errorDeleteFailed'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getLocationIcon = (type: BookingLocationType) => {
    switch (type) {
      case 'google_meet':
        return <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
      case 'phone':
        return <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
      case 'in_person':
      default:
        return <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
    }
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
          onClick={handleOpenNew}
          data-testid="new-booking-type-btn"
          className="inline-flex items-center gap-2 self-start min-h-[38px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('newBtn')}</span>
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
            onClick={() => {
              setNotification(null);
            }}
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
          <Sparkles
            className="mx-auto h-10 w-10 text-muted-foreground/60 mb-3"
            aria-hidden="true"
          />
          <h3 className="text-base font-medium text-foreground">{t('emptyTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            {t('emptyDescription')}
          </p>
        </div>
      ) : (
        <div
          data-testid="booking-types-list"
          className="grid gap-4 md:grid-cols-2"
          role="region"
          aria-label={t('listAriaLabel')}
        >
          {bookingTypes.map((item) => {
            const dotClass = getColorDotClass(item.color);

            return (
              <div
                key={item.id}
                data-testid={`booking-type-card-${item.slug}`}
                className={cn(
                  'rounded-lg border bg-card p-5 text-card-foreground shadow-xs flex flex-col justify-between transition-all space-y-4',
                  !item.isActive && 'opacity-70 bg-muted/20 border-dashed',
                )}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn('h-3 w-3 rounded-full shrink-0', dotClass)}
                        aria-hidden="true"
                      />
                      <h3
                        data-testid={`booking-type-title-${item.slug}`}
                        className="font-semibold text-base text-foreground leading-tight"
                      >
                        {item.title}
                      </h3>
                    </div>

                    <span
                      data-testid={`booking-type-status-${item.slug}`}
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider',
                        item.isActive
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-muted text-muted-foreground border border-border',
                      )}
                    >
                      {item.isActive ? t('activeBadge') : t('inactiveBadge')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <span>/book/</span>
                    <span
                      data-testid={`booking-type-slug-${item.slug}`}
                      className="font-semibold text-foreground"
                    >
                      {item.slug}
                    </span>
                  </div>

                  {item.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                  )}

                  {/* Metadata tags */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground pt-1">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{item.durationMinutes} min</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {getLocationIcon(item.locationType)}
                      <span>{t(`location.${item.locationType}`)}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {item.maxFutureDays}d {t('horizonSuffix')}
                      </span>
                    </div>

                    {(item.bufferBeforeMinutes > 0 || item.bufferAfterMinutes > 0) && (
                      <span className="text-2xs bg-muted px-1.5 py-0.5 rounded">
                        {item.bufferBeforeMinutes}m / {item.bufferAfterMinutes}m {t('bufferSuffix')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions row */}
                <div className="flex items-center justify-between pt-3 border-t gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleCopyLink(item.slug);
                    }}
                    data-testid={`copy-booking-type-link-${item.slug}`}
                    className="inline-flex items-center gap-1.5 text-xs h-8"
                    aria-label={`${t('copyLinkAria')} ${item.title}`}
                  >
                    {copiedSlug === item.slug ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        <span className="text-emerald-600 font-medium">{t('copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <span>{t('copyLink')}</span>
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleOpenEdit(item);
                      }}
                      data-testid={`edit-booking-type-${item.slug}`}
                      aria-label={`${t('editBtnAria')} ${item.title}`}
                      className="h-8 px-2 text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="h-4 w-4" aria-hidden="true" />
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteTarget(item);
                      }}
                      data-testid={`delete-booking-type-${item.slug}`}
                      aria-label={`${t('deleteBtnAria')} ${item.title}`}
                      className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{editingItem ? t('dialogEditTitle') : t('dialogNewTitle')}</DialogTitle>
              <DialogDescription>
                {editingItem ? t('dialogEditDescription') : t('dialogNewDescription')}
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <div
                role="alert"
                data-testid="booking-type-form-error"
                className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Title & Slug */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-title-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('labelTitle')} *
                  </label>
                  <input
                    type="text"
                    id="booking-type-title-input"
                    data-testid="booking-type-title-input"
                    required
                    maxLength={150}
                    placeholder={t('titlePlaceholder')}
                    value={title}
                    onChange={(e) => {
                      handleTitleChange(e.target.value);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-slug-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('labelSlug')} *
                  </label>
                  <input
                    type="text"
                    id="booking-type-slug-input"
                    data-testid="booking-type-slug-input"
                    required
                    maxLength={64}
                    placeholder="portrait-consultation"
                    value={slug}
                    onChange={(e) => {
                      handleSlugChange(e.target.value);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label
                  htmlFor="booking-type-description-input"
                  className="text-sm font-medium text-foreground"
                >
                  {t('labelDescription')}
                </label>
                <textarea
                  id="booking-type-description-input"
                  data-testid="booking-type-description-input"
                  rows={2}
                  maxLength={2000}
                  placeholder={t('descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* Duration and Buffers */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-duration-input"
                    className="text-xs font-medium text-foreground"
                  >
                    {t('labelDuration')} (min) *
                  </label>
                  <input
                    type="number"
                    id="booking-type-duration-input"
                    data-testid="booking-type-duration-input"
                    required
                    min={5}
                    max={480}
                    value={durationMinutes}
                    onChange={(e) => {
                      setDurationMinutes(Number(e.target.value));
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-buffer-before-input"
                    className="text-xs font-medium text-foreground"
                  >
                    {t('labelBufferBefore')} (min)
                  </label>
                  <input
                    type="number"
                    id="booking-type-buffer-before-input"
                    data-testid="booking-type-buffer-before-input"
                    min={0}
                    max={120}
                    value={bufferBeforeMinutes}
                    onChange={(e) => {
                      setBufferBeforeMinutes(Number(e.target.value));
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-buffer-after-input"
                    className="text-xs font-medium text-foreground"
                  >
                    {t('labelBufferAfter')} (min)
                  </label>
                  <input
                    type="number"
                    id="booking-type-buffer-after-input"
                    data-testid="booking-type-buffer-after-input"
                    min={0}
                    max={120}
                    value={bufferAfterMinutes}
                    onChange={(e) => {
                      setBufferAfterMinutes(Number(e.target.value));
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Notice & Horizon */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-notice-input"
                    className="text-xs font-medium text-foreground"
                  >
                    {t('labelNotice')} (hours)
                  </label>
                  <input
                    type="number"
                    id="booking-type-notice-input"
                    data-testid="booking-type-notice-input"
                    min={0}
                    max={168}
                    value={minNoticeHours}
                    onChange={(e) => {
                      setMinNoticeHours(Number(e.target.value));
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-horizon-input"
                    className="text-xs font-medium text-foreground"
                  >
                    {t('labelHorizon')} (days)
                  </label>
                  <input
                    type="number"
                    id="booking-type-horizon-input"
                    data-testid="booking-type-horizon-input"
                    min={1}
                    max={365}
                    value={maxFutureDays}
                    onChange={(e) => {
                      setMaxFutureDays(Number(e.target.value));
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Location Type and Details */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-location-type-select"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('labelLocationType')}
                  </label>
                  <select
                    id="booking-type-location-type-select"
                    data-testid="booking-type-location-type-select"
                    value={locationType}
                    onChange={(e) => {
                      setLocationType(e.target.value as BookingLocationType);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="google_meet">{t('location.google_meet')}</option>
                    <option value="phone">{t('location.phone')}</option>
                    <option value="in_person">{t('location.in_person')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="booking-type-location-details-input"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('labelLocationDetails')}
                  </label>
                  <input
                    type="text"
                    id="booking-type-location-details-input"
                    data-testid="booking-type-location-details-input"
                    maxLength={255}
                    placeholder={t('locationDetailsPlaceholder')}
                    value={locationDetails}
                    onChange={(e) => {
                      setLocationDetails(e.target.value);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Color Token Selection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{t('labelColor')}</label>
                <div className="flex items-center gap-2 pt-0.5">
                  {COLOR_OPTIONS.map((c) => {
                    const dotClass = getColorDotClass(c);
                    const isSelected = color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setColor(c);
                        }}
                        data-testid={`booking-type-color-${c}`}
                        aria-label={`Color ${c}`}
                        aria-pressed={isSelected}
                        className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center transition-all',
                          dotClass,
                          isSelected && 'ring-2 ring-primary ring-offset-2 scale-110',
                        )}
                      >
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                        )}
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
                  data-testid="booking-type-active-toggle"
                  checked={isActive}
                  onChange={(e) => {
                    setIsActive(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary focus:ring-offset-background"
                />
                <label
                  htmlFor="booking-type-active-toggle"
                  className="text-sm font-medium text-foreground cursor-pointer select-none"
                >
                  {t('labelIsActive')}
                </label>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                }}
                data-testid="booking-type-cancel-btn"
              >
                {t('cancelBtn')}
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="booking-type-submit-btn">
                {isSubmitting ? t('saving') : editingItem ? t('saveChangesBtn') : t('createBtn')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialogDeleteDescription', {
                title: deleteTarget?.title ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
              }}
              data-testid="cancel-delete-booking-type-btn"
            >
              {t('cancelBtn')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDeleteConfirm();
              }}
              disabled={isSubmitting}
              data-testid="confirm-delete-booking-type-btn"
            >
              {isSubmitting ? t('deleting') : t('confirmDeleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

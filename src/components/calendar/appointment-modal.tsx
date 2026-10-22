'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getInitialAppointmentState, submitAppointmentForm } from './calendar-view-model';
import type { UnifiedCalendarEvent } from '@/server/calendar/service';
import type { BookingLocationType } from '@/server/db/schema/calendar';

export interface AppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit' | 'cancel';
  appointment?: UnifiedCalendarEvent | null;
  defaultDate?: string; // 'YYYY-MM-DD'
  onSuccess: () => void;
}

export function AppointmentModal({
  open,
  onOpenChange,
  mode,
  appointment,
  defaultDate,
  onSuccess,
}: AppointmentModalProps) {
  const t = useTranslations('calendar.modals.appointment');

  const [title, setTitle] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).title,
  );
  const [startsAt, setStartsAt] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).startsAt,
  );
  const [endsAt, setEndsAt] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).endsAt,
  );
  const [attendeeName, setAttendeeName] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).attendeeName,
  );
  const [attendeeEmail, setAttendeeEmail] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).attendeeEmail,
  );
  const [attendeePhone, setAttendeePhone] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).attendeePhone,
  );
  const [locationType, setLocationType] = useState<BookingLocationType>(
    () => getInitialAppointmentState(appointment, mode, defaultDate).locationType,
  );
  const [locationDetails, setLocationDetails] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).locationDetails,
  );
  const [notes, setNotes] = useState(
    () => getInitialAppointmentState(appointment, mode, defaultDate).notes,
  );
  const [cancelReason, setCancelReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  const [prevAppointment, setPrevAppointment] = useState(appointment);
  const [prevMode, setPrevMode] = useState(mode);

  if (open !== prevOpen || appointment !== prevAppointment || mode !== prevMode) {
    setPrevOpen(open);
    setPrevAppointment(appointment);
    setPrevMode(mode);
    setErrorMessage(null);

    const initial = getInitialAppointmentState(appointment, mode, defaultDate);
    setTitle(initial.title);
    setStartsAt(initial.startsAt);
    setEndsAt(initial.endsAt);
    setAttendeeName(initial.attendeeName);
    setAttendeeEmail(initial.attendeeEmail);
    setAttendeePhone(initial.attendeePhone);
    setLocationType(initial.locationType);
    setLocationDetails(initial.locationDetails);
    setNotes(initial.notes);
    setCancelReason('');
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await submitAppointmentForm(mode, appointment, {
        title,
        startsAt,
        endsAt,
        attendeeName,
        attendeeEmail,
        attendeePhone,
        locationType,
        locationDetails,
        notes,
        cancelReason,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        return;
      }

      onSuccess();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        data-testid="appointment-modal"
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'cancel'
              ? t('cancelTitle')
              : mode === 'edit'
                ? t('editTitle')
                : t('createTitle')}
          </DialogTitle>
          {mode === 'cancel' && <DialogDescription>{t('cancelDescription')}</DialogDescription>}
        </DialogHeader>

        {errorMessage && (
          <div
            className="rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {mode === 'cancel' ? (
            <div className="space-y-2">
              <label
                htmlFor="appointment-cancel-reason"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {t('cancelDescription')}
              </label>
              <textarea
                id="appointment-cancel-reason"
                data-testid="appointment-cancel-reason-input"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value);
                }}
                placeholder="e.g. Reschedule requested by client"
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="appointment-title" className="text-sm font-medium leading-none">
                  {t('titleLabel')} <span className="text-destructive">*</span>
                </label>
                <input
                  id="appointment-title"
                  data-testid="appointment-title-input"
                  type="text"
                  required
                  placeholder={t('titlePlaceholder')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="appointment-starts-at"
                    className="text-sm font-medium leading-none"
                  >
                    {t('startsAtLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="appointment-starts-at"
                    data-testid="appointment-starts-at-input"
                    type="datetime-local"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={startsAt}
                    onChange={(e) => {
                      setStartsAt(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="appointment-ends-at" className="text-sm font-medium leading-none">
                    {t('endsAtLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="appointment-ends-at"
                    data-testid="appointment-ends-at-input"
                    type="datetime-local"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={endsAt}
                    onChange={(e) => {
                      setEndsAt(e.target.value);
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="appointment-attendee-name"
                    className="text-sm font-medium leading-none"
                  >
                    {t('attendeeNameLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="appointment-attendee-name"
                    data-testid="appointment-attendee-name-input"
                    type="text"
                    required
                    placeholder={t('attendeeNamePlaceholder')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={attendeeName}
                    onChange={(e) => {
                      setAttendeeName(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="appointment-attendee-email"
                    className="text-sm font-medium leading-none"
                  >
                    {t('attendeeEmailLabel')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="appointment-attendee-email"
                    data-testid="appointment-attendee-email-input"
                    type="email"
                    required
                    placeholder={t('attendeeEmailPlaceholder')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={attendeeEmail}
                    onChange={(e) => {
                      setAttendeeEmail(e.target.value);
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="appointment-attendee-phone"
                    className="text-sm font-medium leading-none"
                  >
                    {t('attendeePhoneLabel')}
                  </label>
                  <input
                    id="appointment-attendee-phone"
                    data-testid="appointment-attendee-phone-input"
                    type="tel"
                    placeholder={t('attendeePhonePlaceholder')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={attendeePhone}
                    onChange={(e) => {
                      setAttendeePhone(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="appointment-location-type"
                    className="text-sm font-medium leading-none"
                  >
                    {t('locationTypeLabel')}
                  </label>
                  <select
                    id="appointment-location-type"
                    data-testid="appointment-location-type-select"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900"
                    value={locationType}
                    onChange={(e) => {
                      setLocationType(e.target.value as BookingLocationType);
                    }}
                  >
                    <option value="google_meet">{t('locationTypes.googleMeet')}</option>
                    <option value="phone">{t('locationTypes.phone')}</option>
                    <option value="in_person">{t('locationTypes.inPerson')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="appointment-location-details"
                  className="text-sm font-medium leading-none"
                >
                  {t('locationDetailsLabel')}
                </label>
                <input
                  id="appointment-location-details"
                  data-testid="appointment-location-details-input"
                  type="text"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={locationDetails}
                  onChange={(e) => {
                    setLocationDetails(e.target.value);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="appointment-notes" className="text-sm font-medium leading-none">
                  {t('notesLabel')}
                </label>
                <textarea
                  id="appointment-notes"
                  data-testid="appointment-notes-input"
                  placeholder={t('notesPlaceholder')}
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                />
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              data-testid="appointment-modal-close-btn"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              {t('cancel')}
            </Button>
            {mode === 'cancel' ? (
              <Button
                type="submit"
                variant="destructive"
                data-testid="appointment-confirm-cancel-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('cancelling') : t('cancelConfirm')}
              </Button>
            ) : (
              <Button type="submit" data-testid="appointment-submit-btn" disabled={isSubmitting}>
                {isSubmitting ? t('saving') : t('save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

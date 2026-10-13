'use client';

import React, { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { submitInquiryAction } from '@/server/inquiry-forms/public-actions';
import { useAltchaSolver } from '../../_components/pow-solver';
import type { InquiryForm, InquiryFormFieldConfig } from '@/server/db/schema/inquiry-forms';

interface HostedInquiryFormProps {
  form: InquiryForm;
  locale: 'en' | 'de';
  studioName: string;
  timezone: string;
  acknowledgementText: string;
  privacyPolicyUrl: string;
  deliveryMode?: 'hosted' | 'embed';
}

const REQUIRED_MARK = '*';

function getMinAndMaxDates(timezone: string) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const min = formatter.format(now);
    const future = new Date(now.getTime());
    future.setUTCFullYear(future.getUTCFullYear() + 5);
    const max = formatter.format(future);
    return { min, max };
  } catch {
    const now = new Date();
    const min = now.toISOString().slice(0, 10);
    const future = new Date(now.getTime());
    future.setUTCFullYear(future.getUTCFullYear() + 5);
    const max = future.toISOString().slice(0, 10);
    return { min, max };
  }
}

function getLocalizedErrorMessage(
  fieldKey: string,
  rawMessage: string,
  t: (key: string) => string,
): string {
  if (
    rawMessage === 'fieldRequired' ||
    rawMessage.includes('required') ||
    rawMessage.includes('erforderlich')
  ) {
    if (
      fieldKey === 'notice_acknowledged' ||
      rawMessage.includes('acknowledgement') ||
      rawMessage.includes('Datenschutz')
    ) {
      return t('errors.acknowledgementRequired');
    }
    return t('errors.fieldRequired');
  }
  if (
    rawMessage === 'invalidEmail' ||
    rawMessage.toLowerCase().includes('email') ||
    rawMessage.toLowerCase().includes('e-mail')
  ) {
    if (
      rawMessage.includes('newline') ||
      rawMessage.includes('Zeilenumbrüche') ||
      rawMessage === 'emailNoCrlf'
    ) {
      return t('errors.emailNoCrlf');
    }
    return t('errors.invalidEmail');
  }
  if (
    rawMessage === 'invalidPhone' ||
    rawMessage.toLowerCase().includes('phone') ||
    rawMessage.toLowerCase().includes('telefon')
  ) {
    return t('errors.invalidPhone');
  }
  if (
    rawMessage === 'invalidEventType' ||
    rawMessage.toLowerCase().includes('event type') ||
    rawMessage.toLowerCase().includes('veranstaltungsart')
  ) {
    return t('errors.invalidEventType');
  }
  if (
    rawMessage === 'invalidEventDate' ||
    rawMessage.toLowerCase().includes('event date') ||
    rawMessage.toLowerCase().includes('veranstaltungsdatum')
  ) {
    return t('errors.invalidEventDate');
  }
  if (
    rawMessage === 'invalidLocation' ||
    rawMessage.toLowerCase().includes('location') ||
    rawMessage.toLowerCase().includes('veranstaltungsort')
  ) {
    return t('errors.invalidLocation');
  }
  if (
    rawMessage === 'messageTooLong' ||
    rawMessage.toLowerCase().includes('2,000') ||
    rawMessage.toLowerCase().includes('2000')
  ) {
    return t('errors.messageTooLong');
  }
  if (rawMessage === 'acknowledgementRequired') {
    return t('errors.acknowledgementRequired');
  }
  if (
    rawMessage === 'rateLimited' ||
    rawMessage.toLowerCase().includes('too many attempts') ||
    rawMessage.toLowerCase().includes('zu viele versuche')
  ) {
    return t('errors.rateLimited');
  }
  if (
    rawMessage === 'unavailable' ||
    rawMessage.toLowerCase().includes('unavailable') ||
    rawMessage.toLowerCase().includes('nicht verfügbar')
  ) {
    return t('errors.unavailable');
  }
  if (
    rawMessage === 'unverifiedRejected' ||
    rawMessage.toLowerCase().includes('unverified') ||
    rawMessage.toLowerCase().includes('nicht verifiziert')
  ) {
    return t('errors.unverifiedRejected');
  }
  return rawMessage;
}

export function HostedInquiryForm({
  form,
  locale,
  studioName,
  timezone,
  acknowledgementText,
  privacyPolicyUrl,
  deliveryMode = 'hosted',
}: HostedInquiryFormProps) {
  const t = useTranslations('inquiry.public');
  const [state, formAction, isPending] = useActionState(submitInquiryAction, null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const {
    status: powStatus,
    payloadBase64,
    waitingForSubmit,
    ensureVerifiedPayload,
  } = useAltchaSolver(form.slug);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    if (isSubmittingRef.current) {
      return;
    }

    if (powStatus === 'solving' || powStatus === 'fetching') {
      e.preventDefault();
      void (async () => {
        const verifiedPayload = await ensureVerifiedPayload();
        if (formRef.current) {
          isSubmittingRef.current = true;
          const hiddenInput = formRef.current.querySelector<HTMLInputElement>(
            'input[name="altcha_payload"]',
          );
          if (hiddenInput && verifiedPayload) {
            hiddenInput.value = verifiedPayload;
          }
          if (typeof formRef.current.requestSubmit === 'function') {
            formRef.current.requestSubmit();
          } else {
            formRef.current.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      })();
    }
  };

  const values = state?.values ?? {};
  const rawFieldErrors = state?.fieldErrors ?? {};

  // Localize field errors for UI display
  const fieldErrors: Record<string, string> = {};
  for (const [key, msg] of Object.entries(rawFieldErrors)) {
    fieldErrors[key] = getLocalizedErrorMessage(key, msg, t);
  }

  const hasErrors =
    !state?.success && (state?.error !== undefined || Object.keys(fieldErrors).length > 0);

  // Focus error summary on validation re-render (SC 3.3.1)
  useEffect(() => {
    if (hasErrors && errorSummaryRef.current) {
      errorSummaryRef.current.focus();
    }
  }, [hasErrors]);

  const { min: minDate, max: maxDate } = getMinAndMaxDates(timezone);

  // Sort enabled fields by configured order
  const enabledFields = form.fields
    .filter((f): f is InquiryFormFieldConfig => f.enabled)
    .sort((a, b) => a.order - b.order);

  // Determine error list for summary
  const errorList: { fieldKey: string; message: string }[] = [];
  if (state && !state.success) {
    if (Object.keys(fieldErrors).length > 0) {
      for (const [key, msg] of Object.entries(fieldErrors)) {
        errorList.push({ fieldKey: key, message: msg });
      }
    } else if (state.error) {
      errorList.push({
        fieldKey: 'form',
        message: getLocalizedErrorMessage('form', state.error, t),
      });
    }
  }

  return (
    <div className={`w-full ${deliveryMode === 'embed' ? 'space-y-4' : 'space-y-6'}`}>
      {deliveryMode !== 'embed' && (
        <div className="space-y-2 text-center sm:text-left">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {studioName}
          </h1>
          <p className="text-sm text-muted-foreground">{form.name}</p>
          <p className="text-xs text-muted-foreground">
            {t('studioProcessesData', {
              studio: studioName,
              privacyPolicy: t('privacyPolicyLink'),
            })}
          </p>
        </div>
      )}

      {hasErrors && (
        <div
          ref={errorSummaryRef}
          id="error-summary"
          tabIndex={-1}
          role="alert"
          aria-labelledby="error-summary-heading"
          className="p-4 rounded-md border border-destructive dark:border-red-800 bg-destructive/10 dark:bg-red-950/40 text-destructive dark:text-red-300 outline-none focus:ring-2 focus:ring-destructive dark:focus:ring-red-400"
        >
          <h2
            id="error-summary-heading"
            className="text-sm font-semibold mb-2 text-destructive dark:text-red-300"
          >
            {t('errors.summaryTitle')}
          </h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {errorList.map(({ fieldKey, message }) => (
              <li key={fieldKey}>
                <a
                  href={`#field-${fieldKey}`}
                  className="underline hover:opacity-80 font-medium text-destructive dark:text-red-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive dark:focus-visible:ring-red-400"
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="space-y-5"
        noValidate
      >
        {/* Hidden routing fields */}
        <input type="hidden" name="slug" value={form.slug} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="delivery_mode" value={deliveryMode} />
        <input type="hidden" name="altcha_payload" value={payloadBase64} />

        {/* Honeypot field (AC-3, AC-13) */}
        <div style={{ display: 'none' }} aria-hidden="true">
          <label htmlFor="field-website">{t('fields.website')}</label>
          <input
            id="field-website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>

        {/* Dynamic Fields */}
        {enabledFields.map((field) => {
          const fieldError = fieldErrors[field.key];
          const hasFieldError = Boolean(fieldError);

          switch (field.key) {
            case 'given_name':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-given_name"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.given_name')}{' '}
                    <span className="text-destructive dark:text-red-400" aria-hidden="true">
                      {REQUIRED_MARK}
                    </span>
                  </label>
                  <input
                    id="field-given_name"
                    type="text"
                    name="given_name"
                    maxLength={100}
                    required
                    defaultValue={values.given_name ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-given_name' : undefined}
                    placeholder={t('fields.given_namePlaceholder')}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p id="error-given_name" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'family_name':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-family_name"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.family_name')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <input
                    id="field-family_name"
                    type="text"
                    name="family_name"
                    maxLength={100}
                    required={field.required}
                    defaultValue={values.family_name ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-family_name' : undefined}
                    placeholder={t('fields.family_namePlaceholder')}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p
                      id="error-family_name"
                      className="text-xs text-destructive dark:text-red-400"
                    >
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'email':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-email"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.email')}{' '}
                    <span className="text-destructive dark:text-red-400" aria-hidden="true">
                      {REQUIRED_MARK}
                    </span>
                  </label>
                  <input
                    id="field-email"
                    type="email"
                    name="email"
                    maxLength={254}
                    required
                    defaultValue={values.email ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-email' : undefined}
                    placeholder={t('fields.emailPlaceholder')}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p id="error-email" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'phone':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-phone"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.phone')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <input
                    id="field-phone"
                    type="tel"
                    name="phone"
                    maxLength={32}
                    required={field.required}
                    defaultValue={values.phone ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-phone' : undefined}
                    placeholder={t('fields.phonePlaceholder')}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p id="error-phone" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'event_type':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-event_type"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.event_type')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <select
                    id="field-event_type"
                    name="event_type"
                    required={field.required}
                    defaultValue={values.event_type ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-event_type' : undefined}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">{t('fields.event_typeSelect')}</option>
                    {form.eventTypes.map((et) => (
                      <option key={et.key} value={et.key}>
                        {locale === 'de' ? et.label_de : et.label_en}
                      </option>
                    ))}
                  </select>
                  {hasFieldError && (
                    <p id="error-event_type" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'event_date':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-event_date"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.event_date')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <input
                    id="field-event_date"
                    type="date"
                    name="event_date"
                    min={minDate}
                    max={maxDate}
                    required={field.required}
                    defaultValue={values.event_date ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-event_date' : undefined}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p id="error-event_date" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'event_location':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-event_location"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.event_location')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <input
                    id="field-event_location"
                    type="text"
                    name="event_location"
                    maxLength={200}
                    required={field.required}
                    defaultValue={values.event_location ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={hasFieldError ? 'error-event_location' : undefined}
                    placeholder={t('fields.event_locationPlaceholder')}
                    className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {hasFieldError && (
                    <p
                      id="error-event_location"
                      className="text-xs text-destructive dark:text-red-400"
                    >
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            case 'message':
              return (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor="field-message"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('fields.message')}{' '}
                    {field.required && (
                      <span className="text-destructive dark:text-red-400" aria-hidden="true">
                        {REQUIRED_MARK}
                      </span>
                    )}
                  </label>
                  <textarea
                    id="field-message"
                    name="message"
                    maxLength={2000}
                    rows={4}
                    required={field.required}
                    defaultValue={values.message ?? ''}
                    aria-invalid={hasFieldError}
                    aria-describedby={`message-hint${hasFieldError ? ' error-message' : ''}`}
                    placeholder={t('fields.messagePlaceholder')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {/* D7 sensitive-data hint (ADR-0015 §5, §12) */}
                  <p id="message-hint" className="text-xs text-muted-foreground">
                    {t('sensitiveDataHint')}
                  </p>
                  {hasFieldError && (
                    <p id="error-message" className="text-xs text-destructive dark:text-red-400">
                      {fieldError}
                    </p>
                  )}
                </div>
              );

            default:
              return null;
          }
        })}

        {/* Privacy Notice Acknowledgement Checkbox (AC-1, AC-13) */}
        <div className="space-y-1.5 pt-2">
          <div className="flex items-start space-x-3">
            <input
              id="field-notice_acknowledged"
              type="checkbox"
              name="notice_acknowledged"
              required
              defaultChecked={
                values.notice_acknowledged === 'true' ||
                values.notice_acknowledged === 'on' ||
                values.notice_acknowledged === '1'
              }
              aria-invalid={Boolean(fieldErrors.notice_acknowledged)}
              aria-describedby={
                fieldErrors.notice_acknowledged ? 'error-notice_acknowledged' : undefined
              }
              className="mt-1 h-5 w-5 min-w-[20px] min-h-[20px] rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <label
              htmlFor="field-notice_acknowledged"
              className="text-sm text-foreground leading-normal"
            >
              {acknowledgementText}{' '}
              <a
                href={privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {`(${t('privacyPolicyLink')})`}
              </a>
            </label>
          </div>
          {fieldErrors.notice_acknowledged && (
            <p
              id="error-notice_acknowledged"
              className="text-xs text-destructive dark:text-red-400"
            >
              {fieldErrors.notice_acknowledged}
            </p>
          )}
        </div>

        {/* Submit button (Touch target >= 44x44 px) and accessible PoW status indicator */}
        <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <button
            type="submit"
            disabled={isPending || waitingForSubmit}
            className="w-full sm:w-auto inline-flex min-h-[44px] min-w-[120px] items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-colors"
          >
            {isPending ? t('submitting') : waitingForSubmit ? t('verifying') : t('submit')}
          </button>

          {/* Accessible status indicator (AC-12) */}
          <div
            id="pow-status"
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground flex items-center gap-1.5 min-h-[20px]"
          >
            {(powStatus === 'solving' || powStatus === 'fetching' || waitingForSubmit) && (
              <>
                <span
                  className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse"
                  aria-hidden="true"
                />
                <span>{t('verifying')}</span>
              </>
            )}
            {powStatus === 'verified' && !waitingForSubmit && (
              <>
                <span
                  className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                <span>{t('verified')}</span>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

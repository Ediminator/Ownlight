'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { createClientAction, setClientTagsAction } from '@/server/clients/actions';
import { parseTagsString } from '@/lib/tags';
import { getClientErrorMessage } from '@/lib/client-errors';
import type { DuplicateEmailMatch } from '@/server/clients/repo';
import type { ClientKind, ClientLocale } from '@/server/db/schema/clients';

export interface ClientCreateFormProps {
  locale: string;
  defaultLocale?: ClientLocale;
}

export function ClientCreateForm({ locale, defaultLocale = 'en' }: ClientCreateFormProps) {
  const t = useTranslations('clients.form');
  const tErrors = useTranslations('clients.errors');
  const tGoogleSync = useTranslations('clients.googleSync');
  const router = useRouter();

  // Form State
  const [kind, setKind] = React.useState<ClientKind>('person');
  const [displayName, setDisplayName] = React.useState('');
  const [preferredLocale, setPreferredLocale] = React.useState<ClientLocale>(defaultLocale);
  const [givenName, setGivenName] = React.useState('');
  const [familyName, setFamilyName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [tags, setTags] = React.useState('');

  // Status & Error State
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [errorSummaryList, setErrorSummaryList] = React.useState<
    { fieldId: string; message: string }[]
  >([]);
  const [serverErrorMessage, setServerErrorMessage] = React.useState<string | null>(null);
  const [duplicateMatches, setDuplicateMatches] = React.useState<DuplicateEmailMatch[] | null>(
    null,
  );
  const [googleContactsSyncEnabled, setGoogleContactsSyncEnabled] = React.useState(false);

  // Refs for accessibility focus management (AC-2, AC-13)
  const errorSummaryRef = React.useRef<HTMLDivElement>(null);
  const duplicateWarningRef = React.useRef<HTMLDivElement>(null);
  const isPendingRef = React.useRef(false);

  const handleSubmit = async (e?: React.SyntheticEvent, acknowledgeDuplicates = false) => {
    if (e) {
      e.preventDefault();
    }

    // Double-submit prevention guard (AC-9)
    if (isPendingRef.current || isSubmitting) {
      return;
    }

    // Reset error messages and duplicate warning before sending
    setFieldErrors({});
    setErrorSummaryList([]);
    setServerErrorMessage(null);
    if (!acknowledgeDuplicates) {
      setDuplicateMatches(null);
    }

    // Client-side quick validation to align with server schema
    const errors: Record<string, string> = {};
    const summary: { fieldId: string; message: string }[] = [];

    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName.length === 0) {
      errors.displayName = tErrors('displayNameRequired');
      summary.push({ fieldId: 'displayName', message: tErrors('displayNameRequired') });
    }

    const trimmedGiven = givenName.trim();
    const trimmedFamily = familyName.trim();
    if (trimmedGiven.length === 0 && trimmedFamily.length === 0) {
      errors.givenName = tErrors('nameRequired');
      summary.push({ fieldId: 'givenName', message: tErrors('nameRequired') });
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail.length > 0) {
      // Basic email syntax check (AC-2)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.email = tErrors('emailInvalid');
        summary.push({ fieldId: 'email', message: tErrors('emailInvalid') });
      }
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone.length > 0) {
      const phoneRegex = /^\+?[0-9][0-9 ()/.-]{2,31}$/;
      if (!phoneRegex.test(trimmedPhone)) {
        errors.phone = tErrors('phoneInvalid');
        summary.push({ fieldId: 'phone', message: tErrors('phoneInvalid') });
      }
    }

    if (summary.length > 0) {
      setFieldErrors(errors);
      setErrorSummaryList(summary);
      // Move focus to error summary (AC-2, WCAG 2.2 SC 3.3.1, 3.3.3)
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 50);
      return;
    }

    // Execute server action
    isPendingRef.current = true;
    setIsSubmitting(true);

    try {
      const payload = {
        kind,
        displayName: trimmedDisplayName,
        preferredLocale,
        googleContactsSyncEnabled,
        primaryContact: {
          givenName: trimmedGiven.length > 0 ? trimmedGiven : null,
          familyName: trimmedFamily.length > 0 ? trimmedFamily : null,
          email: trimmedEmail.length > 0 ? trimmedEmail : null,
          phone: trimmedPhone.length > 0 ? trimmedPhone : null,
        },
        acknowledgeDuplicates,
      };

      const res = await createClientAction(payload);

      if (!res.success) {
        if (res.code === 'DUPLICATE_EMAIL') {
          // AC-3: Duplicate email detection
          const matches = res.duplicates ?? res.data?.duplicates ?? [];
          setDuplicateMatches(matches);
          setTimeout(() => {
            duplicateWarningRef.current?.focus();
          }, 50);
          return;
        }

        if (res.code === 'VALIDATION_FAILED') {
          // Server validation failure (AC-2)
          const sErrors: Record<string, string> = {};
          const sSummary: { fieldId: string; message: string }[] = [];

          if (res.fields) {
            for (const field of res.fields) {
              if (field.includes('displayName')) {
                sErrors.displayName = tErrors('displayNameRequired');
                sSummary.push({ fieldId: 'displayName', message: tErrors('displayNameRequired') });
              }
              if (field.includes('email')) {
                sErrors.email = tErrors('emailInvalid');
                sSummary.push({ fieldId: 'email', message: tErrors('emailInvalid') });
              }
              if (field.includes('givenName') || field.includes('familyName')) {
                sErrors.givenName = tErrors('nameRequired');
                sSummary.push({ fieldId: 'givenName', message: tErrors('nameRequired') });
              }
              if (field.includes('phone')) {
                sErrors.phone = tErrors('phoneInvalid');
                sSummary.push({ fieldId: 'phone', message: tErrors('phoneInvalid') });
              }
            }
          }

          if (sSummary.length === 0) {
            sSummary.push({ fieldId: 'displayName', message: tErrors('VALIDATION_FAILED') });
          }

          setFieldErrors(sErrors);
          setErrorSummaryList(sSummary);
          setTimeout(() => {
            errorSummaryRef.current?.focus();
          }, 50);
          return;
        }

        // Generic error message without leaking sensitive SQL or server internals (AC-15)
        setServerErrorMessage(getClientErrorMessage(res.code, tErrors));
        return;
      }

      // Client created successfully! Now associate tags if provided
      const newClientId = res.data.clientId;
      const parsedTags = parseTagsString(tags);
      if (parsedTags.length > 0) {
        try {
          await setClientTagsAction({ clientId: newClientId, tagNames: parsedTags });
        } catch {
          // Non-blocking; continue to profile
        }
      }

      // AC-1, AC-15: Navigate to new client profile without any PII in URL
      router.push(`/${locale}/clients/${newClientId}?created=1`);
    } catch {
      // AC-15: Catch unexpected error and display generic localized message
      setServerErrorMessage(tErrors('GENERIC_ERROR'));
    } finally {
      setIsSubmitting(false);
      isPendingRef.current = false;
    }
  };

  const handleCancelDuplicate = () => {
    // AC-3: Cancel creates nothing, keeps entered form values, clears duplicate warning
    setDuplicateMatches(null);
  };

  const handleCreateAnyway = () => {
    // AC-3: Create anyway resubmits with acknowledgeDuplicates: true
    void handleSubmit(undefined, true);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto w-full" data-testid="client-create-container">
      {/* Back to Clients Link */}
      <div>
        <Link
          href={`/${locale}/clients`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-2 py-1 min-h-[44px]"
          data-testid="back-to-directory-link"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('cancel')}</span>
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Error Summary (AC-2, WCAG 2.2 SC 3.3.1, 3.3.3) */}
      {errorSummaryList.length > 0 && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="error-summary-title"
          className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 p-4 text-red-900 dark:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-600"
          data-testid="error-summary"
        >
          <div
            className="flex items-center gap-2 font-semibold text-sm mb-2 text-red-900 dark:text-red-200"
            id="error-summary-title"
          >
            <AlertCircle
              className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
              aria-hidden="true"
            />
            <span>{t('errorSummaryTitle')}</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {errorSummaryList.map((err, idx) => (
              <li key={idx}>
                <a
                  href={`#${err.fieldId}`}
                  className="underline text-red-900 dark:text-red-200 hover:text-red-950 dark:hover:text-red-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center"
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(err.fieldId);
                    el?.focus();
                  }}
                >
                  {err.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Duplicate Email Warning (AC-3) */}
      {duplicateMatches && duplicateMatches.length > 0 && (
        <div
          ref={duplicateWarningRef}
          tabIndex={-1}
          role="region"
          aria-labelledby="duplicate-warning-title"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-5 text-amber-950 dark:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500 space-y-3"
          data-testid="duplicate-warning"
        >
          <div
            className="flex items-center gap-2 font-semibold text-base"
            id="duplicate-warning-title"
          >
            <AlertTriangle
              className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <span>{t('duplicateWarningTitle')}</span>
          </div>
          <p className="text-sm">{t('duplicateWarningDescription')}</p>
          <ul className="list-disc list-inside space-y-1 text-sm font-medium">
            {duplicateMatches.map((m) => (
              <li key={m.clientId}>
                <a
                  href={`/${locale}/clients/${m.clientId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-800 dark:hover:text-amber-100 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  data-testid={`duplicate-match-link-${m.clientId}`}
                >
                  <span>{m.displayName}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground ml-1">{t('opensInNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleCreateAnyway}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-amber-500 text-amber-950 font-semibold px-4 py-2 text-sm shadow hover:bg-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
              data-testid="create-anyway-btn"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('createAnyway')}
            </button>
            <button
              type="button"
              onClick={handleCancelDuplicate}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
              data-testid="cancel-duplicate-btn"
            >
              {t('cancelDuplicate')}
            </button>
          </div>
        </div>
      )}

      {/* Server Error Message (AC-15) */}
      {serverErrorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 p-4 text-red-900 dark:text-red-200 text-sm font-medium flex items-start gap-2"
          data-testid="server-error-message"
        >
          <AlertCircle
            className="h-5 w-5 shrink-0 mt-0.5 text-red-700 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{serverErrorMessage}</span>
        </div>
      )}

      {/* Main Creation Form */}
      <form
        onSubmit={(e) => {
          void handleSubmit(e, false);
        }}
        noValidate
        className="space-y-6"
      >
        {/* Kind (Radio Group) */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">{t('kindLabel')}</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="kind"
                value="person"
                checked={kind === 'person'}
                onChange={() => {
                  setKind('person');
                }}
                className="h-4 w-4 text-primary focus:ring-primary border-input"
                data-testid="kind-person-radio"
              />
              <span>{t('kindPerson')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="kind"
                value="company"
                checked={kind === 'company'}
                onChange={() => {
                  setKind('company');
                }}
                className="h-4 w-4 text-primary focus:ring-primary border-input"
                data-testid="kind-company-radio"
              />
              <span>{t('kindCompany')}</span>
            </label>
          </div>
        </fieldset>

        {/* Display Name */}
        <div className="space-y-1.5">
          <label htmlFor="displayName" className="block text-sm font-medium text-foreground">
            {t('displayNameLabel')}{' '}
            <span className="text-red-700 dark:text-red-400 font-semibold">*</span>
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
            placeholder={t('displayNamePlaceholder')}
            aria-invalid={Boolean(fieldErrors.displayName)}
            aria-describedby={fieldErrors.displayName ? 'displayName-error' : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
            data-testid="display-name-input"
          />
          {fieldErrors.displayName && (
            <p
              id="displayName-error"
              className="text-sm text-red-700 dark:text-red-400 font-medium"
              data-testid="display-name-error"
            >
              {fieldErrors.displayName}
            </p>
          )}
        </div>

        {/* Preferred Language */}
        <div className="space-y-1.5">
          <label htmlFor="preferredLocale" className="block text-sm font-medium text-foreground">
            {t('preferredLanguageLabel')}
          </label>
          <select
            id="preferredLocale"
            name="preferredLocale"
            value={preferredLocale}
            onChange={(e) => {
              setPreferredLocale(e.target.value as ClientLocale);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
            data-testid="preferred-locale-select"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>

        {/* Google Contacts Sync Opt-In (AC-1) */}
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 flex-1">
              <label
                htmlFor="googleContactsSyncEnabled"
                className="text-sm font-medium text-foreground block cursor-pointer select-none"
              >
                {tGoogleSync('toggleLabel')}
              </label>
              <p
                id="google-sync-description"
                data-testid="google-sync-desc"
                className="text-xs text-muted-foreground leading-relaxed"
              >
                {tGoogleSync('toggleDescription')}
              </p>
            </div>
            <div className="flex items-center pt-0.5">
              <input
                id="googleContactsSyncEnabled"
                name="googleContactsSyncEnabled"
                type="checkbox"
                checked={googleContactsSyncEnabled}
                onChange={(e) => {
                  setGoogleContactsSyncEnabled(e.target.checked);
                }}
                aria-describedby="google-sync-description"
                data-testid="google-sync-toggle"
                className="h-5 w-5 rounded border-input text-primary focus:ring-primary cursor-pointer min-h-[24px] min-w-[24px]"
              />
            </div>
          </div>
        </div>

        {/* Primary Contact Section */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <h2 className="text-base font-semibold text-foreground border-b pb-2">
            {t('primaryContactSection')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Given Name */}
            <div className="space-y-1.5">
              <label htmlFor="givenName" className="block text-sm font-medium text-foreground">
                {t('givenNameLabel')}
              </label>
              <input
                id="givenName"
                name="givenName"
                type="text"
                autoComplete="off"
                value={givenName}
                onChange={(e) => {
                  setGivenName(e.target.value);
                }}
                placeholder={t('givenNamePlaceholder')}
                aria-invalid={Boolean(fieldErrors.givenName)}
                aria-describedby={fieldErrors.givenName ? 'givenName-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
                data-testid="given-name-input"
              />
              {fieldErrors.givenName && (
                <p
                  id="givenName-error"
                  className="text-sm text-red-700 dark:text-red-400 font-medium"
                  data-testid="given-name-error"
                >
                  {fieldErrors.givenName}
                </p>
              )}
            </div>

            {/* Family Name */}
            <div className="space-y-1.5">
              <label htmlFor="familyName" className="block text-sm font-medium text-foreground">
                {t('familyNameLabel')}
              </label>
              <input
                id="familyName"
                name="familyName"
                type="text"
                autoComplete="off"
                value={familyName}
                onChange={(e) => {
                  setFamilyName(e.target.value);
                }}
                placeholder={t('familyNamePlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
                data-testid="family-name-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                {t('emailLabel')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder={t('emailPlaceholder')}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
                data-testid="email-input"
              />
              {fieldErrors.email && (
                <p
                  id="email-error"
                  className="text-sm text-red-700 dark:text-red-400 font-medium"
                  data-testid="email-error"
                >
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <label htmlFor="phone" className="block text-sm font-medium text-foreground">
                {t('phoneLabel')}
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                }}
                placeholder={t('phonePlaceholder')}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'phone-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
                data-testid="phone-input"
              />
              {fieldErrors.phone && (
                <p
                  id="phone-error"
                  className="text-sm text-red-700 dark:text-red-400 font-medium"
                  data-testid="phone-error"
                >
                  {fieldErrors.phone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tags Field (AC-8) */}
        <div className="space-y-1.5">
          <label htmlFor="tags" className="block text-sm font-medium text-foreground">
            {t('tagsLabel')}
          </label>
          <input
            id="tags"
            name="tags"
            type="text"
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
            }}
            placeholder={t('tagsPlaceholder')}
            aria-describedby="tags-hint"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px]"
            data-testid="tags-input"
          />
          <p id="tags-hint" className="text-xs text-muted-foreground">
            {t('tagsHint')}
          </p>
        </div>

        {/* Actions (Submit / Cancel) */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="submit-client-btn"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                <span>{t('submitting')}</span>
              </>
            ) : (
              <span>{t('submit')}</span>
            )}
          </button>
          <Link
            href={`/${locale}/clients`}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
            data-testid="cancel-btn"
          >
            {t('cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}

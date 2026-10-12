'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { createInquiryFormAction } from '@/server/inquiry-forms/actions';

interface NewInquiryFormViewProps {
  locale: string;
}

export function NewInquiryFormView({ locale }: NewInquiryFormViewProps) {
  const t = useTranslations('settings.inquiryForms');
  const router = useRouter();

  const [name, setName] = React.useState('');
  const [defaultLocale, setDefaultLocale] = React.useState<'en' | 'de'>(
    locale === 'de' ? 'de' : 'en',
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setErrorMessage(t('errors.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await createInquiryFormAction({
        name: trimmedName,
        default_locale: defaultLocale,
      });

      if (res.success) {
        router.push(`/settings/inquiry-forms/${res.data.id}`);
      } else {
        setIsSubmitting(false);
        setErrorMessage(res.error || t('errors.generic'));
      }
    } catch {
      setIsSubmitting(false);
      setErrorMessage(t('errors.generic'));
    }
  };

  return (
    <div className="space-y-6 max-w-2xl w-full min-w-0" data-testid="new-inquiry-form-view">
      {/* Back link */}
      <div>
        <Link
          href="/settings/inquiry-forms"
          data-testid="back-to-forms-link"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[36px] py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('backToList')}</span>
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-1 border-b pb-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-primary shrink-0" aria-hidden="true" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words">
            {t('new.title')}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground break-words">{t('new.description')}</p>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="new-form-error"
          className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Form */}
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-6"
      >
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-xs space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="new-form-name"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground"
            >
              {t('new.nameLabel')} <span className="text-destructive">*</span>
            </label>
            <input
              id="new-form-name"
              data-testid="new-form-name-input"
              type="text"
              required
              minLength={1}
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={t('new.namePlaceholder')}
              aria-describedby="new-form-name-help"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <p id="new-form-name-help" className="text-xs text-muted-foreground">
              {t('new.nameHelp')}
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="new-form-locale"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t('new.languageLabel')}
            </label>
            <select
              id="new-form-locale"
              data-testid="new-form-locale-select"
              value={defaultLocale}
              onChange={(e) => {
                setDefaultLocale(e.target.value as 'en' | 'de');
              }}
              aria-describedby="new-form-locale-help"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="en">{t('new.languageEn')}</option>
              <option value="de">{t('new.languageDe')}</option>
            </select>
            <p id="new-form-locale-help" className="text-xs text-muted-foreground">
              {t('new.languageHelp')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="create-form-submit-button"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[40px] px-5 py-2 shadow-sm transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{isSubmitting ? t('new.submittingButton') : t('new.submitButton')}</span>
          </button>
          <Link
            href="/settings/inquiry-forms"
            data-testid="cancel-create-form-link"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[40px] px-4 py-2 shadow-xs transition-colors"
          >
            {t('new.cancelButton')}
          </Link>
        </div>
      </form>
    </div>
  );
}

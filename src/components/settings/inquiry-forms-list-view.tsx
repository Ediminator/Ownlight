'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList, Plus, ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { InquiryForm } from '@/server/db/schema/inquiry-forms';

interface InquiryFormsListViewProps {
  forms: InquiryForm[];
  locale: string;
}

export function InquiryFormsListView({ forms, locale }: InquiryFormsListViewProps) {
  const t = useTranslations('settings.inquiryForms');

  const formatUpdatedDate = React.useCallback(
    (date: Date | string) => {
      try {
        return new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(date));
      } catch {
        return String(date);
      }
    },
    [locale],
  );

  return (
    <div className="space-y-6 max-w-5xl w-full min-w-0" data-testid="inquiry-forms-list-view">
      {/* Back to settings navigation */}
      <div>
        <Link
          href="/settings"
          data-testid="back-to-settings-link"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[36px] py-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('backToSettings')}</span>
        </Link>
      </div>

      {/* Header and "New form" button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-6">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-7 w-7 text-primary shrink-0" aria-hidden="true" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words">
              {t('list.title')}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground break-words">{t('list.description')}</p>
        </div>

        <div>
          <Link
            href="/settings/inquiry-forms/new"
            data-testid="new-form-button"
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[40px] px-4 py-2 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('list.newFormButton')}</span>
          </Link>
        </div>
      </div>

      {/* Forms Table or Empty State */}
      {forms.length === 0 ? (
        <div
          data-testid="inquiry-forms-empty-state"
          className="rounded-lg border border-dashed p-8 text-center bg-card text-card-foreground shadow-xs space-y-4"
        >
          <div className="flex justify-center">
            <div className="rounded-full bg-muted p-4">
              <ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-lg font-semibold tracking-tight">{t('list.emptyTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('list.emptyDescription')}</p>
          </div>
          <div>
            <Link
              href="/settings/inquiry-forms/new"
              data-testid="create-first-form-button"
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 min-h-[40px] px-4 py-2 shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('list.createFirstButton')}</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card text-card-foreground shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table
              data-testid="inquiry-forms-table"
              className="w-full text-sm text-left border-collapse"
            >
              <caption className="sr-only">{t('list.title')}</caption>
              <thead className="bg-muted/50 text-muted-foreground border-b text-xs uppercase font-medium">
                <tr>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('list.tableHeaderName')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('list.tableHeaderStatus')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6">
                    {t('list.tableHeaderUpdated')}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-6 text-right">
                    {t('list.tableHeaderActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {forms.map((form) => (
                  <tr
                    key={form.id}
                    data-testid={`form-row-${form.id}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-4 sm:px-6 font-medium text-foreground">
                      <Link
                        href={`/settings/inquiry-forms/${form.id}`}
                        data-testid={`form-name-${form.id}`}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs"
                      >
                        {form.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      {form.status === 'published' && (
                        <span
                          data-testid={`form-status-${form.id}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                          {t('status.published')}
                        </span>
                      )}
                      {form.status === 'draft' && (
                        <span
                          data-testid={`form-status-${form.id}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                          {t('status.draft')}
                        </span>
                      )}
                      {form.status === 'archived' && (
                        <span
                          data-testid={`form-status-${form.id}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                          {t('status.archived')}
                        </span>
                      )}
                    </td>
                    <td
                      data-testid={`form-updated-${form.id}`}
                      className="px-4 py-4 sm:px-6 text-muted-foreground whitespace-nowrap"
                    >
                      {formatUpdatedDate(form.updatedAt)}
                    </td>
                    <td className="px-4 py-4 sm:px-6 text-right whitespace-nowrap">
                      <Link
                        href={`/settings/inquiry-forms/${form.id}`}
                        data-testid={`edit-form-button-${form.id}`}
                        className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground min-h-[32px] px-3 py-1.5 shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t('list.editButton')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

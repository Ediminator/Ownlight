'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Calculator, Send, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { ProposalBuilderState, ProposalBuilderErrors } from './proposal-builder-helpers';
import { calculateProposalStateTotals } from './proposal-builder-helpers';

export interface FinancialSummarySectionProps {
  state: ProposalBuilderState;
  errors: ProposalBuilderErrors;
  locale: string;
  onSaveDraft: () => void | Promise<void>;
  onOpenSendModal: () => void | Promise<void>;
}

export function FinancialSummarySection({
  state,
  errors,
  locale,
  onSaveDraft,
  onOpenSendModal,
}: FinancialSummarySectionProps) {
  const t = useTranslations('proposals.builder');
  const totals = calculateProposalStateTotals(state);
  const isValid = !errors.title && !errors.basePackage && !errors.items && !errors.general;

  return (
    <section
      aria-labelledby="financial-section-title"
      className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6"
      data-testid="financial-summary-section"
    >
      <div className="flex flex-col gap-1 border-b border-border pb-4">
        <h2
          id="financial-section-title"
          className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
          <Calculator className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('financialSection.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('financialSection.subtitle')}</p>
      </div>

      {/* Notifications */}
      {state.saveSuccess && (
        <div
          role="status"
          data-testid="save-success-notification"
          className="flex items-center gap-2.5 p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm font-medium"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t('financialSection.saveSuccess')}</span>
        </div>
      )}

      {state.generalError && (
        <div
          role="alert"
          data-testid="general-error-notification"
          className="flex items-center gap-2.5 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 text-sm font-medium"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span>{state.generalError}</span>
        </div>
      )}

      {/* Summary Card */}
      <div
        className="rounded-lg bg-muted/40 border border-border p-5 space-y-3.5"
        data-testid="financial-summary-card"
      >
        {/* Subtotal */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">
            {state.pricesIncludeTax
              ? t('financialSection.subtotal')
              : t('financialSection.netSubtotal')}
          </span>
          <span className="font-medium text-foreground" data-testid="financial-summary-subtotal">
            {formatCurrency(totals.subtotalMinor, state.currency, locale)}
          </span>
        </div>

        {/* Kleinunternehmer Notice or VAT Breakdown */}
        {state.isKleinunternehmer ? (
          <div
            className="text-xs text-muted-foreground italic bg-background p-2.5 rounded border border-border"
            data-testid="kleinunternehmer-notice"
          >
            <span className="font-semibold block not-italic text-foreground">
              {t('financialSection.kleinunternehmerNotice')}
            </span>
            {state.taxNotice ?? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'}
          </div>
        ) : (
          totals.breakdown.map((rate) => (
            <div
              key={rate.taxRateBasisPoints}
              className="flex justify-between items-center text-xs text-muted-foreground"
              data-testid={`tax-breakdown-rate-${String(rate.taxRateBasisPoints)}`}
            >
              <span>{t('financialSection.taxAtRate', { rate: rate.taxRatePercentFormatted })}</span>
              <span>{formatCurrency(rate.taxMinor, state.currency, locale)}</span>
            </div>
          ))
        )}

        {/* Total VAT */}
        {!state.isKleinunternehmer && (
          <div className="flex justify-between items-center text-sm pt-1 border-t border-border/50">
            <span className="text-muted-foreground">{t('financialSection.tax')}</span>
            <span className="font-medium text-foreground" data-testid="financial-summary-tax">
              {formatCurrency(totals.taxMinor, state.currency, locale)}
            </span>
          </div>
        )}

        {/* Total Amount */}
        <div className="flex justify-between items-center text-base sm:text-lg font-bold pt-2 border-t border-border">
          <span className="text-foreground">{t('financialSection.total')}</span>
          <span
            className="text-primary font-mono tracking-tight"
            data-testid="financial-summary-total"
          >
            {formatCurrency(totals.totalMinor, state.currency, locale)}
          </span>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          data-testid="save-draft-btn"
          disabled={!isValid || state.isSaving}
          onClick={() => {
            void onSaveDraft();
          }}
          className="flex items-center justify-center gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {state.isSaving ? t('financialSection.saving') : t('financialSection.saveDraft')}
        </Button>

        <Button
          type="button"
          data-testid="open-send-proposal-btn"
          disabled={!isValid || state.isSaving || state.isSending}
          onClick={() => {
            void onOpenSendModal();
          }}
          className="flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {t('financialSection.sendProposal')}
        </Button>
      </div>
    </section>
  );
}

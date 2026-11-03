'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  Clock,
  Ban,
  PackageCheck,
  Building2,
  Calendar,
  Check,
  Plus,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type PublicLineItem,
  type ClientItemSelection,
  resolveProposalLifecycleState,
  formatProposalCurrency,
  formatProposalDate,
  calculateLiveTotals,
  createProposalViewController,
} from './public-proposal-helpers';
import { AcceptProposalModal } from './accept-proposal-modal';
import { acceptProposalAction } from '@/server/proposals/public-actions';

export interface PublicProposalViewProps {
  proposal: {
    id: string;
    title: string;
    status: string;
    currency: string;
    subtotalMinor: number;
    taxMinor: number;
    totalMinor: number;
    pricesIncludeTax: boolean;
    isKleinunternehmer: boolean;
    taxNotice?: string | null;
    validUntil?: string | null;
    tokenRevokedAt?: string | null;
    acceptedAt?: string | null;
    acceptedByName?: string | null;
    acceptedByEmail?: string | null;
    lineItems: PublicLineItem[];
  };
  studioName: string;
  token: string;
  locale: string;
  clientContactName?: string;
  clientContactEmail?: string;
}

export function PublicProposalView({
  proposal,
  studioName,
  token,
  locale,
  clientContactName = '',
  clientContactEmail = '',
}: PublicProposalViewProps) {
  const t = useTranslations('proposals.public');
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  // Initialize line items selection state
  const initialSelections = React.useMemo(() => {
    const map: Record<string, ClientItemSelection> = {};
    for (const item of proposal.lineItems) {
      map[item.id] = {
        isSelected: item.isSelected,
        quantity: item.quantity,
      };
    }
    return map;
  }, [proposal.lineItems]);

  const [selections, setSelections] =
    React.useState<Record<string, ClientItemSelection>>(initialSelections);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = React.useState(proposal.status);
  const [acceptedDetails, setAcceptedDetails] = React.useState<{
    acceptedAt?: string | null;
    acceptedByName?: string | null;
    acceptedByEmail?: string | null;
  } | null>(
    proposal.status === 'accepted'
      ? {
          acceptedAt: proposal.acceptedAt,
          acceptedByName: proposal.acceptedByName,
          acceptedByEmail: proposal.acceptedByEmail,
        }
      : null,
  );

  // Real-time calculation of monetary totals
  const liveTotals = React.useMemo(() => {
    return calculateLiveTotals(proposal.lineItems, selections, {
      pricesIncludeTax: proposal.pricesIncludeTax,
      isKleinunternehmer: proposal.isKleinunternehmer,
    });
  }, [proposal.lineItems, selections, proposal.pricesIncludeTax, proposal.isKleinunternehmer]);

  const lifecycleState = resolveProposalLifecycleState({
    status: currentStatus,
    tokenRevokedAt: proposal.tokenRevokedAt,
    validUntil: proposal.validUntil,
  });

  const formattedTotal = formatProposalCurrency(liveTotals.totalMinor, proposal.currency, locale);

  // Group line items
  const basePackages = proposal.lineItems.filter((i) => i.itemType === 'base_package');
  const addons = proposal.lineItems.filter((i) => i.itemType !== 'base_package');

  const controller = React.useMemo(() => {
    return createProposalViewController({
      token,
      lineItems: proposal.lineItems,
      setSelections,
      setIsSubmitting,
      setServerError,
      setModalOpen,
      setCurrentStatus,
      setAcceptedDetails,
      acceptAction: acceptProposalAction,
    });
  }, [token, proposal.lineItems]);

  const handleModalSubmit = React.useCallback(
    async (formData: { name: string; email: string }) => {
      await controller.handleAcceptSubmit(formData, selections);
    },
    [controller, selections],
  );

  return (
    <div
      data-testid="public-proposal-view"
      className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8"
    >
      {/* Studio Brand Header */}
      <header className="border-b border-border/40 pb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-sm tracking-wide uppercase">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <span>{studioName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {proposal.title}
            </h1>
            <span
              data-testid="proposal-lifecycle-badge"
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                lifecycleState === 'accepted'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : lifecycleState === 'expired' || lifecycleState === 'revoked'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-primary/10 text-primary'
              }`}
            >
              {lifecycleState === 'accepted'
                ? t('statusAccepted')
                : lifecycleState === 'expired'
                  ? t('statusExpired')
                  : lifecycleState === 'revoked'
                    ? t('statusRevoked')
                    : t('statusActive')}
            </span>
          </div>
        </div>

        {proposal.validUntil && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full self-start sm:self-auto border border-border/50">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t('validUntil', {
                date: formatProposalDate(proposal.validUntil, locale),
              })}
            </span>
          </div>
        )}
      </header>

      {/* State Banners */}
      {lifecycleState === 'revoked' && (
        <div
          data-testid="proposal-revoked-banner"
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-3">
            <Ban
              className="h-5 w-5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold">{t('proposalRevokedBanner')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {t('proposalRevokedNotice')}
              </p>
            </div>
          </div>
        </div>
      )}

      {lifecycleState === 'expired' && (
        <div
          data-testid="proposal-expired-banner"
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
        >
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">{t('proposalExpiredBanner')}</h2>
              <p className="mt-1 text-xs leading-relaxed opacity-90">
                {t('proposalExpiredNotice', {
                  date: formatProposalDate(proposal.validUntil ?? '', locale),
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {lifecycleState === 'accepted' && (
        <div
          data-testid="proposal-accepted-banner"
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-200"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="h-5 w-5 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold">{t('proposalAcceptedBanner')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                {t('proposalAcceptedNotice', {
                  date: formatProposalDate(acceptedDetails?.acceptedAt ?? new Date(), locale),
                  name: acceptedDetails?.acceptedByName ?? '',
                  email: acceptedDetails?.acceptedByEmail ?? '',
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Screen Reader Live Recalculation Region (WCAG 4.1.3) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {t('totalAmount')}: {formattedTotal}
      </div>

      {/* Base Package Section */}
      {basePackages.length > 0 && (
        <section aria-labelledby="base-package-heading" className="space-y-4">
          <h2
            id="base-package-heading"
            className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2"
          >
            <PackageCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>{t('basePackageTitle')}</span>
          </h2>

          <div className="space-y-3">
            {basePackages.map((pkg) => (
              <div
                key={pkg.id}
                data-testid={`base-package-${pkg.id}`}
                className="rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{pkg.name}</h3>
                    {pkg.description && (
                      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                        {pkg.description}
                      </p>
                    )}
                  </div>
                  <div className="sm:text-right shrink-0">
                    <span className="text-base font-bold text-foreground">
                      {formatProposalCurrency(
                        pkg.unitPriceMinor * pkg.quantity,
                        proposal.currency,
                        locale,
                      )}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {pkg.quantity > 1
                        ? `${String(pkg.quantity)} × ${formatProposalCurrency(pkg.unitPriceMinor, proposal.currency, locale)}`
                        : t('included')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Optional Add-ons Section */}
      {addons.length > 0 && (
        <section aria-labelledby="addons-heading" className="space-y-4">
          <div>
            <h2
              id="addons-heading"
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              {t('addonsTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('addonsSubtitle')}</p>
          </div>

          <div className="divide-y divide-border/60 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            {addons.map((addon) => {
              const selection = selections[addon.id] ?? {
                isSelected: addon.isSelected,
                quantity: addon.quantity,
              };
              const isInteractive = lifecycleState === 'active' && addon.isOptional;
              const isChecked = addon.isOptional ? selection.isSelected : true;
              const currentQty = addon.isOptional ? selection.quantity : addon.quantity;

              return (
                <div
                  key={addon.id}
                  data-testid={`addon-row-${addon.id}`}
                  className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors ${
                    isChecked ? 'bg-primary/[0.02]' : 'opacity-80'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {addon.isOptional ? (
                      <div className="pt-0.5">
                        <input
                          id={`addon-toggle-${addon.id}`}
                          type="checkbox"
                          data-item-id={addon.id}
                          data-testid={`addon-checkbox-${addon.id}`}
                          checked={isChecked}
                          disabled={!isInteractive}
                          onChange={controller.handleToggleAddonById}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary disabled:opacity-50 cursor-pointer"
                        />
                      </div>
                    ) : (
                      <div className="pt-0.5">
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </span>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor={`addon-toggle-${addon.id}`}
                        className={`text-sm font-medium ${
                          isInteractive ? 'cursor-pointer text-foreground' : 'text-foreground'
                        }`}
                      >
                        {addon.name}
                      </label>
                      {addon.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                          {addon.description}
                        </p>
                      )}
                      {!addon.isOptional && (
                        <span className="mt-1 inline-block text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          {t('included')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-6 sm:shrink-0 pl-7 sm:pl-0">
                    {/* Quantity controls if maxQuantity > 1 */}
                    {addon.maxQuantity > 1 && isInteractive && isChecked && (
                      <div className="flex items-center gap-1.5 border border-border/80 rounded-md p-1 bg-background">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          data-item-id={addon.id}
                          data-testid="addon-qty-decrease"
                          disabled={currentQty <= addon.minQuantity}
                          onClick={controller.handleDecreaseQuantity}
                          className="h-6 w-6"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">Decrease quantity</span>
                        </Button>
                        <span
                          data-testid={`addon-quantity-${addon.id}`}
                          className="w-6 text-center text-xs font-semibold text-foreground"
                        >
                          {currentQty}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          data-item-id={addon.id}
                          data-testid="addon-qty-increase"
                          disabled={currentQty >= addon.maxQuantity}
                          onClick={controller.handleIncreaseQuantity}
                          className="h-6 w-6"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">Increase quantity</span>
                        </Button>
                      </div>
                    )}

                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground">
                        {formatProposalCurrency(
                          addon.unitPriceMinor * (isChecked ? currentQty : 1),
                          proposal.currency,
                          locale,
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {currentQty > 1 && isChecked
                          ? `${String(currentQty)} × ${formatProposalCurrency(addon.unitPriceMinor, proposal.currency, locale)}`
                          : formatProposalCurrency(addon.unitPriceMinor, proposal.currency, locale)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Commercial Summary Card */}
      <section
        aria-labelledby="pricing-summary-heading"
        className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4"
      >
        <h2
          id="pricing-summary-heading"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {t('pricingSummaryTitle')}
        </h2>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t('subtotal')}</span>
            <span data-testid="summary-subtotal" className="font-medium text-foreground">
              {formatProposalCurrency(liveTotals.subtotalMinor, proposal.currency, locale)}
            </span>
          </div>

          {/* §19 UStG or VAT Breakdown */}
          {proposal.isKleinunternehmer ? (
            <div className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded border border-border/40">
              {proposal.taxNotice ?? t('kleinunternehmerNotice')}
            </div>
          ) : (
            liveTotals.breakdown.map((rate) => (
              <div
                key={rate.taxRateBasisPoints}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span>{t('vatRate', { rate: rate.taxRatePercentFormatted })}</span>
                <span className="font-medium text-foreground">
                  {formatProposalCurrency(rate.taxMinor, proposal.currency, locale)}
                </span>
              </div>
            ))
          )}

          <div className="border-t border-border pt-3 flex items-baseline justify-between">
            <div>
              <span className="text-base font-bold text-foreground">{t('totalAmount')}</span>
              <p className="text-xs text-muted-foreground">
                {proposal.pricesIncludeTax ? t('pricesIncludeTax') : t('pricesExcludeTax')}
              </p>
            </div>
            <span
              data-testid="summary-total"
              className="text-2xl font-bold tracking-tight text-foreground"
            >
              {formattedTotal}
            </span>
          </div>
        </div>

        {/* Action Button */}
        {lifecycleState === 'active' && (
          <div className="pt-2">
            <Button
              ref={triggerRef}
              type="button"
              data-testid="accept-proposal-btn"
              onClick={controller.handleOpenModal}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-base font-semibold py-6 shadow-md"
            >
              {t('acceptProposalButton')}
            </Button>
          </div>
        )}
      </section>

      {/* Studio Support Footer */}
      <footer className="text-center text-xs text-muted-foreground pt-4 border-t border-border/40">
        <p>{t('studioContact', { studioName })}</p>
      </footer>

      {/* Acceptance Modal */}
      <AcceptProposalModal
        isOpen={modalOpen}
        onClose={controller.handleCloseModal}
        triggerRef={triggerRef}
        proposalTitle={proposal.title}
        formattedTotal={formattedTotal}
        isSubmitting={isSubmitting}
        serverError={serverError}
        defaultName={clientContactName}
        defaultEmail={clientContactEmail}
        onSubmit={handleModalSubmit}
      />
    </div>
  );
}

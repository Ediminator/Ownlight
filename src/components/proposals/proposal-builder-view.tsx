'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ChevronRight, FileText, User } from 'lucide-react';
import { saveDraftProposalAction, sendProposalAction } from '@/server/proposals/actions';
import type { ProposalWithLineItems } from '@/server/proposals/repo';
import type { PackageWithIncludedItems } from '@/server/packages/repo';
import type { CatalogueItem } from '@/server/db/schema/packages';
import type { StudioSettings } from '@/server/db/schema/studio-settings';
import {
  createInitialProposalState,
  proposalBuilderReducer,
  validateProposalForm,
  createProposalBuilderActionHandlers,
  createProposalBuilderViewHandlers,
} from './proposal-builder-helpers';
import { PackageSelectorSection } from './package-selector-section';
import { AddonOptionsSection } from './addon-options-section';
import { FinancialSummarySection } from './financial-summary-section';
import { SendProposalModal } from './send-proposal-modal';

export interface ProposalBuilderViewProps {
  project: {
    id: string;
    title: string;
    projectTypeKey?: string | null;
    currency?: string;
  };
  client: {
    id: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
  };
  packages: PackageWithIncludedItems[];
  catalogueItems: CatalogueItem[];
  studioSettings: StudioSettings;
  proposal?: ProposalWithLineItems | null;
  locale?: string;
}

export function ProposalBuilderView({
  project,
  client,
  packages,
  catalogueItems,
  studioSettings,
  proposal,
  locale = 'en',
}: ProposalBuilderViewProps) {
  const t = useTranslations('proposals.builder');
  const router = useRouter();
  const sendButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const [state, dispatch] = React.useReducer(
    proposalBuilderReducer,
    {
      project,
      client,
      studioSettings: {
        currency: studioSettings.currency,
        isKleinunternehmer: studioSettings.is_kleinunternehmer,
        pricesIncludeTax: studioSettings.prices_include_tax,
        defaultTaxRateBasisPoints: studioSettings.default_tax_rate_basis_points,
        kleinunternehmerNotice: studioSettings.kleinunternehmer_notice,
      },
      packages,
      proposal,
    },
    createInitialProposalState,
  );

  const { errors } = validateProposalForm(state, t);

  const actionHandlers = createProposalBuilderActionHandlers({
    state,
    dispatch,
    t,
    router,
    locale,
    saveDraftAction: saveDraftProposalAction,
    sendAction: sendProposalAction,
  });

  const viewHandlers = createProposalBuilderViewHandlers(dispatch);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12" data-testid="proposal-builder-view">
      {/* Breadcrumb Navigation */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/projects"
          data-testid="breadcrumb-projects"
          className="hover:text-foreground transition-colors"
        >
          {t('projectLabel')}
        </Link>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <Link
          href={`/projects/${project.id}`}
          data-testid="breadcrumb-project-detail"
          className="hover:text-foreground transition-colors truncate max-w-xs"
        >
          {project.title}
        </Link>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <span className="text-foreground font-medium truncate max-w-xs">
          {state.id ? t('editTitle') : t('newProposal')}
        </span>
      </nav>

      {/* Top Header Card: Title, Status, and Client Info */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {state.id ? t('editTitle') : t('title')}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t('projectLabel')}:{' '}
                <span className="font-medium text-foreground">{project.title}</span>
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              data-testid="proposal-status-badge"
              className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                state.status === 'sent'
                  ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                  : state.status === 'accepted'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {t(`status.${state.status}`)}
            </span>
            {state.isKleinunternehmer && (
              <span
                data-testid="kleinunternehmer-badge"
                className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
              >
                {t('kleinunternehmerBadge')}
              </span>
            )}
          </div>
        </div>

        {/* Client & Title Input Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {/* Proposal Title Input */}
          <div className="md:col-span-2 space-y-1.5">
            <label
              htmlFor="proposal-title-input"
              className="block text-sm font-medium text-foreground"
            >
              {t('proposalTitleLabel')}
            </label>
            <input
              id="proposal-title-input"
              data-testid="proposal-title-input"
              type="text"
              placeholder={t('proposalTitlePlaceholder')}
              value={state.title}
              onChange={viewHandlers.handleTitleInputChange}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'proposal-title-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
            />
            {errors.title && (
              <p
                id="proposal-title-error"
                role="alert"
                data-testid="proposal-title-error"
                className="text-xs text-red-600 dark:text-red-400 font-medium"
              >
                {errors.title}
              </p>
            )}
          </div>

          {/* Client Recipient Summary Card */}
          <div
            className="rounded-lg bg-muted/30 border border-border p-3 space-y-1 text-xs"
            data-testid="client-review-card"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('clientLabel')}</span>
            </div>
            <p
              className="font-semibold text-foreground text-sm truncate"
              data-testid="proposal-client-name"
            >
              {client.displayName}
            </p>
            {client.email && (
              <p className="text-muted-foreground truncate" data-testid="client-email">
                {client.email}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 1. Base Service Package Section */}
      <PackageSelectorSection
        packages={packages}
        selectedPackageId={state.selectedPackageId}
        basePackageItem={state.basePackageItem}
        deliverables={state.deliverables}
        currency={state.currency}
        locale={locale}
        errors={errors}
        projectTypeKey={project.projectTypeKey}
        onSelectPackage={viewHandlers.onSelectPackage}
        onUpdateBasePrice={viewHandlers.onUpdateBasePrice}
        onUpdateTaxRate={viewHandlers.onUpdateTaxRate}
        onAddDeliverable={viewHandlers.onAddDeliverable}
        onUpdateDeliverableTitle={viewHandlers.onUpdateDeliverableTitle}
        onUpdateDeliverableQty={viewHandlers.onUpdateDeliverableQty}
        onRemoveDeliverable={viewHandlers.onRemoveDeliverable}
      />

      {/* 2. Add-on Options & Custom Items Section */}
      <AddonOptionsSection
        catalogueItems={catalogueItems}
        addonItems={state.addonItems}
        currency={state.currency}
        locale={locale}
        errors={errors}
        onAddCatalogueItem={viewHandlers.onAddCatalogueItem}
        onAddCustomItem={viewHandlers.onAddCustomItem}
        onUpdateItemField={viewHandlers.onUpdateItemField}
        onMoveItem={viewHandlers.onMoveItem}
        onRemoveItem={viewHandlers.onRemoveItem}
      />

      {/* 3. Commercial Summary & Dispatch Section */}
      <FinancialSummarySection
        state={state}
        errors={errors}
        locale={locale}
        onSaveDraft={actionHandlers.onSaveDraft}
        onOpenSendModal={actionHandlers.onOpenSendModal}
      />

      {/* Single Modal: Send Proposal */}
      <SendProposalModal
        state={state}
        errors={errors}
        triggerRef={sendButtonRef}
        onClose={viewHandlers.onCloseSendModal}
        onDateChange={viewHandlers.onSendDateChange}
        onEmailChange={viewHandlers.onSendEmailChange}
        onSubmit={actionHandlers.onSubmitSendProposal}
        onCopyLink={actionHandlers.onCopyLink}
      />
    </div>
  );
}

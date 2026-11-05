'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText, Plus, Pencil, Copy, Check, Ban, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ProjectDetailProposal } from '@/server/projects/service';
import {
  getProposalStatusBadgeClasses,
  formatProposalDate,
  isProposalLinkActive,
  isProposalLinkRevoked,
  isDraftProposal,
  useProposalsSectionController,
} from './proposals-section-helpers';
import { RevokeProposalDialog } from './revoke-proposal-dialog';

export interface ProposalsSectionProps {
  projectId: string;
  initialProposals: ProjectDetailProposal[];
  locale: string;
  onProposalsChange?: (proposals: ProjectDetailProposal[]) => void;
  controllerOverride?: ReturnType<typeof useProposalsSectionController>;
}

export function ProposalsSection({
  projectId,
  initialProposals,
  locale,
  onProposalsChange,
  controllerOverride,
}: ProposalsSectionProps) {
  const t = useTranslations('projects.detail.proposals');

  const [proposals, setProposals] = React.useState<ProjectDetailProposal[]>(initialProposals);

  const defaultController = useProposalsSectionController({
    proposals,
    setProposals,
    onProposalsChange,
    fallbackRevokeError: t('actions.revokeError'),
  });

  const {
    copiedProposalId,
    revokingProposal,
    isRevoking,
    revokeError,
    revokeTriggerRef,
    viewController,
    handleCloseRevoke,
    handleConfirmRevoke,
  } = controllerOverride ?? defaultController;

  return (
    <section
      data-testid="project-proposals-section"
      className="rounded-xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-6"
      aria-labelledby="proposals-section-heading"
    >
      {/* Section Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2
              id="proposals-section-heading"
              className="text-lg font-bold tracking-tight text-foreground sm:text-xl"
            >
              {t('title')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>

        <Link
          href={`/${locale}/projects/${projectId}/proposals/new`}
          data-testid="new-proposal-btn"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[36px]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('newProposal')}</span>
        </Link>
      </div>

      {/* Proposals List or Empty State */}
      {proposals.length === 0 ? (
        <div
          data-testid="proposals-empty-state"
          className="rounded-lg border border-dashed border-border p-8 text-center space-y-3"
        >
          <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t('empty')}</p>
          <Link
            href={`/${locale}/projects/${projectId}/proposals/new`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline min-h-[44px] sm:min-h-[32px]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{t('newProposal')}</span>
          </Link>
        </div>
      ) : (
        <div data-testid="proposals-list" className="space-y-3">
          {proposals.map((proposal) => {
            const isCopied = copiedProposalId === proposal.id;
            const canCopy = isProposalLinkActive(proposal);
            const isRevoked = isProposalLinkRevoked(proposal);
            const isDraft = isDraftProposal(proposal);
            const badgeClasses = getProposalStatusBadgeClasses(proposal.status);
            const formattedTotal = formatCurrency(proposal.totalMinor, proposal.currency, locale);

            return (
              <div
                key={proposal.id}
                data-testid={`proposal-item-${proposal.id}`}
                className="rounded-lg border border-border bg-background p-4 sm:p-5 transition-colors hover:border-border/80 space-y-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Title & Metadata */}
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid={`proposal-status-badge-${proposal.id}`}
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
                          badgeClasses,
                        )}
                      >
                        {t(`statuses.${proposal.status}`)}
                      </span>

                      <span
                        data-testid={`proposal-version-${proposal.id}`}
                        className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        {t('version', { version: proposal.version })}
                      </span>

                      {isRevoked && (
                        <span
                          data-testid={`proposal-link-revoked-badge-${proposal.id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive border border-destructive/20"
                        >
                          <Ban className="h-3 w-3" aria-hidden="true" />
                          <span>{t('actions.linkRevoked')}</span>
                        </span>
                      )}
                    </div>

                    <h3
                      data-testid={`proposal-title-${proposal.id}`}
                      className="text-base font-semibold text-foreground break-words"
                    >
                      {proposal.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span
                        data-testid={`proposal-created-at-${proposal.id}`}
                        className="flex items-center gap-1"
                      >
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {t('createdAt', {
                            date: formatProposalDate(proposal.createdAt, locale),
                          })}
                        </span>
                      </span>

                      <span data-testid={`proposal-validity-${proposal.id}`}>
                        {proposal.status === 'accepted' && proposal.acceptedAt
                          ? t('acceptedOn', {
                              date: formatProposalDate(proposal.acceptedAt, locale),
                            })
                          : proposal.validUntil
                            ? t('validUntil', {
                                date: formatProposalDate(proposal.validUntil, locale),
                              })
                            : t('noExpiration')}
                      </span>
                    </div>
                  </div>

                  {/* Financial Total */}
                  <div className="sm:text-right shrink-0">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">
                      {t('total')}
                    </div>
                    <div
                      data-testid={`proposal-total-${proposal.id}`}
                      className="text-lg font-bold text-foreground sm:text-xl"
                    >
                      {formattedTotal}
                    </div>
                  </div>
                </div>

                {/* Quick Actions Footer */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/60">
                  {/* Draft proposals: Edit Draft */}
                  {isDraft && (
                    <Link
                      href={`/${locale}/projects/${projectId}/proposals/${proposal.id}`}
                      data-testid={`edit-draft-proposal-btn-${proposal.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] sm:min-h-[32px]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('actions.editDraft')}</span>
                    </Link>
                  )}

                  {/* Sent proposals: Copy Public Link */}
                  {canCopy && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`proposal-copy-link-btn-${proposal.id}`}
                      onClick={viewController.handleCopyClick(proposal)}
                      className="min-h-[44px] sm:min-h-[32px] text-xs gap-1.5"
                    >
                      {isCopied ? (
                        <>
                          <Check
                            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                            aria-hidden="true"
                          />
                          <span
                            data-testid="link-copied-feedback"
                            className="text-emerald-600 dark:text-emerald-400 font-semibold"
                          >
                            {t('actions.linkCopied')}
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{t('actions.copyPublicLink')}</span>
                        </>
                      )}
                    </Button>
                  )}

                  {/* Sent proposals with active link: Revoke Link */}
                  {proposal.status === 'sent' && !isRevoked && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`proposal-revoke-link-btn-${proposal.id}`}
                      onClick={viewController.handleRevokeClick(proposal)}
                      className="min-h-[44px] sm:min-h-[32px] text-xs gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('actions.revokeLink')}</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Revoke Link Confirmation Dialog (WCAG 2.4.3 focus restored to trigger) */}
      <RevokeProposalDialog
        proposal={revokingProposal}
        isOpen={Boolean(revokingProposal)}
        isRevoking={isRevoking}
        revokeError={revokeError}
        triggerRef={revokeTriggerRef}
        onClose={handleCloseRevoke}
        onConfirm={handleConfirmRevoke}
      />
    </section>
  );
}

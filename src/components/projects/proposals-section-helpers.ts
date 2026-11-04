import * as React from 'react';
import type { ProposalStatus } from '@/server/db/schema/proposals';
import type { ProjectDetailProposal } from '@/server/projects/service';
import { revokeProposalTokenAction, getProposalPublicLinkAction } from '@/server/proposals/actions';

/**
 * Returns semantic Tailwind color classes for proposal status badges (AC-1).
 */
export function getProposalStatusBadgeClasses(status: ProposalStatus): string {
  switch (status) {
    case 'accepted':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
    case 'sent':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
    case 'declined':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
    case 'expired':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'superseded':
      return 'bg-muted text-muted-foreground border-border';
    case 'draft':
    default:
      return 'bg-secondary text-secondary-foreground border-border';
  }
}

/**
 * Formats a proposal date using Intl.DateTimeFormat (AC-1, AC-5).
 */
export function formatProposalDate(date: Date | string | null | undefined, locale: string): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Determines whether a proposal's public link is active and copyable (AC-2).
 */
export function isProposalLinkActive(proposal: ProjectDetailProposal): boolean {
  return proposal.status === 'sent' && !proposal.tokenRevokedAt && Boolean(proposal.publicUrl);
}

/**
 * Determines whether a proposal's public link has been revoked (AC-3).
 */
export function isProposalLinkRevoked(proposal: ProjectDetailProposal): boolean {
  return Boolean(proposal.tokenRevokedAt);
}

/**
 * Determines whether a proposal is an editable draft.
 */
export function isDraftProposal(proposal: ProjectDetailProposal): boolean {
  return proposal.status === 'draft';
}

/**
 * Resolves a full public URL from a pathname token (e.g. /p/[token]) and origin (AC-2).
 */
export function resolvePublicTokenUrl(
  publicUrl: string | null | undefined,
  origin?: string,
): string {
  if (!publicUrl) return '';
  if (publicUrl.startsWith('/') && origin) {
    const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    return `${cleanOrigin}${publicUrl}`;
  }
  return publicUrl;
}

/**
 * Safely copies text to the system clipboard, handling headless / permission edge cases.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const clipboard = (navigator as unknown as { clipboard?: Clipboard }).clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Controller logic for resolving and copying a proposal's public URL (AC-2).
 */
export async function executeCopyProposalLink(
  proposal: ProjectDetailProposal,
  origin: string,
  fetchLinkAction?: (input: { proposalId: string }) => Promise<{
    success: boolean;
    data?: { tokenUrl: string };
  }>,
): Promise<string | null> {
  let urlToCopy = proposal.publicUrl;
  if (!urlToCopy && fetchLinkAction) {
    const res = await fetchLinkAction({ proposalId: proposal.id });
    if (res.success && res.data?.tokenUrl) {
      urlToCopy = res.data.tokenUrl;
    }
  }

  if (!urlToCopy) return null;

  const fullUrl = resolvePublicTokenUrl(urlToCopy, origin);
  await copyToClipboard(fullUrl);
  return fullUrl;
}

/**
 * Controller logic for revoking a proposal's public link (AC-3).
 */
export async function executeRevokeProposalLink(
  proposalId: string,
  currentProposals: ProjectDetailProposal[],
  revokeAction: (input: { proposalId: string }) => Promise<{
    success: boolean;
    data?: { revokedAt: Date };
    error?: string;
  }>,
  fallbackErrorMessage = 'Failed to revoke proposal link',
): Promise<{
  success: boolean;
  error?: string;
  updatedProposals?: ProjectDetailProposal[];
}> {
  const res = await revokeAction({ proposalId });
  if (!res.success || !res.data) {
    return { success: false, error: res.error ?? fallbackErrorMessage };
  }

  const revokedAt = res.data.revokedAt;
  const updatedProposals = currentProposals.map((p) => {
    if (p.id === proposalId) {
      return {
        ...p,
        tokenRevokedAt: revokedAt,
        publicUrl: null,
      };
    }
    return p;
  });

  return {
    success: true,
    updatedProposals,
  };
}

/**
 * Event-handler controller for RevokeProposalDialog (Rule 4).
 */
export function createRevokeProposalDialogController(
  onClose: () => void,
  onConfirm: () => void | Promise<void>,
  triggerRef?: React.RefObject<HTMLElement | null>,
) {
  return {
    handleOpenChange: (open: boolean) => {
      if (!open) onClose();
    },
    handleCloseAutoFocus: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      triggerRef?.current?.focus();
    },
    handleConfirmClick: () => {
      void onConfirm();
    },
    handleCancelClick: () => {
      onClose();
    },
  };
}

/**
 * Event-handler controller for ProposalsSection action triggers (Rule 4).
 */
export function createProposalsSectionViewController(
  onCopy: (proposal: ProjectDetailProposal) => void,
  onOpenRevoke: (proposal: ProjectDetailProposal, e: React.MouseEvent<HTMLButtonElement>) => void,
) {
  return {
    handleCopyClick: (proposal: ProjectDetailProposal) => () => {
      onCopy(proposal);
    },
    handleRevokeClick:
      (proposal: ProjectDetailProposal) => (e: React.MouseEvent<HTMLButtonElement>) => {
        onOpenRevoke(proposal, e);
      },
  };
}

export interface UseProposalsSectionControllerParams {
  proposals: ProjectDetailProposal[];
  setProposals: React.Dispatch<React.SetStateAction<ProjectDetailProposal[]>>;
  onProposalsChange?: (proposals: ProjectDetailProposal[]) => void;
  fallbackRevokeError: string;
}

export interface ProposalsSectionController {
  copiedProposalId: string | null;
  revokingProposal: ProjectDetailProposal | null;
  isRevoking: boolean;
  revokeError: string | null;
  revokeTriggerRef: React.RefObject<HTMLButtonElement | null>;
  viewController: {
    handleCopyClick: (proposal: ProjectDetailProposal) => () => void;
    handleRevokeClick: (
      proposal: ProjectDetailProposal,
    ) => (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
  handleCloseRevoke: () => void;
  handleConfirmRevoke: (targetProposal?: ProjectDetailProposal | null) => Promise<void>;
  handleCopyLink: (proposal: ProjectDetailProposal) => Promise<void>;
  handleOpenRevoke: (
    proposal: ProjectDetailProposal,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}

/**
 * Hook extracting stateful controller handlers from ProposalsSection (Rule 4).
 */
export function useProposalsSectionController({
  proposals,
  setProposals,
  onProposalsChange,
  fallbackRevokeError,
}: UseProposalsSectionControllerParams): ProposalsSectionController {
  const [copiedProposalId, setCopiedProposalId] = React.useState<string | null>(null);
  const [revokingProposal, setRevokingProposal] = React.useState<ProjectDetailProposal | null>(
    null,
  );
  const [isRevoking, setIsRevoking] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  const revokeTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const handleCopyLink = async (proposal: ProjectDetailProposal) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const copiedUrl = await executeCopyProposalLink(proposal, origin, getProposalPublicLinkAction);
    if (copiedUrl) {
      setCopiedProposalId(proposal.id);
      setTimeout(() => {
        setCopiedProposalId((current) => (current === proposal.id ? null : current));
      }, 2500);
    }
  };

  const handleOpenRevoke = (
    proposal: ProjectDetailProposal,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    revokeTriggerRef.current = e.currentTarget;
    setRevokingProposal(proposal);
    setRevokeError(null);
  };

  const handleCloseRevoke = () => {
    setRevokingProposal(null);
    setRevokeError(null);
  };

  const handleConfirmRevoke = async (targetProposal?: ProjectDetailProposal | null) => {
    const target = targetProposal ?? revokingProposal;
    if (!target) return;
    setIsRevoking(true);
    setRevokeError(null);

    const result = await executeRevokeProposalLink(
      target.id,
      proposals,
      revokeProposalTokenAction,
      fallbackRevokeError,
    );

    setIsRevoking(false);

    if (!result.success || !result.updatedProposals) {
      setRevokeError(result.error ?? fallbackRevokeError);
      return;
    }

    setProposals(result.updatedProposals);
    onProposalsChange?.(result.updatedProposals);
    setRevokingProposal(null);
  };

  const viewController = {
    handleCopyClick: (proposal: ProjectDetailProposal) => () => {
      void handleCopyLink(proposal);
    },
    handleRevokeClick:
      (proposal: ProjectDetailProposal) => (e: React.MouseEvent<HTMLButtonElement>) => {
        handleOpenRevoke(proposal, e);
      },
  };

  return {
    copiedProposalId,
    revokingProposal,
    isRevoking,
    revokeError,
    revokeTriggerRef,
    viewController,
    handleCloseRevoke,
    handleConfirmRevoke,
    handleCopyLink,
    handleOpenRevoke,
  };
}

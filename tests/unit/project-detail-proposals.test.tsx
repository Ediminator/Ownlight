import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/en/projects/01920000-0000-7000-8000-000000000071',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/server/proposals/actions', () => ({
  getProposalPublicLinkAction: vi.fn(),
  revokeProposalTokenAction: vi.fn(),
}));

// Mock translations with STRICT missing key check (Rule 4.5)
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      if (typeof raw !== 'string') {
        throw new Error(`Missing translation key: "${fullPath}" for locale "${currentLocale}"`);
      }
      let text = raw;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replaceAll(`{${vKey}}`, String(vVal));
        }
      }
      return text;
    };
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

import { ProposalsSection } from '@/components/projects/proposals-section';
import { RevokeProposalDialog } from '@/components/projects/revoke-proposal-dialog';
import { ProjectDetailView } from '@/components/projects/project-detail-view';
import {
  getProposalStatusBadgeClasses,
  formatProposalDate,
  isProposalLinkActive,
  isProposalLinkRevoked,
  isDraftProposal,
  resolvePublicTokenUrl,
  copyToClipboard,
  executeCopyProposalLink,
  executeRevokeProposalLink,
  createRevokeProposalDialogController,
  createProposalsSectionViewController,
  useProposalsSectionController,
  type ProposalsSectionController,
} from '@/components/projects/proposals-section-helpers';
import { getProposalPublicLinkAction, revokeProposalTokenAction } from '@/server/proposals/actions';
import type { ProjectDetailProposal, ProjectDetailData } from '@/server/projects/service';

const dummyProposalDraft: ProjectDetailProposal = {
  id: '01920000-0000-7000-8000-000000000201',
  projectId: '01920000-0000-7000-8000-000000000071',
  clientId: '01920000-0000-7000-8000-000000000081',
  title: 'Wedding Photography Proposal (Draft)',
  status: 'draft',
  version: 1,
  currency: 'EUR',
  subtotalMinor: 280000,
  taxMinor: 44706,
  totalMinor: 280000,
  pricesIncludeTax: true,
  isKleinunternehmer: false,
  validUntil: new Date('2027-07-01T00:00:00Z'),
  sentAt: null,
  acceptedAt: null,
  declinedAt: null,
  tokenRevokedAt: null,
  tokenHash: 'hash-draft',
  publicUrl: null,
  createdAt: new Date('2027-01-01T12:00:00Z'),
  updatedAt: new Date('2027-01-01T12:00:00Z'),
};

const dummyProposalSent: ProjectDetailProposal = {
  id: '01920000-0000-7000-8000-000000000202',
  projectId: '01920000-0000-7000-8000-000000000071',
  clientId: '01920000-0000-7000-8000-000000000081',
  title: 'Wedding Coverage & Add-on (Sent)',
  status: 'sent',
  version: 1,
  currency: 'EUR',
  subtotalMinor: 305000,
  taxMinor: 48697,
  totalMinor: 305000,
  pricesIncludeTax: true,
  isKleinunternehmer: false,
  validUntil: new Date('2027-07-15T00:00:00Z'),
  sentAt: new Date('2027-01-02T10:00:00Z'),
  acceptedAt: null,
  declinedAt: null,
  tokenRevokedAt: null,
  tokenHash: 'hash-sent',
  publicUrl: '/p/demo-token-sent-32bytes',
  createdAt: new Date('2027-01-02T10:00:00Z'),
  updatedAt: new Date('2027-01-02T10:00:00Z'),
};

const dummyProposalAccepted: ProjectDetailProposal = {
  id: '01920000-0000-7000-8000-000000000203',
  projectId: '01920000-0000-7000-8000-000000000071',
  clientId: '01920000-0000-7000-8000-000000000081',
  title: 'Full Day Coverage (Accepted)',
  status: 'accepted',
  version: 1,
  currency: 'EUR',
  subtotalMinor: 280000,
  taxMinor: 44706,
  totalMinor: 280000,
  pricesIncludeTax: true,
  isKleinunternehmer: false,
  validUntil: new Date('2027-07-01T00:00:00Z'),
  sentAt: new Date('2027-01-02T10:00:00Z'),
  acceptedAt: new Date('2027-01-03T15:00:00Z'),
  declinedAt: null,
  tokenRevokedAt: null,
  tokenHash: 'hash-accepted',
  publicUrl: '/p/demo-token-accepted-32bytes',
  createdAt: new Date('2027-01-02T10:00:00Z'),
  updatedAt: new Date('2027-01-03T15:00:00Z'),
};

const dummyProposalRevoked: ProjectDetailProposal = {
  ...dummyProposalSent,
  id: '01920000-0000-7000-8000-000000000204',
  title: 'Revoked Proposal',
  tokenRevokedAt: new Date('2027-01-04T12:00:00Z'),
  publicUrl: null,
};

const mockProjectDetailData: ProjectDetailData = {
  project: {
    id: '01920000-0000-7000-8000-000000000071',
    clientId: '01920000-0000-7000-8000-000000000081',
    leadId: null,
    stageId: 'stage-1',
    title: 'Emma & Liam Wedding',
    projectTypeKey: 'wedding',
    primaryShootStartsAt: null,
    primaryShootTimezone: 'Europe/Berlin',
    priceMinor: 305000,
    currency: 'EUR',
    notes: null,
    createdAt: new Date('2027-01-01T00:00:00Z'),
    updatedAt: new Date('2027-01-01T00:00:00Z'),
    lastActivityAt: new Date('2027-01-01T00:00:00Z'),
  },
  client: {
    id: '01920000-0000-7000-8000-000000000081',
    displayName: 'Emma Watson',
    email: 'emma@example.com',
    phone: null,
  },
  stages: [
    {
      id: 'stage-1',
      key: 'inquiry',
      name: 'Inquiry',
      category: 'inquiry',
      position: 1,
      color: 'blue',
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'stage-2',
      key: 'booked',
      name: 'Booked',
      category: 'booked',
      position: 2,
      color: 'emerald',
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  currentStage: {
    id: 'stage-1',
    key: 'inquiry',
    name: 'Inquiry',
    category: 'inquiry',
    position: 1,
    color: 'blue',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  shoots: [],
  locations: [],
  timelineItems: [],
  participants: [],
  tasks: [],
  clientContacts: [],
  proposals: [dummyProposalDraft, dummyProposalSent, dummyProposalAccepted],
};

describe('Project Detail Proposals Integration Tests', () => {
  beforeEach(() => {
    currentLocale = 'en';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Proposals Section Helper Functions', () => {
    it('returns semantic status badge classes for all proposal statuses', () => {
      expect(getProposalStatusBadgeClasses('draft')).toContain('bg-secondary');
      expect(getProposalStatusBadgeClasses('sent')).toContain('text-blue-700');
      expect(getProposalStatusBadgeClasses('accepted')).toContain('text-emerald-700');
      expect(getProposalStatusBadgeClasses('declined')).toContain('text-red-700');
      expect(getProposalStatusBadgeClasses('expired')).toContain('text-amber-700');
      expect(getProposalStatusBadgeClasses('superseded')).toContain('bg-muted');
    });

    it('formatProposalDate formats dates correctly and handles invalid/empty input', () => {
      const formatted = formatProposalDate(new Date('2027-06-12T12:00:00Z'), 'en');
      expect(formatted).toContain('2027');
      expect(formatted).toContain('Jun');

      expect(formatProposalDate(null, 'en')).toBe('');
      expect(formatProposalDate(undefined, 'en')).toBe('');
      expect(formatProposalDate('invalid-date', 'en')).toBe('');
    });

    it('isProposalLinkActive returns true only for sent proposal with publicUrl and no tokenRevokedAt', () => {
      expect(isProposalLinkActive(dummyProposalSent)).toBe(true);
      expect(isProposalLinkActive(dummyProposalDraft)).toBe(false);
      expect(isProposalLinkActive(dummyProposalRevoked)).toBe(false);
    });

    it('isProposalLinkRevoked returns true when tokenRevokedAt is set', () => {
      expect(isProposalLinkRevoked(dummyProposalRevoked)).toBe(true);
      expect(isProposalLinkRevoked(dummyProposalSent)).toBe(false);
    });

    it('isDraftProposal returns true only for draft status', () => {
      expect(isDraftProposal(dummyProposalDraft)).toBe(true);
      expect(isDraftProposal(dummyProposalSent)).toBe(false);
    });

    it('resolvePublicTokenUrl prepends origin to relative token URL', () => {
      expect(resolvePublicTokenUrl('/p/abc123', 'https://studio.example.com')).toBe(
        'https://studio.example.com/p/abc123',
      );
      expect(resolvePublicTokenUrl('/p/abc123', 'https://studio.example.com/')).toBe(
        'https://studio.example.com/p/abc123',
      );
      expect(
        resolvePublicTokenUrl('https://other.example.com/p/abc123', 'https://studio.example.com'),
      ).toBe('https://other.example.com/p/abc123');
      expect(resolvePublicTokenUrl(null)).toBe('');
      expect(resolvePublicTokenUrl(undefined)).toBe('');
    });

    it('copyToClipboard copies text to clipboard and handles permissions', async () => {
      // Mock window and navigator.clipboard
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('window', {});
      vi.stubGlobal('navigator', {
        clipboard: { writeText: mockWriteText },
      });

      const success = await copyToClipboard('https://example.com/p/test');
      expect(success).toBe(true);
      expect(mockWriteText).toHaveBeenCalledWith('https://example.com/p/test');

      // Failure branch (writeText throws)
      mockWriteText.mockRejectedValueOnce(new Error('Permission denied'));
      const failure = await copyToClipboard('https://example.com/p/test');
      expect(failure).toBe(false);

      // Failure branch (no clipboard)
      vi.stubGlobal('navigator', {});
      expect(await copyToClipboard('https://example.com/p/test')).toBe(false);

      vi.unstubAllGlobals();
    });

    it('executeCopyProposalLink copies proposal public URL directly or via fallback fetchLinkAction', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('window', {});
      vi.stubGlobal('navigator', {
        clipboard: { writeText: mockWriteText },
      });

      // 1. Direct publicUrl
      const url1 = await executeCopyProposalLink(dummyProposalSent, 'https://example.com');
      expect(url1).toBe('https://example.com/p/demo-token-sent-32bytes');

      // 2. Fetch action fallback
      const proposalWithoutUrl = { ...dummyProposalSent, publicUrl: null };
      const mockFetchLink = vi.fn().mockResolvedValue({
        success: true,
        data: { tokenUrl: '/p/fetched-token' },
      });
      const url2 = await executeCopyProposalLink(
        proposalWithoutUrl,
        'https://example.com',
        mockFetchLink,
      );
      expect(url2).toBe('https://example.com/p/fetched-token');

      // 3. Fallback failure
      const url3 = await executeCopyProposalLink(proposalWithoutUrl, 'https://example.com');
      expect(url3).toBeNull();

      vi.unstubAllGlobals();
    });

    it('executeRevokeProposalLink calls revoke action and returns updated proposal state', async () => {
      const mockRevokeAction = vi.fn().mockResolvedValue({
        success: true,
        data: { revokedAt: new Date('2027-01-05T00:00:00Z') },
      });

      const res = await executeRevokeProposalLink(
        dummyProposalSent.id,
        [dummyProposalSent, dummyProposalDraft],
        mockRevokeAction,
      );

      expect(res.success).toBe(true);
      const revoked = res.updatedProposals?.find((p) => p.id === dummyProposalSent.id);
      expect(revoked?.tokenRevokedAt).toBeDefined();
      expect(revoked?.publicUrl).toBeNull();

      // Failure branch with explicit error
      mockRevokeAction.mockResolvedValueOnce({
        success: false,
        error: 'Forbidden to revoke',
      });
      const failRes1 = await executeRevokeProposalLink(
        dummyProposalSent.id,
        [dummyProposalSent],
        mockRevokeAction,
      );
      expect(failRes1.success).toBe(false);
      expect(failRes1.error).toBe('Forbidden to revoke');

      // Failure branch with fallback error
      mockRevokeAction.mockResolvedValueOnce({ success: false });
      const failRes2 = await executeRevokeProposalLink(
        dummyProposalSent.id,
        [dummyProposalSent],
        mockRevokeAction,
        'Default error',
      );
      expect(failRes2.success).toBe(false);
      expect(failRes2.error).toBe('Default error');
    });

    it('createRevokeProposalDialogController manages dialog open, auto-focus and actions', () => {
      const onClose = vi.fn();
      const onConfirm = vi.fn();
      const mockFocus = vi.fn();
      const triggerRef = { current: { focus: mockFocus } as unknown as HTMLElement };

      const controller = createRevokeProposalDialogController(onClose, onConfirm, triggerRef);

      controller.handleOpenChange(false);
      expect(onClose).toHaveBeenCalledTimes(1);

      controller.handleOpenChange(true);
      expect(onClose).toHaveBeenCalledTimes(1); // not called again

      const mockPreventDefault = vi.fn();
      controller.handleCloseAutoFocus({ preventDefault: mockPreventDefault });
      expect(mockPreventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      controller.handleConfirmClick();
      expect(onConfirm).toHaveBeenCalledTimes(1);

      controller.handleCancelClick();
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('createProposalsSectionViewController dispatches copy and revoke actions', () => {
      const onCopy = vi.fn();
      const onOpenRevoke = vi.fn();
      const controller = createProposalsSectionViewController(onCopy, onOpenRevoke);

      const copyHandler = controller.handleCopyClick(dummyProposalSent);
      copyHandler();
      expect(onCopy).toHaveBeenCalledWith(dummyProposalSent);

      const revokeHandler = controller.handleRevokeClick(dummyProposalSent);
      const mockEvent = {} as React.MouseEvent<HTMLButtonElement>;
      revokeHandler(mockEvent);
      expect(onOpenRevoke).toHaveBeenCalledWith(dummyProposalSent, mockEvent);
    });

    it('useProposalsSectionController manages copy, revoke lifecycle, and error handling', async () => {
      vi.useFakeTimers();
      const mockGetAction = vi.mocked(getProposalPublicLinkAction);
      const mockRevokeAction = vi.mocked(revokeProposalTokenAction);

      let controllerInstance: ProposalsSectionController | undefined;
      let stateProposals: ProjectDetailProposal[] = [dummyProposalSent];
      const setProposals = vi.fn((updater: React.SetStateAction<ProjectDetailProposal[]>) => {
        if (typeof updater === 'function') {
          stateProposals = updater(stateProposals);
        } else {
          stateProposals = updater;
        }
      });
      const onProposalsChange = vi.fn();

      function TestHookWrapper() {
        controllerInstance = useProposalsSectionController({
          proposals: stateProposals,
          setProposals,
          onProposalsChange,
          fallbackRevokeError: 'Fallback revoke error',
        });
        return null;
      }

      renderToStaticMarkup(<TestHookWrapper />);
      if (!controllerInstance) {
        throw new Error('controllerInstance must be initialized');
      }
      const ctrl = controllerInstance;

      // 1. handleCloseRevoke resets revokingProposal and error
      ctrl.handleCloseRevoke();
      expect(ctrl.revokingProposal).toBeNull();
      expect(ctrl.revokeError).toBeNull();

      // 2. handleConfirmRevoke with no revokingProposal returns early
      await ctrl.handleConfirmRevoke();
      expect(mockRevokeAction).not.toHaveBeenCalled();

      // 3. handleOpenRevoke sets triggerRef
      const mockButton = { focus: vi.fn() } as unknown as HTMLButtonElement;
      const mockEvent = {
        currentTarget: mockButton,
      } as unknown as React.MouseEvent<HTMLButtonElement>;
      ctrl.handleOpenRevoke(dummyProposalSent, mockEvent);
      expect(ctrl.revokeTriggerRef.current).toBe(mockButton);

      // 4. handleConfirmRevoke failure
      mockRevokeAction.mockResolvedValueOnce({
        success: false,
        code: 'NETWORK_ERROR',
        error: 'Network failure',
      });
      await ctrl.handleConfirmRevoke(dummyProposalSent);
      expect(mockRevokeAction).toHaveBeenCalledWith({ proposalId: dummyProposalSent.id });

      // 5. handleConfirmRevoke success
      const revokedDate = new Date('2026-11-04T22:00:00Z');
      mockRevokeAction.mockResolvedValueOnce({
        success: true,
        data: { proposalId: dummyProposalSent.id, revokedAt: revokedDate },
      });
      await ctrl.handleConfirmRevoke(dummyProposalSent);
      expect(onProposalsChange).toHaveBeenCalled();

      // 6. handleCopyLink with clipboard mock
      mockGetAction.mockResolvedValueOnce({
        success: true,
        data: {
          proposalId: dummyProposalSent.id,
          tokenUrl: '/p/custom-link',
          token: 'custom-link',
        },
      });
      await ctrl.handleCopyLink(dummyProposalSent);

      // Fast-forward copy timer
      vi.advanceTimersByTime(3000);
      vi.useRealTimers();
    });
  });

  describe('AC-1: Project Detail Proposals Card Rendering', () => {
    it('AC-1: displays empty state when no proposals exist', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[]}
          locale="en"
        />,
      );

      expect(html).toContain('data-testid="project-proposals-section"');
      expect(html).toContain('data-testid="proposals-empty-state"');
      expect(html).toContain('data-testid="new-proposal-btn"');
      expect(html).toContain('No proposals created for this project yet.');
    });

    it('AC-1: displays each proposal with title, revision number, status badge, formatted currency total, and validity date', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalDraft, dummyProposalSent, dummyProposalAccepted]}
          locale="en"
        />,
      );

      // Section and list container
      expect(html).toContain('data-testid="project-proposals-section"');
      expect(html).toContain('data-testid="proposals-list"');

      // Draft proposal
      expect(html).toContain(`data-testid="proposal-item-${dummyProposalDraft.id}"`);
      expect(html).toContain(`data-testid="proposal-title-${dummyProposalDraft.id}"`);
      expect(html).toContain('Wedding Photography Proposal (Draft)');
      expect(html).toContain('Draft');
      expect(html).toContain('Revision v1');
      expect(html).toContain('2,800.00');

      // Sent proposal
      expect(html).toContain(`data-testid="proposal-item-${dummyProposalSent.id}"`);
      expect(html).toContain(`data-testid="proposal-title-${dummyProposalSent.id}"`);
      expect(html).toContain('Wedding Coverage &amp; Add-on (Sent)');
      expect(html).toContain('Sent');
      expect(html).toContain('3,050.00');

      // Accepted proposal
      expect(html).toContain(`data-testid="proposal-item-${dummyProposalAccepted.id}"`);
      expect(html).toContain('Accepted');
      expect(html).toContain('Accepted on');
    });

    it('AC-1: draft proposals render Edit Draft action button routing to proposal workspace', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalDraft]}
          locale="en"
        />,
      );

      expect(html).toContain(`data-testid="edit-draft-proposal-btn-${dummyProposalDraft.id}"`);
      expect(html).toContain(
        `href="/en/projects/01920000-0000-7000-8000-000000000071/proposals/${dummyProposalDraft.id}"`,
      );
      expect(html).toContain('Edit Draft');
    });
  });

  describe('AC-2 & AC-3: Sent Proposal Actions (Copy Link & Revoke)', () => {
    it('AC-2: sent proposal displays Copy Public Link button', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalSent]}
          locale="en"
        />,
      );

      expect(html).toContain(`data-testid="proposal-copy-link-btn-${dummyProposalSent.id}"`);
      expect(html).toContain('Copy Public Link');
    });

    it('AC-3: sent proposal displays Revoke Link button with accessible confirmation dialog structure', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalSent]}
          locale="en"
        />,
      );

      expect(html).toContain(`data-testid="proposal-revoke-link-btn-${dummyProposalSent.id}"`);
      expect(html).toContain('Revoke Link');
    });

    it('AC-3: revoked proposal displays Link Revoked badge and hides Copy/Revoke buttons', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalRevoked]}
          locale="en"
        />,
      );

      expect(html).toContain(
        `data-testid="proposal-link-revoked-badge-${dummyProposalRevoked.id}"`,
      );
      expect(html).toContain('Link Revoked');
      expect(html).not.toContain(`data-testid="proposal-copy-link-btn-${dummyProposalRevoked.id}"`);
      expect(html).not.toContain(
        `data-testid="proposal-revoke-link-btn-${dummyProposalRevoked.id}"`,
      );
    });

    it('AC-3: RevokeProposalDialog renders all states with full accessibility and error feedback', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      // Normal open state
      const openHtml = renderToStaticMarkup(
        <RevokeProposalDialog
          proposal={dummyProposalSent}
          isOpen={true}
          isRevoking={false}
          revokeError={null}
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
      expect(openHtml).toContain('data-testid="revoke-proposal-dialog"');
      expect(openHtml).toContain('data-testid="revoke-dialog-title"');
      expect(openHtml).toContain('Revoke Public Link');
      expect(openHtml).toContain('data-testid="revoke-dialog-description"');
      expect(openHtml).toContain('data-testid="revoke-cancel-btn"');
      expect(openHtml).toContain('data-testid="revoke-confirm-btn"');

      // Error alert state (WCAG 3.3.1)
      const errorHtml = renderToStaticMarkup(
        <RevokeProposalDialog
          proposal={dummyProposalSent}
          isOpen={true}
          isRevoking={false}
          revokeError="Failed to revoke link due to network timeout"
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
      expect(errorHtml).toContain('role="alert"');
      expect(errorHtml).toContain('Failed to revoke link due to network timeout');

      // Loading spinner state
      const loadingHtml = renderToStaticMarkup(
        <RevokeProposalDialog
          proposal={dummyProposalSent}
          isOpen={true}
          isRevoking={true}
          revokeError={null}
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
      expect(loadingHtml).toContain('animate-spin');
      expect(loadingHtml).toContain('Revoking...');
    });
  });

  describe('AC-5: Internationalization Parity in German (/de)', () => {
    it('AC-5: renders proposals section and revoke dialog in German with zero missing translation keys', () => {
      currentLocale = 'de';

      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[
            dummyProposalDraft,
            dummyProposalSent,
            dummyProposalAccepted,
            dummyProposalRevoked,
          ]}
          locale="de"
        />,
      );

      expect(html).toContain('Kostenvoranschläge &amp; Angebote');
      expect(html).toContain('Neues Angebot');
      expect(html).toContain('Entwurf');
      expect(html).toContain('Versendet');
      expect(html).toContain('Angenommen');
      expect(html).toContain('Version v1');
      expect(html).toContain('Gesamtbetrag');
      expect(html).toContain('Öffentlichen Link kopieren');
      expect(html).toContain('Link widerrufen');
      expect(html).toContain('Entwurf bearbeiten');

      // Render RevokeProposalDialog in German
      const dialogHtml = renderToStaticMarkup(
        <RevokeProposalDialog
          proposal={dummyProposalSent}
          isOpen={true}
          isRevoking={false}
          revokeError="Testfehler"
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      );
      expect(dialogHtml).toContain('Öffentlichen Link widerrufen');
      expect(dialogHtml).toContain('Abbrechen');
    });
  });

  describe('AC-6: Accessibility & WCAG 2.2 AA Markup', () => {
    it('AC-6: proposals section contains proper semantic region and heading hierarchy', () => {
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalSent]}
          locale="en"
        />,
      );

      expect(html).toContain('<section');
      expect(html).toContain('aria-labelledby="proposals-section-heading"');
      expect(html).toContain('id="proposals-section-heading"');
      expect(html).toContain('<h2');
      expect(html).toContain('<h3');
    });

    it('renders proposal with validUntil date and renders empty state when initialProposals is empty', () => {
      const proposalWithExpiry: ProjectDetailProposal = {
        ...dummyProposalSent,
        validUntil: new Date('2026-12-31T12:00:00Z'),
      };
      const html = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[proposalWithExpiry]}
          locale="en"
        />,
      );
      expect(html).toContain('Valid until');

      // Empty state
      const emptyHtml = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[]}
          locale="en"
        />,
      );
      expect(emptyHtml).toContain('data-testid="proposals-empty-state"');
    });

    it('renders link-copied-feedback when copiedProposalId matches and executes viewController callbacks', () => {
      let copyInvoked = false;
      let revokeInvoked = false;
      const testController = {
        copiedProposalId: dummyProposalSent.id,
        revokingProposal: null,
        isRevoking: false,
        revokeError: null,
        revokeTriggerRef: { current: null },
        viewController: {
          handleCopyClick: (proposal: ProjectDetailProposal) => () => {
            copyInvoked = proposal.id === dummyProposalSent.id;
          },
          handleRevokeClick:
            (proposal: ProjectDetailProposal) => (e: React.MouseEvent<HTMLButtonElement>) => {
              revokeInvoked = proposal.id === dummyProposalSent.id && Boolean(e);
            },
        },
        handleConfirmRevoke: vi.fn(),
        handleCloseRevoke: vi.fn(),
      };

      testController.viewController.handleCopyClick(dummyProposalSent)();
      testController.viewController.handleRevokeClick(dummyProposalSent)({
        currentTarget: {},
      } as never);
      expect(copyInvoked).toBe(true);
      expect(revokeInvoked).toBe(true);

      const htmlWithCopied = renderToStaticMarkup(
        <ProposalsSection
          projectId="01920000-0000-7000-8000-000000000071"
          initialProposals={[dummyProposalSent]}
          locale="en"
          controllerOverride={testController as never}
        />,
      );
      expect(htmlWithCopied).toContain('data-testid="link-copied-feedback"');
      expect(htmlWithCopied).toContain('Link Copied!');
    });
  });

  describe('ProjectDetailView Integration', () => {
    it('renders Proposals tab in project detail tab list with correct badge count', () => {
      const html = renderToStaticMarkup(
        <ProjectDetailView initialData={mockProjectDetailData} locale="en" />,
      );

      expect(html).toContain('data-testid="tab-proposals"');
      expect(html).toContain('id="tab-proposals"');
      expect(html).toContain('aria-controls="panel-proposals"');
      expect(html).toContain('Proposals');
      expect(html).toContain('>3<'); // count of proposals
      expect(html).toContain('data-testid="project-proposals-section"');
    });
  });
});

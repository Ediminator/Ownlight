import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { eq, and } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { user } from '@/server/db/schema/auth';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { packages, packageIncludedItems } from '@/server/db/schema/packages';
import { proposals } from '@/server/db/schema/proposals';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { auditEvents } from '@/server/db/schema/audit';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { generateUuidV7 } from '@/lib/id';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import {
  saveDraftProposalAction,
  sendProposalAction,
  revokeProposalTokenAction,
} from '@/server/proposals/actions';
import {
  transitionProposalStatus,
  getProposalByRawToken,
  ProposalNotFoundError,
  ProposalForbiddenError,
} from '@/server/proposals/repo';
import { processEmailOutboxBatch } from '@/server/email/outbox-processor';
import * as proposalService from '@/server/proposals/service';
import { getAcceptedProposalForProject } from '@/server/proposals/service';
import { enqueueProposalAcceptedEmails } from '@/server/email/templates/proposal';

describe('TASK-0060: Proposals Email Outbox, Templates, Send & Revoke Actions Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let testClientId: string;
  let testProjectId: string;
  let testPackageId: string;
  let defaultStageId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    await seedDefaultPipelineStages(dbClient);
    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) {
      throw new Error('Default pipeline stage not found');
    }
    defaultStageId = stage.id;

    // Create Studio Settings
    await dbClient.insert(studioSettings).values({
      id: generateUuidV7(),
      studio_name: 'Solstice Light Studio',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      mfa_required: false,
    });

    // Create Studio Owner
    const [insertedOwner] = await dbClient
      .insert(user)
      .values({
        id: generateUuidV7(),
        name: 'Studio Owner',
        email: 'owner@solsticelight.com',
        role: 'owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedOwner) {
      throw new Error('Failed to create owner user');
    }
    ownerUser = insertedOwner;

    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // Create Client
    testClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: testClientId,
      kind: 'person',
      displayName: 'Sophia Loren',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(clientContacts).values({
      id: generateUuidV7(),
      clientId: testClientId,
      givenName: 'Sophia',
      familyName: 'Loren',
      email: 'sophia@example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Project
    testProjectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: testProjectId,
      clientId: testClientId,
      stageId: defaultStageId,
      title: 'Sophia Loren Portrait Commission',
      projectTypeKey: 'portrait',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Package & Deliverables
    testPackageId = generateUuidV7();
    await dbClient.insert(packages).values({
      id: testPackageId,
      name: 'Editorial Portrait Package',
      slug: 'editorial-portrait',
      basePriceMinor: 180000,
      currency: 'EUR',
      taxRateBasisPoints: 1900,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(packageIncludedItems).values([
      {
        id: generateUuidV7(),
        packageId: testPackageId,
        title: '2 Hours Studio Lighting',
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateUuidV7(),
        packageId: testPackageId,
        title: '10 Master Retouched Files',
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  // AC-8
  describe('AC-8 (R-A): saveDraftProposalAction', () => {
    it('AC-8: creates draft proposal and line items transactionally with status draft and recalculated minor totals', async () => {
      const res = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Portrait Proposal Draft',
          currency: 'EUR',
          pricesIncludeTax: true,
          isKleinunternehmer: false,
          lineItems: [
            {
              name: 'Editorial Portrait Package',
              packageId: testPackageId,
              itemType: 'base_package',
              unitPriceMinor: 180000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
            {
              name: 'Hair & Makeup Stylist',
              itemType: 'addon',
              unitPriceMinor: 35000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
          ],
        },
        dbClient,
      );

      expect(res.success).toBe(true);
      if (!res.success) return;

      expect(res.data.status).toBe('draft');
      expect(res.data.totalMinor).toBe(215000);
      expect(res.data.lineItems).toHaveLength(2);

      // Verify audit log emitted
      const [auditLog] = await dbClient
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.action, 'proposal.created'), eq(auditEvents.targetId, res.data.id)),
        )
        .limit(1);

      expect(auditLog).toBeDefined();
      expect(auditLog?.actorType).toBe('owner');
    });

    it('AC-8: updates existing draft proposal and line items transactionally, recalculating totals', async () => {
      // 1. Create initial draft
      const initial = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Initial Draft',
          lineItems: [
            {
              name: 'Initial Package',
              unitPriceMinor: 100000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        dbClient,
      );
      expect(initial.success).toBe(true);
      if (!initial.success) return;

      // 2. Update draft with new title and line items
      const updated = await saveDraftProposalAction(
        {
          id: initial.data.id,
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Updated Draft Proposal',
          lineItems: [
            {
              name: 'Updated Deluxe Package',
              unitPriceMinor: 250000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
            {
              name: 'Rush Delivery Addon',
              unitPriceMinor: 50000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        dbClient,
      );

      expect(updated.success).toBe(true);
      if (!updated.success) return;

      expect(updated.data.title).toBe('Updated Draft Proposal');
      expect(updated.data.totalMinor).toBe(300000);
      expect(updated.data.lineItems).toHaveLength(2);

      // Verify audit log emitted for update
      const [auditLog] = await dbClient
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, 'proposal.updated'),
            eq(auditEvents.targetId, initial.data.id),
          ),
        )
        .limit(1);

      expect(auditLog).toBeDefined();
    });
  });

  // AC-1 & AC-2
  describe('AC-1 & AC-2 (R-A): sendProposalAction & Email Outbox Delivery', () => {
    it('AC-1: generates 32-byte secret token, saves SHA-256 hash, updates status to sent, and enqueues proposal_sent in same transaction', async () => {
      // 1. Create draft proposal
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Proposal Ready To Send',
          lineItems: [
            {
              name: 'Portrait Package',
              unitPriceMinor: 200000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        dbClient,
      );
      expect(draftRes.success).toBe(true);
      if (!draftRes.success) return;

      const proposalId = draftRes.data.id;
      const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      // 2. Send proposal action
      const sendRes = await sendProposalAction(
        {
          proposalId,
          validUntil: validUntil.toISOString(),
        },
        dbClient,
      );

      expect(sendRes.success).toBe(true);
      if (!sendRes.success) return;

      expect(sendRes.data.proposalId).toBe(proposalId);
      expect(sendRes.data.rawToken).toHaveLength(43);
      expect(sendRes.data.tokenUrl).toBe(`/p/${sendRes.data.rawToken}`);

      // 3. Verify proposal row updated to 'sent'
      const [proposal] = await dbClient
        .select()
        .from(proposals)
        .where(eq(proposals.id, proposalId))
        .limit(1);

      expect(proposal?.status).toBe('sent');
      expect(proposal?.sentAt).toBeInstanceOf(Date);
      expect(proposal?.validUntil).toBeInstanceOf(Date);
      expect(proposal?.tokenRevokedAt).toBeNull();

      // 4. Verify proposal_sent row in email_outbox
      const [outboxRow] = await dbClient
        .select()
        .from(emailOutbox)
        .where(and(eq(emailOutbox.proposalId, proposalId), eq(emailOutbox.kind, 'proposal_sent')))
        .limit(1);

      expect(outboxRow).toBeDefined();
      expect(outboxRow?.status).toBe('PENDING');
      expect(outboxRow?.recipient).toBe('sophia@example.com');
      const payload = outboxRow?.payload as { token?: string } | null;
      expect(payload?.token).toBe(sendRes.data.rawToken);

      // 5. Verify timeline event and audit log
      const [timelineEvent] = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(
          and(
            eq(clientTimelineEvents.type, 'proposal.sent'),
            eq(clientTimelineEvents.clientId, testClientId),
          ),
        )
        .limit(1);
      expect(timelineEvent).toBeDefined();

      const [auditRow] = await dbClient
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'proposal.sent'), eq(auditEvents.targetId, proposalId)))
        .limit(1);
      expect(auditRow).toBeDefined();
    });

    it('AC-2: outbox worker processes proposal_sent, delivers email via SMTP with /p/[token] link and studio branding', async () => {
      // 1. Create and send proposal
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Fine Art Session',
          lineItems: [
            {
              name: 'Fine Art Base Package',
              unitPriceMinor: 250000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        dbClient,
      );
      if (!draftRes.success) throw new Error('Draft failed');

      const sendRes = await sendProposalAction(
        {
          proposalId: draftRes.data.id,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        dbClient,
      );
      if (!sendRes.success) throw new Error('Send failed');

      // 2. Set up mock nodemailer transporter to intercept dispatch
      const sentMails: {
        to: unknown;
        subject: string;
        text: string;
        html?: string;
        headers?: Record<string, string>;
      }[] = [];

      const testTransporter = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      });

      vi.spyOn(testTransporter, 'sendMail').mockImplementation((mailOptions) => {
        sentMails.push(mailOptions as never);
        return Promise.resolve({ messageId: 'msg-proposal-sent-123' }) as never;
      });

      // 3. Process outbox batch
      const batchResult = await processEmailOutboxBatch({
        dbClient,
        transporter: testTransporter,
      });

      expect(batchResult.sentCount).toBeGreaterThanOrEqual(1);
      expect(sentMails).toHaveLength(1);

      const dispatched = sentMails[0];
      expect(dispatched).toBeDefined();
      if (!dispatched) throw new Error('Dispatched email is undefined');
      expect(dispatched.to).toEqual({ address: 'sophia@example.com' });
      expect(dispatched.subject).toContain('Fine Art Session');
      expect(dispatched.subject).toContain('Solstice Light Studio');
      expect(dispatched.text).toContain(`/p/${sendRes.data.rawToken}`);
      expect(dispatched.text).toContain('€2,500.00');
      expect(dispatched.html).toContain(`/p/${sendRes.data.rawToken}`);
      expect(dispatched.html).toContain('View Proposal');
      expect(dispatched.headers?.['Auto-Submitted']).toBe('auto-generated');
      expect(dispatched.headers?.Precedence).toBe('bulk');

      // 4. Verify outbox row deleted after successful transmission
      const remainingOutbox = await dbClient
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.proposalId, draftRes.data.id));
      expect(remainingOutbox).toHaveLength(0);
    });
  });

  // AC-3
  describe('AC-3 (R-A): revokeProposalTokenAction', () => {
    it('AC-3: sets token_revoked_at, generates fresh hash, renders old token invalid, and emits proposal.revoked audit event', async () => {
      // 1. Create and send proposal to obtain active token
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Proposal to Revoke',
          lineItems: [
            { name: 'Item', unitPriceMinor: 50000, quantity: 1, taxRateBasisPoints: 1900 },
          ],
        },
        dbClient,
      );
      if (!draftRes.success) throw new Error('Draft failed');

      const sendRes = await sendProposalAction({ proposalId: draftRes.data.id }, dbClient);
      if (!sendRes.success) throw new Error('Send failed');

      const initialToken = sendRes.data.rawToken;

      // Old token can currently resolve proposal
      const initialResolution = await getProposalByRawToken(initialToken, dbClient);
      expect(initialResolution).toBeDefined();

      // 2. Revoke proposal token
      const revokeRes = await revokeProposalTokenAction({ proposalId: draftRes.data.id }, dbClient);
      expect(revokeRes.success).toBe(true);
      if (!revokeRes.success) return;

      expect(revokeRes.data.proposalId).toBe(draftRes.data.id);
      expect(revokeRes.data.revokedAt).toBeInstanceOf(Date);

      // 3. Old token now fails resolution
      const revokedResolution = await getProposalByRawToken(initialToken, dbClient);
      expect(revokedResolution).toBeNull();

      // 4. Check DB row has tokenRevokedAt set
      const [proposal] = await dbClient
        .select()
        .from(proposals)
        .where(eq(proposals.id, draftRes.data.id))
        .limit(1);
      expect(proposal?.tokenRevokedAt).toBeInstanceOf(Date);

      // 5. Verify audit log emitted
      const [auditRow] = await dbClient
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, 'proposal.revoked'),
            eq(auditEvents.targetId, draftRes.data.id),
          ),
        )
        .limit(1);

      expect(auditRow).toBeDefined();
      expect(auditRow?.action).toBe('proposal.revoked');
    });
  });

  // AC-4
  describe('AC-4 (R-A): Proposal Acceptance Outbox Notification Ceremony', () => {
    it('AC-4: queues proposal_accepted_client and proposal_accepted_owner in email_outbox with zero extraneous PII', async () => {
      // 1. Create and send proposal
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Acceptance Ceremony Proposal',
          lineItems: [
            {
              packageId: testPackageId,
              itemType: 'base_package',
              name: 'Editorial Portrait Package',
              unitPriceMinor: 180000,
              quantity: 1,
              taxRateBasisPoints: 1900,
            },
          ],
        },
        dbClient,
      );
      if (!draftRes.success) throw new Error('Draft failed');

      await sendProposalAction({ proposalId: draftRes.data.id }, dbClient);

      // Clear the proposal_sent outbox row so we only test acceptance notifications
      await dbClient.delete(emailOutbox).where(eq(emailOutbox.proposalId, draftRes.data.id));

      // 2. Transition proposal to 'accepted'
      const accepted = await transitionProposalStatus(
        draftRes.data.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Sophia Loren',
          acceptedByEmail: 'sophia.accepted@example.com',
          acceptanceIpAnonymized: '10.0.0.0',
          acceptanceUserAgent: 'Mozilla/5.0 Acceptance',
        },
        undefined,
        dbClient,
      );

      expect(accepted.status).toBe('accepted');

      // 3. Verify two outbox rows queued: proposal_accepted_client & proposal_accepted_owner
      const outboxItems = await dbClient
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.proposalId, draftRes.data.id));

      expect(outboxItems).toHaveLength(2);

      const clientItem = outboxItems.find((i) => i.kind === 'proposal_accepted_client');
      const ownerItem = outboxItems.find((i) => i.kind === 'proposal_accepted_owner');

      expect(clientItem).toBeDefined();
      expect(clientItem?.recipient).toBe('sophia.accepted@example.com');
      expect(clientItem?.status).toBe('PENDING');

      expect(ownerItem).toBeDefined();
      expect(ownerItem?.recipient).toBe('owner@solsticelight.com');
      expect(ownerItem?.status).toBe('PENDING');

      // 4. Process outbox items and verify email content and RFC 3834 headers
      const sentMails: {
        to: unknown;
        subject: string;
        text: string;
        html?: string;
        headers?: Record<string, string>;
      }[] = [];

      const testTransporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
      vi.spyOn(testTransporter, 'sendMail').mockImplementation((mailOptions) => {
        sentMails.push(mailOptions as never);
        return Promise.resolve({ messageId: 'msg-acc-123' }) as never;
      });

      const batchResult = await processEmailOutboxBatch({
        dbClient,
        transporter: testTransporter,
      });

      expect(batchResult.sentCount).toBe(2);
      expect(sentMails).toHaveLength(2);

      const clientMail = sentMails.find(
        (m) => (m.to as { address: string }).address === 'sophia.accepted@example.com',
      );
      const ownerMail = sentMails.find(
        (m) => (m.to as { address: string }).address === 'owner@solsticelight.com',
      );

      expect(clientMail).toBeDefined();
      expect(clientMail?.subject).toContain('Confirmation: Proposal accepted');
      expect(clientMail?.text).toContain('Editorial Portrait Package');
      expect(clientMail?.text).toContain('Next Steps');
      expect(clientMail?.headers?.['Auto-Submitted']).toBe('auto-generated');

      expect(ownerMail).toBeDefined();
      expect(ownerMail?.subject).toContain('Proposal Accepted');
      expect(ownerMail?.text).toContain(`/projects/${testProjectId}`);
      expect(ownerMail?.headers?.['Auto-Submitted']).toBe('auto-generated');
    });
  });

  // AC-5
  describe('AC-5: Authentication Enforcement', () => {
    it('AC-5: blocks unauthenticated caller attempting to call saveDraftProposalAction', async () => {
      mockCookiesStore.clear(); // unauthenticated!
      const res = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Unauthenticated Draft',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-5: blocks unauthenticated caller attempting to call sendProposalAction', async () => {
      mockCookiesStore.clear();
      const res = await sendProposalAction(
        {
          proposalId: '01920000-0000-7000-8000-000000000099',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-5: blocks unauthenticated caller attempting to call revokeProposalTokenAction', async () => {
      mockCookiesStore.clear();
      const res = await revokeProposalTokenAction(
        {
          proposalId: '01920000-0000-7000-8000-000000000099',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  // AC-7
  describe('AC-7: Validation Failures', () => {
    it('AC-7: returns VALIDATION_FAILED when sendProposalAction receives an expiration date in the past', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const res = await sendProposalAction(
        {
          proposalId: '01920000-0000-7000-8000-000000000001',
          validUntil: pastDate,
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.error).toBe('Expiration date must be in the future');
      }
    });

    it('AC-7: returns VALIDATION_FAILED when saveDraftProposalAction receives negative line item price', async () => {
      const res = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Negative Price Draft',
          lineItems: [
            {
              name: 'Subsidized Item',
              unitPriceMinor: -1000,
              quantity: 1,
            },
          ],
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.error).toBe('Unit price cannot be negative');
      }
    });
  });

  // AC-9
  describe('AC-9: Downstream getAcceptedProposalForProject Interface', () => {
    it('AC-9: returns accepted proposal summary with package name, deliverables, and selected add-ons', async () => {
      // 1. Create and send proposal
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Commercial Studio Shoot',
          lineItems: [
            {
              packageId: testPackageId,
              itemType: 'base_package',
              name: 'Editorial Portrait Package',
              unitPriceMinor: 180000,
              quantity: 1,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
            {
              name: 'Additional Studio Hour',
              itemType: 'addon',
              unitPriceMinor: 30000,
              quantity: 2,
              taxRateBasisPoints: 1900,
              isSelected: true,
            },
          ],
        },
        dbClient,
      );
      if (!draftRes.success) throw new Error('Draft failed');

      // 2. Accept proposal
      await transitionProposalStatus(
        draftRes.data.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Sophia Loren',
          acceptedByEmail: 'sophia@example.com',
        },
        undefined,
        dbClient,
      );

      // 3. Call downstream interface
      const summary = await getAcceptedProposalForProject(testProjectId, dbClient);
      expect(summary).toBeDefined();
      expect(summary?.packageName).toBe('Editorial Portrait Package');
      expect(summary?.includedItems).toEqual([
        '2 Hours Studio Lighting',
        '10 Master Retouched Files',
      ]);
      expect(summary?.selectedAddons).toEqual([
        {
          name: 'Additional Studio Hour',
          quantity: 2,
          unitPriceMinor: 30000,
        },
      ]);
      expect(summary?.totalMinor).toBe(240000);
      expect(summary?.acceptedByName).toBe('Sophia Loren');
    });
  });

  describe('AC-5 & Boundary Defenses: Error handling, role-based access, and service edge cases', () => {
    it('returns FORBIDDEN for non-owner role across all three server actions', async () => {
      // 1. Create a non-owner user
      const [memberUser] = await dbClient
        .insert(user)
        .values({
          id: generateUuidV7(),
          name: 'Staff Member',
          email: 'staff@solsticelight.com',
          role: 'member',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!memberUser) throw new Error('Failed to create member user');

      const memberSession = await createSession(memberUser.id, dbClient);
      mockCookiesStore.set(SESSION_COOKIE_NAME, memberSession.token);

      // 2. Call saveDraftProposalAction
      const saveRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Unauthorized Draft',
        },
        dbClient,
      );
      expect(saveRes.success).toBe(false);
      if (!saveRes.success) {
        expect(saveRes.code).toBe('FORBIDDEN');
      }

      // 3. Call sendProposalAction
      const sendRes = await sendProposalAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(sendRes.success).toBe(false);
      if (!sendRes.success) {
        expect(sendRes.code).toBe('FORBIDDEN');
      }

      // 4. Call revokeProposalTokenAction
      const revokeRes = await revokeProposalTokenAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(revokeRes.success).toBe(false);
      if (!revokeRes.success) {
        expect(revokeRes.code).toBe('FORBIDDEN');
      }

      // Restore owner session
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    });

    it('returns NOT_FOUND, FORBIDDEN, and IMMUTABLE for draft update boundary conditions', async () => {
      // 1. NOT_FOUND: Updating non-existent proposal ID
      const notFoundRes = await saveDraftProposalAction(
        {
          id: generateUuidV7(),
          projectId: testProjectId,
          title: 'Non-existent Proposal',
        },
        dbClient,
      );
      expect(notFoundRes.success).toBe(false);
      if (!notFoundRes.success) {
        expect(notFoundRes.code).toBe('NOT_FOUND');
      }

      // 2. Create valid draft proposal
      const validDraft = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Mutable Draft',
          lineItems: [{ name: 'Service', unitPriceMinor: 10000 }],
        },
        dbClient,
      );
      if (!validDraft.success) throw new Error('Valid draft failed');

      // 3. FORBIDDEN: Mismatched client ID for project
      const otherClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: otherClientId,
        kind: 'person',
        displayName: 'Unrelated Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const mismatchRes = await saveDraftProposalAction(
        {
          id: validDraft.data.id,
          projectId: testProjectId,
          clientId: otherClientId,
          title: 'Mismatch Draft',
        },
        dbClient,
      );
      expect(mismatchRes.success).toBe(false);
      if (!mismatchRes.success) {
        expect(mismatchRes.code).toBe('FORBIDDEN');
      }

      // 4. IMMUTABLE: Transition proposal to accepted, then attempt edit
      await transitionProposalStatus(
        validDraft.data.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Sophia Loren',
          acceptedByEmail: 'sophia@example.com',
        },
        undefined,
        dbClient,
      );

      const immutableRes = await saveDraftProposalAction(
        {
          id: validDraft.data.id,
          projectId: testProjectId,
          title: 'Attempted Modification After Acceptance',
        },
        dbClient,
      );
      expect(immutableRes.success).toBe(false);
      if (!immutableRes.success) {
        expect(immutableRes.code).toBe('IMMUTABLE');
      }
    });

    it('returns NOT_FOUND and IMMUTABLE for sendProposalAction boundary conditions', async () => {
      // 1. NOT_FOUND: Unknown proposal
      const notFoundRes = await sendProposalAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(notFoundRes.success).toBe(false);
      if (!notFoundRes.success) {
        expect(notFoundRes.code).toBe('NOT_FOUND');
      }

      // 2. IMMUTABLE: Attempting to send an accepted proposal
      const draftRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Accepted Cannot Be Sent',
          lineItems: [{ name: 'Service', unitPriceMinor: 10000 }],
        },
        dbClient,
      );
      if (!draftRes.success) throw new Error('Draft failed');

      await transitionProposalStatus(
        draftRes.data.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Sophia Loren',
          acceptedByEmail: 'sophia@example.com',
        },
        undefined,
        dbClient,
      );

      const sendAcceptedRes = await sendProposalAction(
        {
          proposalId: draftRes.data.id,
        },
        dbClient,
      );
      expect(sendAcceptedRes.success).toBe(false);
      if (!sendAcceptedRes.success) {
        expect(sendAcceptedRes.code).toBe('IMMUTABLE');
      }
    });

    it('returns NOT_FOUND and VALIDATION_FAILED for revokeProposalTokenAction', async () => {
      // 1. NOT_FOUND: Unknown proposal
      const notFoundRes = await revokeProposalTokenAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(notFoundRes.success).toBe(false);
      if (!notFoundRes.success) {
        expect(notFoundRes.code).toBe('NOT_FOUND');
      }

      // 2. VALIDATION_FAILED: Non-UUID proposal ID
      const invalidRes = await revokeProposalTokenAction(
        {
          proposalId: 'not-a-valid-uuid',
        },
        dbClient,
      );
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.code).toBe('VALIDATION_FAILED');
      }
    });

    it('returns INTERNAL_ERROR when services throw unexpected exceptions', async () => {
      const saveSpy = vi
        .spyOn(proposalService, 'saveDraftProposal')
        .mockRejectedValueOnce(new Error('Simulated DB Crash'));
      const saveRes = await saveDraftProposalAction(
        {
          projectId: testProjectId,
          title: 'Crashed Proposal',
        },
        dbClient,
      );
      expect(saveRes.success).toBe(false);
      if (!saveRes.success) {
        expect(saveRes.code).toBe('INTERNAL_ERROR');
        expect(saveRes.error).toBe('Simulated DB Crash');
      }
      saveSpy.mockRestore();

      // Test non-Error string rejection branch
      const nonErrorSave = vi
        .spyOn(proposalService, 'saveDraftProposal')
        .mockRejectedValueOnce('raw string crash');
      const res1 = await saveDraftProposalAction(
        { projectId: testProjectId, title: 'Crash' },
        dbClient,
      );
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.code).toBe('INTERNAL_ERROR');
        expect(res1.error).toBe('Internal error saving draft proposal');
      }
      nonErrorSave.mockRestore();

      const sendSpy = vi
        .spyOn(proposalService, 'sendProposal')
        .mockRejectedValueOnce(new Error('Simulated Send Crash'));
      const sendRes = await sendProposalAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(sendRes.success).toBe(false);
      if (!sendRes.success) {
        expect(sendRes.code).toBe('INTERNAL_ERROR');
        expect(sendRes.error).toBe('Simulated Send Crash');
      }
      sendSpy.mockRestore();

      const nonErrorSend = vi
        .spyOn(proposalService, 'sendProposal')
        .mockRejectedValueOnce('raw string crash');
      const res2 = await sendProposalAction({ proposalId: generateUuidV7() }, dbClient);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe('INTERNAL_ERROR');
        expect(res2.error).toBe('Internal error sending proposal');
      }
      nonErrorSend.mockRestore();

      const revokeSpy = vi
        .spyOn(proposalService, 'revokeProposalToken')
        .mockRejectedValueOnce(new Error('Simulated Revoke Crash'));
      const revokeRes = await revokeProposalTokenAction(
        {
          proposalId: generateUuidV7(),
        },
        dbClient,
      );
      expect(revokeRes.success).toBe(false);
      if (!revokeRes.success) {
        expect(revokeRes.code).toBe('INTERNAL_ERROR');
        expect(revokeRes.error).toBe('Simulated Revoke Crash');
      }
      revokeSpy.mockRestore();

      const nonErrorRevoke = vi
        .spyOn(proposalService, 'revokeProposalToken')
        .mockRejectedValueOnce('raw string crash');
      const res3 = await revokeProposalTokenAction({ proposalId: generateUuidV7() }, dbClient);
      expect(res3.success).toBe(false);
      if (!res3.success) {
        expect(res3.code).toBe('INTERNAL_ERROR');
        expect(res3.error).toBe('Internal error revoking proposal token');
      }
      nonErrorRevoke.mockRestore();
    });

    it('covers service edge cases: auto-resolves clientId from project, and handles missing contact email', async () => {
      // 1. saveDraftProposal auto-resolves clientId when omitted
      const draft = await proposalService.saveDraftProposal(
        {
          projectId: testProjectId,
          title: 'Auto-resolved Client ID Proposal',
          lineItems: [{ name: 'Portrait', unitPriceMinor: 20000 }],
        },
        undefined,
        dbClient,
      );
      expect(draft.clientId).toBe(testClientId);

      // 2. saveDraftProposal throws when non-existent projectId and no clientId
      await expect(
        proposalService.saveDraftProposal(
          {
            projectId: generateUuidV7(),
            title: 'No Project Draft',
          },
          undefined,
          dbClient,
        ),
      ).rejects.toThrow('Project not found or missing clientId');

      // 3. saveDraftProposal throws ProposalForbiddenError when updating draft with non-existent projectId
      await expect(
        proposalService.saveDraftProposal(
          {
            id: draft.id,
            projectId: generateUuidV7(),
            title: 'Draft Non-existent Project',
          },
          undefined,
          dbClient,
        ),
      ).rejects.toThrow(ProposalForbiddenError);

      // 4. revokeProposalToken directly throws ProposalNotFoundError for unknown ID
      await expect(
        proposalService.revokeProposalToken({ proposalId: generateUuidV7() }, undefined, dbClient),
      ).rejects.toThrow(ProposalNotFoundError);

      // 5. sendProposal directly throws when client has no contact email and no recipient is provided
      const isolatedClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: isolatedClientId,
        kind: 'person',
        displayName: 'No Contact Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const isolatedProjectId = generateUuidV7();
      await dbClient.insert(projects).values({
        id: isolatedProjectId,
        clientId: isolatedClientId,
        stageId: defaultStageId,
        title: 'No Contact Project',
        projectTypeKey: 'portrait',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const noEmailDraft = await proposalService.saveDraftProposal(
        {
          projectId: isolatedProjectId,
          title: 'No Email Draft',
          lineItems: [{ name: 'Service', unitPriceMinor: 5000 }],
        },
        undefined,
        dbClient,
      );

      await expect(
        proposalService.sendProposal({ proposalId: noEmailDraft.id }, undefined, dbClient),
      ).rejects.toThrow('Recipient email is required to send proposal');

      // 6. enqueueProposalAcceptedEmails throws when proposal does not exist
      await expect(enqueueProposalAcceptedEmails(generateUuidV7(), dbClient)).rejects.toThrow(
        'Proposal not found',
      );

      // 7. enqueueProposalAcceptedEmails resolves recipient from clientContacts when acceptedByEmail is null
      const contactClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: contactClientId,
        kind: 'person',
        displayName: 'Contact Fallback Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await dbClient.insert(clientContacts).values({
        id: generateUuidV7(),
        clientId: contactClientId,
        givenName: 'Fallback',
        familyName: 'Contact',
        email: 'fallback@example.com',
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const contactProjectId = generateUuidV7();
      await dbClient.insert(projects).values({
        id: contactProjectId,
        clientId: contactClientId,
        stageId: defaultStageId,
        title: 'Fallback Project',
        projectTypeKey: 'portrait',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const contactDraft = await proposalService.saveDraftProposal(
        {
          projectId: contactProjectId,
          clientId: contactClientId,
          title: 'Fallback Email Draft',
          lineItems: [{ name: 'Portrait', unitPriceMinor: 15000 }],
        },
        undefined,
        dbClient,
      );
      // Accept without acceptedByEmail
      await transitionProposalStatus(
        contactDraft.id,
        {
          newStatus: 'accepted',
          acceptedByName: 'Fallback Contact',
        },
        undefined,
        dbClient,
      );
      const enqueued = await enqueueProposalAcceptedEmails(contactDraft.id, dbClient);
      expect(enqueued.clientItem.recipient).toBe('fallback@example.com');
    });
  });
});

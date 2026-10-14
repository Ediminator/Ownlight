import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { eq, sql } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { convertLeadToClient } from '@/server/leads/convert';
import { convertLeadToClientAction, getLeadDuplicatesAction } from '@/server/leads/actions';
import { ForbiddenError } from '@/server/auth/guards';
import * as guards from '@/server/auth/guards';
import { leads, type Lead } from '@/server/db/schema/leads';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientNotes } from '@/server/db/schema/timeline';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { processEmailOutboxBatch } from '@/server/email/outbox-processor';
import { enqueueLeadAutoReply } from '@/server/email/outbox';
import { renderAutoReplyEmail, sanitizeStudioName } from '@/server/email/templates';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';
import * as settingsModule from '@/server/settings/repo';

describe('TASK-0032: Deep Branch Coverage for Lead Conversion & Email Outbox Processor', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let formId: string;
  let noticeVersionId: string;
  let ownerId: string;

  function mockAuthContext(userId: string): guards.AuthContext {
    return {
      user: { id: userId, email: 'owner@example.org', role: 'owner' } as never,
      authType: 'session',
      scopes: ['owner'],
    };
  }

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    ownerId = generateUuidV7();
    formId = generateUuidV7();
    noticeVersionId = generateUuidV7();

    // Drop FK and NOT NULL constraints on leads table to enable edge-case branch tests (e.g. orphan formId or null noticeVersionId)
    await dbClient.execute(
      sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_form_id_inquiry_forms_id_fk`,
    );
    await dbClient.execute(
      sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_notice_version_id_inquiry_form_notice_versions_id_fk`,
    );
    await dbClient.execute(sql`ALTER TABLE leads ALTER COLUMN notice_version_id DROP NOT NULL`);
    await dbClient.execute(
      sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_converted_or_name_email_check`,
    );
    await dbClient.execute(
      sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_converted_client_id_check`,
    );
    await dbClient.execute(
      sql`ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_name_check`,
    );
    await dbClient.execute(
      sql`ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_lead_id_leads_id_fk`,
    );

    // Seed test form
    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: `form-${generateUuidV7().slice(0, 8)}`,
      name: 'Wedding Inquiries',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'family_name', enabled: true, required: false, order: 1 },
        { key: 'email', enabled: true, required: true, order: 2 },
      ],
      eventTypes: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed test notice version
    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'I acknowledge the privacy notice.',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
      privacyPolicyUrl: 'https://example.org/privacy-policy',
      createdByActorId: ownerId,
      createdAt: new Date(),
    });

    // Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Atelier Light',
      timezone: 'Europe/Berlin',
      default_locale: 'en',
      updated_at: new Date(),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    await testDb.destroy();
  });

  async function seedLead(overrides: Partial<typeof leads.$inferInsert> = {}): Promise<Lead> {
    const leadId = generateUuidV7();
    const now = new Date();
    const [row] = await dbClient
      .insert(leads)
      .values({
        id: leadId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: now,
        status: 'new',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Test',
        familyName: 'Lead',
        email: 'test@example.org',
        emailNormalized: 'test@example.org',
        phone: '+49 30 123456',
        eventTypeKey: 'wedding',
        eventDate: '2026-06-20',
        eventLocation: 'Berlin',
        message: 'Hello, wedding photography inquiry',
        autoReplyStatus: 'sent',
        receivedAt: now,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      })
      .returning();
    if (!row) {
      throw new Error('Failed to seed lead fixture');
    }
    return row;
  }

  describe('convertLeadToClient name & contact fallbacks', () => {
    it('handles lead with only givenName (familyName is null)', async () => {
      const lead = await seedLead({
        givenName: 'Anna',
        familyName: null,
        email: 'anna@example.org',
        emailNormalized: 'anna@example.org',
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, res.clientId))
        .limit(1);
      expect(clientRow?.displayName).toBe('Anna');

      const [contactRow] = await dbClient
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, res.clientId))
        .limit(1);
      expect(contactRow?.givenName).toBe('Anna');
      expect(contactRow?.familyName).toBeNull();
    });

    it('handles lead with only familyName (givenName is null)', async () => {
      const lead = await seedLead({
        givenName: null,
        familyName: 'Schmidt',
        email: 'schmidt@example.org',
        emailNormalized: 'schmidt@example.org',
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, res.clientId))
        .limit(1);
      expect(clientRow?.displayName).toBe('Schmidt');

      const [contactRow] = await dbClient
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, res.clientId))
        .limit(1);
      expect(contactRow?.givenName).toBeNull();
      expect(contactRow?.familyName).toBe('Schmidt');
    });

    it('handles lead with both names null or whitespace -> displayName defaults to "Client"', async () => {
      const lead = await seedLead({
        givenName: '   ',
        familyName: '   ',
        phone: null,
        email: 'anonymous@example.org',
        emailNormalized: 'anonymous@example.org',
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, res.clientId))
        .limit(1);
      expect(clientRow?.displayName).toBe('Client');

      const [contactRow] = await dbClient
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, res.clientId))
        .limit(1);
      expect(contactRow?.phone).toBeNull();
    });

    it('handles lead with null email, emailNormalized, and phone -> contact row preserves nulls (lines 117-119)', async () => {
      const lead = await seedLead({
        givenName: 'NoEmail',
        familyName: 'Person',
        email: null,
        emailNormalized: null,
        phone: null,
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [contactRow] = await dbClient
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, res.clientId))
        .limit(1);
      expect(contactRow?.email).toBeNull();
      expect(contactRow?.emailNormalized).toBeNull();
      expect(contactRow?.phone).toBeNull();
    });

    it('handles lead with German locale -> preferredLocale is "de"', async () => {
      const lead = await seedLead({
        locale: 'de',
        givenName: 'Max',
        familyName: 'Mustermann',
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, res.clientId))
        .limit(1);
      expect(clientRow?.preferredLocale).toBe('de');
    });

    it('handles lead with unknown/null locale -> preferredLocale defaults to "en"', async () => {
      const lead = await seedLead({
        locale: 'en',
        givenName: 'John',
        familyName: 'Doe',
      });

      const res = await convertLeadToClient(
        lead.id,
        { mode: 'new_client' },
        { actorType: 'owner', actorId: ownerId },
        dbClient,
      );
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, res.clientId))
        .limit(1);
      expect(clientRow?.preferredLocale).toBe('en');
    });
  });

  describe('convertLeadToClient note creation and form resolution fallbacks', () => {
    it('falls back to "Inquiry form" note title when lead.formId does not exist in inquiry_forms (line 148)', async () => {
      const orphanFormId = generateUuidV7();
      const lead = await seedLead({
        formId: orphanFormId,
        message: 'Looking for newborn photography session',
        receivedAt: new Date('2026-10-14T10:00:00Z'),
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const [noteRow] = await dbClient
        .select()
        .from(clientNotes)
        .where(eq(clientNotes.clientId, res.clientId))
        .limit(1);
      expect(noteRow).toBeDefined();
      expect(noteRow?.body).toContain('Inquiry message (Inquiry form, 2026-10-14)');
      expect(noteRow?.body).toContain('Looking for newborn photography session');
    });

    it('does NOT create a client note when lead message is whitespace only or empty', async () => {
      const lead = await seedLead({
        message: '    \n  \t  ',
      });

      const res = await convertLeadToClient(lead.id, { mode: 'new_client' }, ownerId, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;

      const notes = await dbClient
        .select()
        .from(clientNotes)
        .where(eq(clientNotes.clientId, res.clientId));
      expect(notes).toHaveLength(0);
    });

    it('returns CLIENT_NOT_FOUND when existingClientId does not exist in DB', async () => {
      const lead = await seedLead();

      const res = await convertLeadToClient(
        lead.id,
        { mode: 'existing_client', existingClientId: generateUuidV7() },
        ownerId,
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('CLIENT_NOT_FOUND');
      }
    });

    it('returns INVALID_TRANSITION when lead is in status "spam" or "archived"', async () => {
      const spamLead = await seedLead({ status: 'spam' });
      const archivedLead = await seedLead({ status: 'archived' });

      const resSpam = await convertLeadToClient(
        spamLead.id,
        { mode: 'new_client' },
        ownerId,
        dbClient,
      );
      expect(resSpam.success).toBe(false);
      if (!resSpam.success) {
        expect(resSpam.code).toBe('INVALID_TRANSITION');
      }

      const resArchived = await convertLeadToClient(
        archivedLead.id,
        { mode: 'new_client' },
        ownerId,
        dbClient,
      );
      expect(resArchived.success).toBe(false);
      if (!resArchived.success) {
        expect(resArchived.code).toBe('INVALID_TRANSITION');
      }
    });
  });

  describe('convertLeadToClientAction & getLeadDuplicatesAction branches', () => {
    it('convertLeadToClientAction: handles non-string non-object leadId input (line 350)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const res = await convertLeadToClientAction(12345, dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('convertLeadToClientAction: catches ForbiddenError and returns FORBIDDEN (line 364)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockRejectedValueOnce(
        new ForbiddenError('Access forbidden'),
      );

      const res = await convertLeadToClientAction(
        { leadId: generateUuidV7(), mode: 'new_client' },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('getLeadDuplicatesAction: catches ForbiddenError and returns FORBIDDEN (line 422)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockRejectedValueOnce(
        new ForbiddenError('Access forbidden'),
      );

      const res = await getLeadDuplicatesAction({ leadId: generateUuidV7() }, dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('FORBIDDEN');
      }
    });

    it('getLeadDuplicatesAction: handles lead without email by returning empty duplicates', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const lead = await seedLead({
        email: null,
        emailNormalized: null,
      });

      const res = await getLeadDuplicatesAction(lead.id, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.duplicates).toEqual([]);
    });

    it('getLeadDuplicatesAction: handles non-existent lead by returning empty duplicates', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const res = await getLeadDuplicatesAction(generateUuidV7(), dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.duplicates).toEqual([]);
    });

    it('convertLeadToClientAction: supports 3-arg invocation (leadId, input, client) (line 339)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const lead = await seedLead();
      const res = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.clientId).toBeDefined();
    });

    it('convertLeadToClientAction: returns VALIDATION_FAILED when leadId is invalid format (lines 371-377)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const res = await convertLeadToClientAction(
        { leadId: 'not-a-valid-uuid-format', mode: 'new_client' },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('convertLeadToClientAction: returns VALIDATION_FAILED when mode is existing_client but existingClientId is missing', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const lead = await seedLead();
      const res = await convertLeadToClientAction(
        { leadId: lead.id, mode: 'existing_client' },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('getLeadDuplicatesAction: returns VALIDATION_FAILED when leadId is not a valid uuid (lines 430-437)', async () => {
      vi.spyOn(guards, 'requireOwnerWebSession').mockResolvedValueOnce(mockAuthContext(ownerId));

      const res = await getLeadDuplicatesAction({ leadId: 'not-a-valid-uuid' }, dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('email outbox processor branch coverage', () => {
    beforeEach(async () => {
      await dbClient.delete(emailOutbox);
    });

    it('processEmailOutboxBatch: cleanly deletes outbox item when lead is deleted/missing (lines 103-107)', async () => {
      const missingLeadId = generateUuidV7();
      await enqueueLeadAutoReply(missingLeadId, dbClient);

      const res = await processEmailOutboxBatch({ dbClient, batchSize: 10 });
      expect(res.batchSize).toBe(1);
      expect(res.suppressedCount).toBe(1);

      const items = await dbClient.select().from(emailOutbox);
      expect(items).toHaveLength(0);
    });

    it('processEmailOutboxBatch: suppresses and deletes outbox item when lead is already converted (lines 110-115)', async () => {
      const lead = await seedLead({
        status: 'converted',
        email: 'converted@example.org',
        emailNormalized: 'converted@example.org',
      });

      await enqueueLeadAutoReply(lead.id, dbClient);

      const res = await processEmailOutboxBatch({ dbClient, batchSize: 10 });
      expect(res.batchSize).toBe(1);
      expect(res.suppressedCount).toBe(1);

      const items = await dbClient.select().from(emailOutbox);
      expect(items).toHaveLength(0);

      const [leadRow] = await dbClient.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
      expect(leadRow?.autoReplyStatus).toBe('suppressed');
    });

    it('processEmailOutboxBatch: deletes outbox and marks lead autoReplyStatus="failed" when lead has no email (lines 192-196)', async () => {
      const lead = await seedLead({
        email: null,
        emailNormalized: null,
      });

      await enqueueLeadAutoReply(lead.id, dbClient);

      const res = await processEmailOutboxBatch({ dbClient, batchSize: 10 });
      expect(res.batchSize).toBe(1);

      const items = await dbClient.select().from(emailOutbox);
      expect(items).toHaveLength(0);

      const [leadRow] = await dbClient.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
      expect(leadRow?.autoReplyStatus).toBe('failed');
    });

    it('processEmailOutboxBatch: handles missing noticeVersionId by rendering with empty privacyPolicyUrl (line 173)', async () => {
      const capturedMails: SendMailOptions[] = [];
      const mockTransporter = {
        sendMail: (opts: SendMailOptions) => {
          capturedMails.push(opts);
          return Promise.resolve({ messageId: 'msg-1' });
        },
      } as unknown as Transporter;

      const lead = await seedLead({
        noticeVersionId: null as unknown as string, // Null notice version
        email: 'no-notice@example.org',
        emailNormalized: 'no-notice@example.org',
      });

      await enqueueLeadAutoReply(lead.id, dbClient);

      const res = await processEmailOutboxBatch({
        dbClient,
        transporter: mockTransporter,
        batchSize: 10,
      });
      expect(res.sentCount).toBe(1);
      expect(capturedMails).toHaveLength(1);
      expect(capturedMails[0]?.text).not.toContain('privacy policy:');
    });

    it('processEmailOutboxBatch: handles missing noticeVersion record gracefully (line 181)', async () => {
      const capturedMails: SendMailOptions[] = [];
      const mockTransporter = {
        sendMail: (opts: SendMailOptions) => {
          capturedMails.push(opts);
          return Promise.resolve({ messageId: 'msg-2' });
        },
      } as unknown as Transporter;

      const lead = await seedLead({
        noticeVersionId: generateUuidV7(), // UUID that does not exist in inquiryFormNoticeVersions
        email: 'missing-notice-row@example.org',
        emailNormalized: 'missing-notice-row@example.org',
      });

      await enqueueLeadAutoReply(lead.id, dbClient);

      const res = await processEmailOutboxBatch({
        dbClient,
        transporter: mockTransporter,
        batchSize: 10,
      });
      expect(res.sentCount).toBe(1);
      expect(capturedMails).toHaveLength(1);
      expect(capturedMails[0]?.text).not.toContain('privacy policy:');
    });

    it('processEmailOutboxBatch: falls back to "Photo Studio" when getStudioSettings throws (lines 169-170)', async () => {
      const capturedMails: SendMailOptions[] = [];
      const mockTransporter = {
        sendMail: (opts: SendMailOptions) => {
          capturedMails.push(opts);
          return Promise.resolve({ messageId: 'msg-3' });
        },
      } as unknown as Transporter;

      vi.spyOn(settingsModule, 'getStudioSettings').mockRejectedValueOnce(
        new Error('Settings DB error'),
      );

      const lead = await seedLead({
        email: 'studio-fallback@example.org',
        emailNormalized: 'studio-fallback@example.org',
      });

      await enqueueLeadAutoReply(lead.id, dbClient);

      const res = await processEmailOutboxBatch({
        dbClient,
        transporter: mockTransporter,
        batchSize: 10,
      });
      expect(res.sentCount).toBe(1);
      expect(capturedMails[0]?.subject).toBe('Your inquiry to Photo Studio');
    });

    it('processEmailOutboxBatch: handles SMTP sending failure when error is not an Error instance (lines 238-240, 253-264)', async () => {
      const nonErrorReason = new Error('SMTP 554 Relay Access Denied String');
      Object.setPrototypeOf(nonErrorReason, Object.prototype);
      nonErrorReason.toString = () => 'SMTP 554 Relay Access Denied String';
      const mockTransporter = {
        sendMail: () => Promise.reject(nonErrorReason),
      } as unknown as Transporter;

      const lead = await seedLead({
        email: 'non-error-smtp@example.org',
        emailNormalized: 'non-error-smtp@example.org',
      });

      const outboxId = generateUuidV7();
      await dbClient.insert(emailOutbox).values({
        id: outboxId,
        kind: 'lead_auto_reply',
        leadId: lead.id,
        status: 'PENDING',
        attempts: 4, // 5th attempt will be terminal
        nextAttemptAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await processEmailOutboxBatch({
        dbClient,
        transporter: mockTransporter,
        batchSize: 10,
      });
      expect(res.failedCount).toBe(1);

      const [outboxRow] = await dbClient
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.id, outboxId))
        .limit(1);
      expect(outboxRow?.status).toBe('FAILED');
      expect(outboxRow?.lastError).toContain('SMTP 554 Relay Access Denied');

      const [leadRow] = await dbClient.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
      expect(leadRow?.autoReplyStatus).toBe('failed');
    });

    it('processEmailOutboxBatch: handles retryable failure when attempts < max (line 280)', async () => {
      const mockTransporter = {
        sendMail: () => Promise.reject(new Error('Temporary 421 Service Not Available')),
      } as unknown as Transporter;

      const lead = await seedLead({
        email: 'retryable@example.org',
        emailNormalized: 'retryable@example.org',
      });

      const outboxId = generateUuidV7();
      await dbClient.insert(emailOutbox).values({
        id: outboxId,
        kind: 'lead_auto_reply',
        leadId: lead.id,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await processEmailOutboxBatch({
        dbClient,
        transporter: mockTransporter,
        batchSize: 10,
      });
      expect(res.failedCount).toBe(1);

      const [outboxRow] = await dbClient
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.id, outboxId))
        .limit(1);
      expect(outboxRow?.status).toBe('PENDING');
      expect(outboxRow?.attempts).toBe(1);
    });
  });

  describe('email template helper branches', () => {
    it('sanitizeStudioName: returns "Photo Studio" when cleaned string is empty or non-string', () => {
      expect(sanitizeStudioName('   \r\n \t  ')).toBe('Photo Studio');
      expect(sanitizeStudioName(12345 as unknown as string)).toBe('Photo Studio');
    });

    it('renderAutoReplyEmail: renders without privacy policy URL for both en and de', () => {
      const resEn = renderAutoReplyEmail({ locale: 'en', studioName: 'My Studio' });
      expect(resEn.subject).toBe('Your inquiry to My Studio');
      expect(resEn.text).not.toContain('privacy policy:');

      const resDe = renderAutoReplyEmail({
        locale: 'de',
        studioName: 'Mein Studio',
        privacyPolicyUrl: '   ',
      });
      expect(resDe.subject).toBe('Ihre Anfrage an Mein Studio');
      expect(resDe.text).not.toContain('Datenschutzerklärung:');
    });
  });
});

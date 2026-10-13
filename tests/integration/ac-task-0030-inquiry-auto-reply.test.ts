import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { leads } from '@/server/db/schema/leads';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { auditEvents } from '@/server/db/schema/audit';
import { createForm, publishForm } from '@/server/inquiry-forms/service';
import { submitInquiry } from '@/server/inquiry-forms/submit';
import { processEmailOutboxBatch } from '@/server/email/outbox-processor';
import { setTestTransporter, sendEmail } from '@/server/auth/email';
import { BackgroundWorker } from '@/server/retention/worker';
import { executeRetentionSweep } from '@/server/retention/runner';
import { consumeRateLimit } from '@/server/auth/rate-limiter';
import type { DbClient } from '@/server/db/client';

function requireValue<T>(val: T | null | undefined, name = 'value'): T {
  expect(val).toBeDefined();
  if (val === null || val === undefined) {
    throw new Error(`Expected ${name} to be defined`);
  }
  return val;
}

describe('TASK-0030 Integration Tests: Transactional Email Outbox & Inquiry Auto-Reply', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let publishedFormSlugEn: string;
  let publishedFormSlugDe: string;
  let noAutoReplyFormSlug: string;
  let acceptUnverifiedFormSlug: string;

  const capturedMails: SendMailOptions[] = [];
  let mockTransporter: Transporter;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    capturedMails.length = 0;

    mockTransporter = {
      sendMail: (options: SendMailOptions) => {
        capturedMails.push(options);
        return Promise.resolve({ messageId: `msg-${String(Date.now())}` });
      },
    } as unknown as Transporter;

    setTestTransporter(mockTransporter);

    // 1. Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Lumos',
      timezone: 'Europe/Berlin',
      default_locale: 'en',
    });

    // 2. English form with auto_reply_enabled = true
    const formEnRes = await createForm(
      {
        name: 'Contact Studio EN',
        default_locale: 'en',
        auto_reply_enabled: true,
        accept_unverified: false,
        privacy_policy_url: 'https://example.com/privacy-en',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'family_name', enabled: true, required: false, order: 1 },
          { key: 'email', enabled: true, required: true, order: 2 },
          { key: 'message', enabled: true, required: false, order: 3 },
        ],
        event_types: [],
      },
      'owner-admin',
      dbClient,
    );
    if (!formEnRes.success) throw new Error(formEnRes.error);
    const pubEn = await publishForm(formEnRes.data.id, 'owner-admin', dbClient);
    if (!pubEn.success) throw new Error(pubEn.error);
    publishedFormSlugEn = pubEn.data.slug;

    // 3. German form with auto_reply_enabled = true
    const formDeRes = await createForm(
      {
        name: 'Kontakt Studio DE',
        default_locale: 'de',
        auto_reply_enabled: true,
        accept_unverified: false,
        privacy_policy_url: 'https://example.com/datenschutz-de',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'family_name', enabled: true, required: false, order: 1 },
          { key: 'email', enabled: true, required: true, order: 2 },
          { key: 'message', enabled: true, required: false, order: 3 },
        ],
        event_types: [],
      },
      'owner-admin',
      dbClient,
    );
    if (!formDeRes.success) throw new Error(formDeRes.error);
    const pubDe = await publishForm(formDeRes.data.id, 'owner-admin', dbClient);
    if (!pubDe.success) throw new Error(pubDe.error);
    publishedFormSlugDe = pubDe.data.slug;

    // 4. Form with auto_reply_enabled = false
    const formNoReplyRes = await createForm(
      {
        name: 'No Auto Reply Form',
        default_locale: 'en',
        auto_reply_enabled: false,
        accept_unverified: false,
        privacy_policy_url: 'https://example.com/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
        ],
        event_types: [],
      },
      'owner-admin',
      dbClient,
    );
    if (!formNoReplyRes.success) throw new Error(formNoReplyRes.error);
    const pubNoReply = await publishForm(formNoReplyRes.data.id, 'owner-admin', dbClient);
    if (!pubNoReply.success) throw new Error(pubNoReply.error);
    noAutoReplyFormSlug = pubNoReply.data.slug;

    // 5. Form with accept_unverified = true
    const formUnverifiedRes = await createForm(
      {
        name: 'Accept Unverified Form',
        default_locale: 'en',
        auto_reply_enabled: true,
        accept_unverified: true,
        privacy_policy_url: 'https://example.com/privacy',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
        ],
        event_types: [],
      },
      'owner-admin',
      dbClient,
    );
    if (!formUnverifiedRes.success) throw new Error(formUnverifiedRes.error);
    const pubUnverified = await publishForm(formUnverifiedRes.data.id, 'owner-admin', dbClient);
    if (!pubUnverified.success) throw new Error(pubUnverified.error);
    acceptUnverifiedFormSlug = pubUnverified.data.slug;
  });

  afterEach(async () => {
    setTestTransporter(null);
    await testDb.destroy();
  });

  it('AC-1: verified inquiry at /en/f/{slug} triggers outbox processor via BackgroundWorker and delivers English auto-reply', async () => {
    // 1. Submit verified inquiry
    const submitRes = await submitInquiry(
      {
        given_name: 'Alice',
        email: 'alice.client@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.10',
      },
      dbClient,
    );

    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // Check that outbox row was enqueued with PENDING status
    const pendingRows = await dbClient.select().from(emailOutbox);
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]?.leadId).toBe(leadId);
    expect(pendingRows[0]?.status).toBe('PENDING');

    // Check lead status is 'queued'
    const [leadBefore] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(leadBefore?.autoReplyStatus).toBe('queued');

    // 2. Run background worker job loop
    const worker = new BackgroundWorker({
      db: dbClient,
      mockAdvisoryLock: true,
      runOnce: true,
    });
    const workerRes = await worker.start();
    expect(workerRes.success).toBe(true);

    // 3. Verify SMTP delivery
    expect(capturedMails).toHaveLength(1);
    const mail = requireValue(capturedMails[0], 'mail');
    expect(mail.to).toEqual({ address: 'alice.client@example.com' });
    expect(mail.subject).toBe('Your inquiry to Studio Lumos');
    expect(mail.text).toContain('Thank you for reaching out');
    expect(mail.text).toContain('respond to you personally');
    expect(mail.text).toContain('https://example.com/privacy-en');

    // 4. Verify outbox row was deleted on success
    const remainingOutbox = await dbClient.select().from(emailOutbox);
    expect(remainingOutbox).toHaveLength(0);

    // 5. Verify lead has auto_reply_status = 'sent'
    const [leadAfter] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(leadAfter?.autoReplyStatus).toBe('sent');

    // 6. Verify audit event was recorded
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.auto_reply.sent'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetId).toBe(leadId);
  });

  it('AC-2: verified submission at /de/f/{slug} delivers German auto-reply with localized subject and text', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'Maximilian',
        email: 'max.muster@example.de',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugDe,
        locale: 'de',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.11',
      },
      dbClient,
    );

    expect(submitRes.success).toBe(true);

    // Process outbox batch
    const batchRes = await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(batchRes.sentCount).toBe(1);

    expect(capturedMails).toHaveLength(1);
    const mail = requireValue(capturedMails[0], 'mail');
    expect(mail.to).toEqual({ address: 'max.muster@example.de' });
    expect(mail.subject).toBe('Ihre Anfrage an Studio Lumos');
    expect(mail.text).toContain('Vielen Dank für Ihre Nachricht');
    expect(mail.text).toContain('persönlich bei Ihnen melden');
    expect(mail.text).toContain('https://example.com/datenschutz-de');
  });

  it('AC-3: delivered email contains RFC 3834 headers, matching From, and NO html part', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'Bob',
        email: 'bob@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.12',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);

    await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });

    expect(capturedMails).toHaveLength(1);
    const mail = requireValue(capturedMails[0], 'mail');

    // Check RFC 3834 and anti-loop headers
    expect(mail.headers).toBeDefined();
    expect(mail.headers).toMatchObject({
      'Auto-Submitted': 'auto-replied',
      'X-Auto-Response-Suppress': 'All',
    });

    // Check From header
    expect(mail.from).toBeDefined();

    // Check text part is present and html part is completely absent
    expect(typeof mail.text).toBe('string');
    expect(mail.html).toBeUndefined();
    expect('html' in mail).toBe(false);
  });

  it('AC-4: delivered auto-reply strictly omits visitor message text and visitor name', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'AttackerName',
        family_name: 'AttackerFamily',
        email: 'victim@example.com',
        message: 'Free offer! Click here: http://evil.example to win prizes!',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.13',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);

    await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });

    expect(capturedMails).toHaveLength(1);
    const mail = requireValue(capturedMails[0], 'mail');

    // Neither subject nor body contains visitor message text, link, or visitor name
    expect(mail.subject).not.toContain('Free offer');
    expect(mail.subject).not.toContain('evil.example');
    expect(mail.subject).not.toContain('AttackerName');

    expect(mail.text).not.toContain('Free offer');
    expect(mail.text).not.toContain('Click here');
    expect(mail.text).not.toContain('http://evil.example');
    expect(mail.text).not.toContain('win prizes');
    expect(mail.text).not.toContain('AttackerName');
    expect(mail.text).not.toContain('AttackerFamily');
  });

  it('AC-5: unverified submission on form with accept_unverified = true creates no outbox row and sends no email', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'UnverifiedVisitor',
        email: 'unverified@example.com',
        notice_acknowledged: true,
      },
      {
        slug: acceptUnverifiedFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'unverified',
        clientIp: '198.51.100.14',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // No row created in email_outbox
    const outboxRows = await dbClient.select().from(emailOutbox);
    expect(outboxRows).toHaveLength(0);

    // Lead has auto_reply_status = 'not_applicable'
    const [lead] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.autoReplyStatus).toBe('not_applicable');

    // Run processor: no email sent
    await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(capturedMails).toHaveLength(0);
  });

  it('AC-6: verified submission on form with auto_reply_enabled = false creates no outbox row and sends no email', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'NoReplyVisitor',
        email: 'noreply.visitor@example.com',
        notice_acknowledged: true,
      },
      {
        slug: noAutoReplyFormSlug,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.15',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // No row created in email_outbox
    const outboxRows = await dbClient.select().from(emailOutbox);
    expect(outboxRows).toHaveLength(0);

    // Lead has auto_reply_status = 'not_applicable'
    const [lead] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.autoReplyStatus).toBe('not_applicable');

    // Run processor: no email sent
    await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(capturedMails).toHaveLength(0);
  });

  it('AC-7: recipient who already received an auto-reply in last 24h has 2nd auto-reply suppressed and audited', async () => {
    const email = 'repeat.recipient@example.com';

    // 1st verified submission
    const submitRes1 = await submitInquiry(
      {
        given_name: 'Repeat1',
        email,
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.16',
      },
      dbClient,
    );
    expect(submitRes1.success).toBe(true);

    // Process 1st auto-reply: sent
    const batch1 = await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(batch1.sentCount).toBe(1);
    expect(capturedMails).toHaveLength(1);

    // 2nd verified submission with the same email
    const submitRes2 = await submitInquiry(
      {
        given_name: 'Repeat2',
        email,
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.17',
      },
      dbClient,
    );
    expect(submitRes2.success).toBe(true);
    const leadId2 = requireValue(submitRes2.leadId, 'leadId2');

    // Process 2nd auto-reply: should be suppressed
    const batch2 = await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(batch2.sentCount).toBe(0);
    expect(batch2.suppressedCount).toBe(1);

    // Captured mails still only 1 (no new email sent)
    expect(capturedMails).toHaveLength(1);

    // 2nd lead has auto_reply_status = 'suppressed'
    const [lead2] = await dbClient.select().from(leads).where(eq(leads.id, leadId2));
    expect(lead2?.autoReplyStatus).toBe('suppressed');

    // Outbox row was cleanly deleted
    const outboxRows = await dbClient.select().from(emailOutbox);
    expect(outboxRows).toHaveLength(0);

    // Audit event lead.auto_reply.suppressed was emitted with reason = 'rate_limited'
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.auto_reply.suppressed'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetId).toBe(leadId2);
    expect(auditRows[0]?.metadata).toMatchObject({ reason: 'rate_limited' });
  });

  it('AC-8: 30 auto-replies sent across instance in last hour suppresses the 31st verified submission', async () => {
    // Simulate 30 auto-replies already sent in the global bucket
    const globalKey = 'auto_reply_global';
    for (let i = 0; i < 30; i++) {
      await consumeRateLimit(globalKey, 30, 60 * 60 * 1000, dbClient);
    }

    // Submit 31st verified inquiry
    const submitRes = await submitInquiry(
      {
        given_name: 'ThirtyFirst',
        email: 'thirtyfirst@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.18',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // Process outbox: must be suppressed due to global cap
    const batchRes = await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });
    expect(batchRes.sentCount).toBe(0);
    expect(batchRes.suppressedCount).toBe(1);
    expect(capturedMails).toHaveLength(0);

    const [lead] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.autoReplyStatus).toBe('suppressed');

    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.auto_reply.suppressed'));
    expect(auditRows).toHaveLength(1);
  });

  it('AC-9: temporary SMTP error increments attempts, calculates backoff, and keeps lead auto_reply_status queued', async () => {
    // Failing transporter
    const failingTransporter = {
      sendMail: () => Promise.reject(new Error('Connection timeout to SMTP gateway')),
    } as unknown as Transporter;

    const submitRes = await submitInquiry(
      {
        given_name: 'TransientFailure',
        email: 'transient@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.19',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    const beforeProcess = new Date();

    // Process with failing transporter
    const batchRes = await processEmailOutboxBatch({
      dbClient,
      transporter: failingTransporter,
      backoffOptions: {
        baseDelayMs: 10_000,
        randomFn: () => 0,
      },
    });
    expect(batchRes.failedCount).toBe(1);

    // Check outbox row: status = 'PENDING', attempts = 1, next_attempt_at > beforeProcess
    const [outboxRow] = await dbClient.select().from(emailOutbox);
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.status).toBe('PENDING');
    expect(outboxRow?.attempts).toBe(1);
    expect(outboxRow?.nextAttemptAt.getTime()).toBeGreaterThan(beforeProcess.getTime());
    expect(outboxRow?.lastError).toContain('Connection timeout');

    // Check lead remains 'queued'
    const [lead] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.autoReplyStatus).toBe('queued');
  });

  it('AC-10: 5 consecutive SMTP failures marks outbox row FAILED, lead failed, audits, and redacts recipient in last_error', async () => {
    const recipientEmail = 'persistent.fail@example.com';
    const failingTransporter = {
      sendMail: () =>
        Promise.reject(
          new Error(`SMTP 550: Mailbox ${recipientEmail} rejected on host smtp.relay.internal`),
        ),
    } as unknown as Transporter;

    const submitRes = await submitInquiry(
      {
        given_name: 'TerminalFailure',
        email: recipientEmail,
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.20',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // Simulate 4 prior failed attempts
    await dbClient.update(emailOutbox).set({ attempts: 4 }).where(eq(emailOutbox.leadId, leadId));

    // 5th attempt executes
    const batchRes = await processEmailOutboxBatch({
      dbClient,
      transporter: failingTransporter,
    });
    expect(batchRes.failedCount).toBe(1);

    // Outbox row is marked FAILED with attempts = 5
    const [outboxRow] = await dbClient.select().from(emailOutbox);
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.status).toBe('FAILED');
    expect(outboxRow?.attempts).toBe(5);

    // last_error does NOT leak the recipient email address
    expect(outboxRow?.lastError).not.toContain(recipientEmail);
    expect(outboxRow?.lastError).toContain('[REDACTED_EMAIL]');

    // Lead has auto_reply_status = 'failed'
    const [lead] = await dbClient.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.autoReplyStatus).toBe('failed');

    // Audit event lead.auto_reply.failed was emitted
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.auto_reply.failed'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetId).toBe(leadId);
    expect(auditRows[0]?.outcome).toBe('failure');
  });

  it('AC-11: outbox row whose referenced lead is deleted before sending is cleanly deleted without SMTP delivery', async () => {
    const submitRes = await submitInquiry(
      {
        given_name: 'ToBeDeleted',
        email: 'deleted.before.send@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.21',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // Verify outbox row exists
    const [outboxBefore] = await dbClient.select().from(emailOutbox);
    expect(outboxBefore).toBeDefined();

    // Now manually hard-delete the lead (simulating cascade or manual delete)
    await dbClient.delete(leads).where(eq(leads.id, leadId));

    // If outbox didn't cascade or if orphaned, processEmailOutboxBatch cleanly removes it
    const batchRes = await processEmailOutboxBatch({
      dbClient,
      transporter: mockTransporter,
    });

    expect(batchRes.sentCount).toBe(0);
    expect(capturedMails).toHaveLength(0);

    const outboxAfter = await dbClient.select().from(emailOutbox);
    expect(outboxAfter).toHaveLength(0);
  });

  it('AC-12: retention sweep purges FAILED email_outbox rows older than 30 days while preserving recent and pending rows', async () => {
    // Create dummy lead to reference
    const submitRes = await submitInquiry(
      {
        given_name: 'RetentionLead',
        email: 'retention.test@example.com',
        notice_acknowledged: true,
      },
      {
        slug: publishedFormSlugEn,
        locale: 'en',
        deliveryMode: 'hosted',
        verification: 'verified',
        clientIp: '198.51.100.22',
      },
      dbClient,
    );
    expect(submitRes.success).toBe(true);
    const leadId = requireValue(submitRes.leadId, 'leadId');

    // Clear the active outbox row from submission
    await dbClient.delete(emailOutbox);

    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // 1. Old FAILED row (40 days old) -> should be deleted
    await dbClient.insert(emailOutbox).values({
      kind: 'lead_auto_reply',
      leadId,
      status: 'FAILED',
      attempts: 5,
      lastError: 'Permanent failure',
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo,
    });

    // 2. Recent FAILED row (10 days old) -> should be preserved
    const [recentFailed] = await dbClient
      .insert(emailOutbox)
      .values({
        kind: 'lead_auto_reply',
        leadId,
        status: 'FAILED',
        attempts: 5,
        lastError: 'Recent failure',
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
      })
      .returning();

    // 3. Old PENDING row (40 days old) -> should be preserved (pending must not be purged by retention)
    const [oldPending] = await dbClient
      .insert(emailOutbox)
      .values({
        kind: 'lead_auto_reply',
        leadId,
        status: 'PENDING',
        attempts: 0,
        createdAt: fortyDaysAgo,
        updatedAt: fortyDaysAgo,
      })
      .returning();

    // Execute retention sweep
    const sweepResult = await executeRetentionSweep({
      dbClient,
      dryRun: false,
    });

    const failedPolicy = sweepResult.policies.find((p) => p.policyId === 'failed-email-outbox');
    expect(failedPolicy).toBeDefined();
    expect(failedPolicy?.deletedCount).toBe(1);

    // Verify database contents
    const remaining = await dbClient.select().from(emailOutbox);
    const remainingIds = remaining.map((r) => r.id);

    expect(remainingIds).toContain(recentFailed?.id);
    expect(remainingIds).toContain(oldPending?.id);
    expect(remaining).toHaveLength(2);
  });

  it('AC-13: header injection in email address is rejected by sendEmail', async () => {
    // Attempt CRLF injection into sendEmail
    await expect(
      sendEmail({
        to: 'victim@example.com\r\nBcc: evil@example.com',
        subject: 'Header Injection Test',
        text: 'Hello',
        transporter: mockTransporter,
      }),
    ).rejects.toThrow(/prohibited header delimiters or line breaks/);

    // Attempt comma delimiter injection
    await expect(
      sendEmail({
        to: { address: 'victim@example.com, attacker@example.com' },
        subject: 'Header Delimiter Test',
        text: 'Hello',
        transporter: mockTransporter,
      }),
    ).rejects.toThrow(/prohibited header delimiters or line breaks/);

    expect(capturedMails).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { enqueueAppointmentEmail } from '@/server/email/templates/appointment';
import { processEmailOutboxBatch } from '@/server/email/outbox-processor';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { appointments } from '@/server/db/schema/calendar';
import { clients } from '@/server/db/schema/clients';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { logger } from '@/server/log';
import type { DbClient } from '@/server/db/client';

describe('TASK-0041: Appointment Email Outbox Integration Tests (AC-5, AC-6, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    await dbClient.insert(studioSettings).values({
      id: '01920000-0000-7000-8000-000000000001',
      studio_name: 'Apex Photography',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      mfa_required: false,
    });
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-5 (R-A): enqueues appointment confirmation in email_outbox and processes delivery with RFC 3834 headers', async () => {
    const clientId = '01920000-0000-7000-8000-000000000010';
    const apptId = '01920000-0000-7000-8000-000000000011';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Jessica Jones',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: apptId,
      clientId,
      title: 'Consultation & Portfolio Review',
      status: 'scheduled',
      startsAt: new Date('2026-07-20T10:00:00Z'),
      endsAt: new Date('2026-07-20T10:45:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'google_meet',
      meetUrl: 'https://meet.google.com/outbox-test-123',
      attendeeName: 'Jessica Jones',
      attendeeEmail: 'jessica@example.com',
      attendeeNotes: 'Focus on private investigation commercial headshots.',
    });

    // 1. Enqueue confirmation email
    const outboxItem = await enqueueAppointmentEmail({
      appointmentId: apptId,
      kind: 'appointment_confirmation',
      recipient: 'jessica@example.com',
      tx: dbClient,
    });

    expect(outboxItem).toBeDefined();
    expect(outboxItem.kind).toBe('appointment_confirmation');
    expect(outboxItem.appointmentId).toBe(apptId);
    expect(outboxItem.status).toBe('PENDING');

    // Verify row in database
    const [row] = await dbClient
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, outboxItem.id))
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.kind).toBe('appointment_confirmation');
    expect(row?.status).toBe('PENDING');

    // 2. Process outbox batch using mock nodemailer transporter
    const sentMails: unknown[] = [];
    const testTransporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });

    // Intercept sendMail
    const sendMailSpy = vi.spyOn(testTransporter, 'sendMail').mockImplementation((mailOptions) => {
      sentMails.push(mailOptions);
      return Promise.resolve({ messageId: 'test-msg-id-123' }) as never;
    });

    const result = await processEmailOutboxBatch({
      dbClient,
      transporter: testTransporter,
    });

    expect(result.processedCount).toBe(1);
    expect(result.sentCount).toBe(1);

    // Verify outbox row was deleted on success
    const [deletedRow] = await dbClient
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, outboxItem.id))
      .limit(1);

    expect(deletedRow).toBeUndefined();

    // Verify email details and RFC 3834 headers
    expect(sentMails).toHaveLength(1);
    const mail = sentMails[0] as {
      to: string | { address: string };
      subject: string;
      text: string;
      headers: Record<string, string>;
    };

    const toAddress = typeof mail.to === 'string' ? mail.to : mail.to.address;
    expect(toAddress).toBe('jessica@example.com');
    expect(mail.subject).toContain('Appointment Confirmation: Consultation & Portfolio Review');
    expect(mail.text).toContain('Hello Jessica Jones,');
    expect(mail.text).toContain('Duration: 45 minutes');
    expect(mail.text).toContain('https://meet.google.com/outbox-test-123');
    expect(mail.text).toContain('Focus on private investigation commercial headshots.');

    // RFC 3834 headers
    expect(mail.headers['Auto-Submitted']).toBe('auto-generated');
    expect(mail.headers.Precedence).toBe('bulk');

    sendMailSpy.mockRestore();
  });

  it('AC-6 (R-A): enqueues appointment cancellation in email_outbox and processes delivery with cancellation reason', async () => {
    const clientId = '01920000-0000-7000-8000-000000000020';
    const apptId = '01920000-0000-7000-8000-000000000021';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Luke Cage',
      kind: 'person',
      preferredLocale: 'de',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: apptId,
      clientId,
      title: 'Studio Portrait Session',
      status: 'cancelled',
      startsAt: new Date('2026-08-10T14:00:00Z'),
      endsAt: new Date('2026-08-10T15:00:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'in_person',
      attendeeName: 'Luke Cage',
      attendeeEmail: 'luke@example.com',
      cancellationReason: 'Emergency studio maintenance',
      cancelledAt: new Date(),
    });

    // Enqueue cancellation
    const outboxItem = await enqueueAppointmentEmail({
      appointmentId: apptId,
      kind: 'appointment_cancellation',
      recipient: 'luke@example.com',
      tx: dbClient,
    });

    expect(outboxItem.kind).toBe('appointment_cancellation');

    const sentMails: unknown[] = [];
    const testTransporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });

    vi.spyOn(testTransporter, 'sendMail').mockImplementation((mailOptions) => {
      sentMails.push(mailOptions);
      return Promise.resolve({ messageId: 'test-cancel-msg' }) as never;
    });

    const result = await processEmailOutboxBatch({
      dbClient,
      transporter: testTransporter,
    });

    expect(result.sentCount).toBe(1);

    expect(sentMails).toHaveLength(1);
    const mail = sentMails[0] as {
      to: string | { address: string };
      subject: string;
      text: string;
      headers: Record<string, string>;
    };

    const toAddress = typeof mail.to === 'string' ? mail.to : mail.to.address;
    expect(toAddress).toBe('luke@example.com');
    // Client has preferredLocale = 'de'
    expect(mail.subject).toContain('Termin abgesagt: Studio Portrait Session bei Apex Photography');
    expect(mail.text).toContain('Hallo Luke Cage,');
    expect(mail.text).toContain('Grund der Absage: Emergency studio maintenance');
    expect(mail.headers['Auto-Submitted']).toBe('auto-generated');
  });

  it('AC-5, AC-6: rollback inside database transaction rolls back email_outbox row', async () => {
    const apptId = '01920000-0000-7000-8000-000000000030';

    await dbClient.insert(appointments).values({
      id: apptId,
      title: 'Rollback Test Appointment',
      status: 'scheduled',
      startsAt: new Date('2026-09-01T10:00:00Z'),
      endsAt: new Date('2026-09-01T10:30:00Z'),
      attendeeName: 'Matt Murdock',
      attendeeEmail: 'matt@example.com',
    });

    let attemptedOutboxId = '';

    // Wrap in failing transaction
    await expect(
      dbClient.transaction(async (tx) => {
        const item = await enqueueAppointmentEmail({
          appointmentId: apptId,
          kind: 'appointment_confirmation',
          tx,
        });
        attemptedOutboxId = item.id;
        throw new Error('Simulated booking collision abort');
      }),
    ).rejects.toThrow('Simulated booking collision abort');

    // Outbox row must NOT exist in database
    const [row] = await dbClient
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, attemptedOutboxId))
      .limit(1);

    expect(row).toBeUndefined();
  });

  it('AC-8: logger payloads strictly omit attendee email address, phone, and notes during enqueue and processing', async () => {
    const apptId = '01920000-0000-7000-8000-000000000040';
    const attendeeEmail = 'private.secret@example.com';
    const attendeePhone = '+49 151 99998888';
    const attendeeNotes = 'Highly confidential client health information.';

    await dbClient.insert(appointments).values({
      id: apptId,
      title: 'Confidential Consultation',
      status: 'scheduled',
      startsAt: new Date('2026-10-01T10:00:00Z'),
      endsAt: new Date('2026-10-01T10:30:00Z'),
      attendeeName: 'Karen Page',
      attendeeEmail,
      attendeePhone,
      attendeeNotes,
    });

    const infoCalls: [Record<string, unknown>, string][] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((obj, msg) => {
      infoCalls.push([obj as Record<string, unknown>, String(msg)]);
    });

    // 1. Enqueue
    const outboxItem = await enqueueAppointmentEmail({
      appointmentId: apptId,
      kind: 'appointment_confirmation',
      recipient: attendeeEmail,
      tx: dbClient,
    });

    // Verify enqueue log payload
    expect(infoCalls.length).toBeGreaterThan(0);
    const enqueueLog = infoCalls.find((call) => call[1].includes('enqueued'));
    expect(enqueueLog).toBeDefined();
    if (enqueueLog) {
      const payload = enqueueLog[0];
      expect(payload.appointmentId).toBe(apptId);
      expect(payload.outboxId).toBe(outboxItem.id);

      // Verify no PII is logged
      const payloadStr = JSON.stringify(payload);
      expect(payloadStr).not.toContain(attendeeEmail);
      expect(payloadStr).not.toContain(attendeePhone);
      expect(payloadStr).not.toContain(attendeeNotes);
      expect(payloadStr).not.toContain('Karen Page');
    }

    // 2. Process batch
    const testTransporter = nodemailer.createTransport({ streamTransport: true });
    vi.spyOn(testTransporter, 'sendMail').mockResolvedValue({ messageId: 'msg-456' } as never);

    await processEmailOutboxBatch({
      dbClient,
      transporter: testTransporter,
    });

    // Verify processing log payload
    const processingLog = infoCalls.find((call) => call[1].includes('sent successfully'));
    expect(processingLog).toBeDefined();
    if (processingLog) {
      const payload = processingLog[0];
      expect(payload.appointmentId).toBe(apptId);
      expect(payload.outboxId).toBe(outboxItem.id);

      const payloadStr = JSON.stringify(payload);
      expect(payloadStr).not.toContain(attendeeEmail);
      expect(payloadStr).not.toContain(attendeePhone);
      expect(payloadStr).not.toContain(attendeeNotes);
    }

    infoSpy.mockRestore();
  });
});

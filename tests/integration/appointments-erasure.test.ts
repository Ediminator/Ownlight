import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import {
  resetErasureProviders,
  resetErasureHoldProviders,
} from '@/server/privacy/erasure/registry';
import { planErasure, eraseSubject } from '@/server/privacy/erasure/service';
import { eraseClientDataAction } from '@/server/privacy/erasure/actions';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { appointments, calendarSyncOutbox } from '@/server/db/schema/calendar';
import {
  appointmentsErasureProvider,
  ERASED_ATTENDEE_NAME,
  ERASED_ATTENDEE_EMAIL,
  ERASURE_CANCELLATION_REASON,
} from '@/server/privacy/erasure/appointments';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';

describe('TASK-0041: Appointments GDPR Art. 17 Erasure Integration Tests (AC-2, AC-3)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUserId: string;

  beforeEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetErasureProviders();
    resetErasureHoldProviders();

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    ownerUserId = '01920000-0000-7000-8000-000000000001';
    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Studio Owner',
      email: 'owner@example.com',
      emailVerified: true,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(studioSettings).values({
      id: '01920000-0000-7000-8000-000000000002',
      studio_name: 'Starlight Studio',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      mfa_required: false,
    });
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    await testDb.destroy();
  });

  async function authenticateAsOwner(): Promise<void> {
    const sessionRes = await createSession(ownerUserId, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRes.token);
  }

  it('AC-2: past completed appointments are retained for continuity but attendee PII is anonymized', async () => {
    const clientId = '01920000-0000-7000-8000-000000000010';
    const contactId = '01920000-0000-7000-8000-000000000011';
    const pastApptId = '01920000-0000-7000-8000-000000000012';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Fiona Gallagher',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      updatedAt: new Date('2025-01-01T10:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Fiona',
      familyName: 'Gallagher',
      email: 'fiona@example.com',
      isPrimary: true,
      createdAt: new Date('2025-01-01T10:00:00Z'),
      updatedAt: new Date('2025-01-01T10:00:00Z'),
    });

    // Past completed consultation
    await dbClient.insert(appointments).values({
      id: pastApptId,
      clientId,
      title: 'Completed Portrait Consultation',
      status: 'completed',
      startsAt: new Date('2025-03-01T14:00:00Z'),
      endsAt: new Date('2025-03-01T14:30:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'in_person',
      locationDetails: 'Studio South, Room 2',
      attendeeName: 'Fiona Gallagher',
      attendeeEmail: 'fiona@example.com',
      attendeePhone: '+1 312 555 0144',
      attendeeNotes: 'Sensitive personal background information.',
      createdAt: new Date('2025-02-15T10:00:00Z'),
      updatedAt: new Date('2025-03-01T15:00:00Z'),
    });

    // 1. Plan erasure: verifies category count
    const plan = await planErasure({ kind: 'client', clientId }, dbClient);
    expect(plan).not.toBeNull();
    expect(plan?.categoryCounts.appointments).toBe(1);

    // 2. Execute erasure
    const result = await eraseSubject(
      { kind: 'client', clientId },
      { actor: { actorType: 'owner', actorId: ownerUserId } },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.categoryCounts.appointments).toBe(1);

    // 3. Verify past appointment is RETAINED in db, but all attendee personal data is anonymized
    const [retained] = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, pastApptId))
      .limit(1);

    expect(retained).toBeDefined();
    expect(retained?.title).toBe('Completed Portrait Consultation');
    expect(retained?.status).toBe('completed');
    expect(retained?.attendeeName).toBe(ERASED_ATTENDEE_NAME);
    expect(retained?.attendeeEmail).toBe(ERASED_ATTENDEE_EMAIL);
    expect(retained?.attendeePhone).toBeNull();
    expect(retained?.attendeeNotes).toBeNull();
    expect(retained?.locationDetails).toBeNull();
  });

  it('AC-3: upcoming scheduled appointments are cancelled with reason, attendee details anonymized, and sync outbox items cancelled', async () => {
    const clientId = '01920000-0000-7000-8000-000000000020';
    const contactId = '01920000-0000-7000-8000-000000000021';
    const upcomingApptId = '01920000-0000-7000-8000-000000000022';
    const syncOutboxId = '01920000-0000-7000-8000-000000000023';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'George Washington',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'George',
      familyName: 'Washington',
      email: 'george@example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Upcoming scheduled appointment (in future)
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const futureEndDate = new Date(futureDate.getTime() + 45 * 60 * 1000);

    await dbClient.insert(appointments).values({
      id: upcomingApptId,
      clientId,
      title: 'Upcoming Portrait Shoot Briefing',
      status: 'scheduled',
      startsAt: futureDate,
      endsAt: futureEndDate,
      timezone: 'Europe/Berlin',
      locationType: 'google_meet',
      meetUrl: 'https://meet.google.com/upcoming-sync',
      attendeeName: 'George Washington',
      attendeeEmail: 'george@example.com',
      attendeePhone: '+1 202 555 0176',
      attendeeNotes: 'Briefing notes for session.',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Pending calendar sync task for this appointment
    await dbClient.insert(calendarSyncOutbox).values({
      id: syncOutboxId,
      entityType: 'appointment',
      entityId: upcomingApptId,
      action: 'create',
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Execute erasure
    const result = await eraseSubject(
      { kind: 'client', clientId },
      { actor: { actorType: 'owner', actorId: ownerUserId } },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    // 1. Verify upcoming appointment is updated to 'cancelled' with exact reason and anonymized PII
    const [cancelledAppt] = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, upcomingApptId))
      .limit(1);

    expect(cancelledAppt).toBeDefined();
    expect(cancelledAppt?.status).toBe('cancelled');
    expect(cancelledAppt?.cancellationReason).toBe(ERASURE_CANCELLATION_REASON);
    expect(cancelledAppt?.cancelledAt).toBeInstanceOf(Date);
    expect(cancelledAppt?.attendeeName).toBe(ERASED_ATTENDEE_NAME);
    expect(cancelledAppt?.attendeeEmail).toBe(ERASED_ATTENDEE_EMAIL);
    expect(cancelledAppt?.attendeePhone).toBeNull();
    expect(cancelledAppt?.attendeeNotes).toBeNull();
    expect(cancelledAppt?.locationDetails).toBeNull();

    // 2. Verify pending sync outbox item was cancelled
    const [syncItem] = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.id, syncOutboxId))
      .limit(1);

    expect(syncItem).toBeDefined();
    expect(syncItem?.status).toBe('CANCELLED');
  });

  it('AC-2, AC-3: erases appointments for lead subjects matching leadId or email', async () => {
    const leadId = '01920000-0000-7000-8000-000000000030';
    const formId = '01920000-0000-7000-8000-000000000031';
    const noticeId = '01920000-0000-7000-8000-000000000032';
    const apptId = '01920000-0000-7000-8000-000000000033';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'Inquiry Form',
      slug: 'inq-erase',
      fields: [],
      eventTypes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeId,
      formId,
      version: 1,
      acknowledgementTextEn: 'I consent',
      acknowledgementTextDe: 'Ich stimme zu',
      createdByActorId: ownerUserId,
      createdAt: new Date(),
    });

    await dbClient.insert(leads).values({
      id: leadId,
      formId,
      noticeVersionId: noticeId,
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      givenName: 'Hannah',
      familyName: 'Abbott',
      email: 'hannah@example.com',
      emailNormalized: 'hannah@example.com',
      locale: 'en',
      message: 'Inquiry message',
      noticeAcknowledgedAt: new Date(),
      receivedAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Upcoming appointment linked to lead
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await dbClient.insert(appointments).values({
      id: apptId,
      leadId,
      title: 'Lead Booking Consultation',
      status: 'scheduled',
      startsAt: futureDate,
      endsAt: new Date(futureDate.getTime() + 30 * 60 * 1000),
      timezone: 'Europe/Berlin',
      locationType: 'phone',
      attendeeName: 'Hannah Abbott',
      attendeeEmail: 'hannah@example.com',
      attendeePhone: '+44 20 7946 0991',
    });

    const result = await eraseSubject(
      { kind: 'lead', leadId },
      { actor: { actorType: 'owner', actorId: ownerUserId } },
      dbClient,
    );

    expect(result.success).toBe(true);

    const [scrubbed] = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);

    expect(scrubbed?.status).toBe('cancelled');
    expect(scrubbed?.cancellationReason).toBe(ERASURE_CANCELLATION_REASON);
    expect(scrubbed?.attendeeName).toBe(ERASED_ATTENDEE_NAME);
    expect(scrubbed?.attendeeEmail).toBe(ERASED_ATTENDEE_EMAIL);
    expect(scrubbed?.attendeePhone).toBeNull();
  });

  it('AC-2, AC-3 (R-A): executes erasure via eraseClientDataAction server action with authz', async () => {
    const clientId = '01920000-0000-7000-8000-000000000040';
    const apptId = '01920000-0000-7000-8000-000000000041';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Ian Malcolm',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const contactId = '01920000-0000-7000-8000-000000000042';
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Ian',
      familyName: 'Malcolm',
      email: 'ian@example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await dbClient.insert(appointments).values({
      id: apptId,
      clientId,
      title: 'Chaos Theory Consultation',
      status: 'scheduled',
      startsAt: futureDate,
      endsAt: new Date(futureDate.getTime() + 30 * 60 * 1000),
      timezone: 'America/Chicago',
      locationType: 'google_meet',
      attendeeName: 'Ian Malcolm',
      attendeeEmail: 'ian@example.com',
    });

    // 1. Unauthenticated call fails
    const unauth = await eraseClientDataAction(
      {
        clientId,
        confirmation: 'Ian Malcolm',
      },
      dbClient,
    );
    expect(unauth.success).toBe(false);

    // 2. Authenticated call succeeds
    await authenticateAsOwner();
    const authRes = await eraseClientDataAction(
      {
        clientId,
        confirmation: 'Ian Malcolm',
      },
      dbClient,
    );

    expect(authRes.success).toBe(true);

    const [anonymized] = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);

    expect(anonymized?.status).toBe('cancelled');
    expect(anonymized?.attendeeName).toBe(ERASED_ATTENDEE_NAME);
  });

  it('AC-2, AC-3: erases appointments for contact subject and handles edge cases', async () => {
    const clientId = '01920000-0000-7000-8000-000000000050';
    const contactId = '01920000-0000-7000-8000-000000000051';
    const apptId = '01920000-0000-7000-8000-000000000052';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Acme Corp',
      kind: 'company',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Wile',
      familyName: 'Coyote',
      email: 'coyote@acme.example.com',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: apptId,
      clientId,
      title: 'Acme Corporate Headshot Consultation',
      status: 'scheduled',
      startsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      attendeeName: 'Wile Coyote',
      attendeeEmail: 'coyote@acme.example.com',
      attendeePhone: '+1 555 9999',
    });

    // 1. Plan for contact subject
    const plannedCount = await appointmentsErasureProvider.plan(
      { kind: 'contact', clientId, contactId },
      dbClient,
    );
    expect(plannedCount).toBe(1);

    // 2. Erase contact subject
    const erasedCount = await appointmentsErasureProvider.erase(
      { kind: 'contact', clientId, contactId },
      dbClient,
    );
    expect(erasedCount).toBe(1);

    const [scrubbed] = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, apptId))
      .limit(1);
    expect(scrubbed?.status).toBe('cancelled');
    expect(scrubbed?.attendeeName).toBe(ERASED_ATTENDEE_NAME);

    // 3. Subject with 0 appointments returns 0
    const zeroPlan = await appointmentsErasureProvider.plan(
      { kind: 'client', clientId: '01920000-0000-7000-8000-000000000099' },
      dbClient,
    );
    expect(zeroPlan).toBe(0);

    const zeroErase = await appointmentsErasureProvider.erase(
      { kind: 'client', clientId: '01920000-0000-7000-8000-000000000099' },
      dbClient,
    );
    expect(zeroErase).toBe(0);

    // 4. Contact with no email returns 0
    const noEmailContactId = '01920000-0000-7000-8000-000000000053';
    await dbClient.insert(clientContacts).values({
      id: noEmailContactId,
      clientId,
      givenName: 'Road',
      familyName: 'Runner',
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const noEmailErase = await appointmentsErasureProvider.erase(
      { kind: 'contact', clientId, contactId: noEmailContactId },
      dbClient,
    );
    expect(noEmailErase).toBe(0);
  });
});

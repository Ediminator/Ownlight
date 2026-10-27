import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

const mockHeadersStore = new Map<string, string>();
let mockHeadersThrow = false;

vi.mock('next/headers', () => ({
  headers: () => {
    if (mockHeadersThrow) {
      return Promise.reject(new Error('Headers unavailable in this environment'));
    }
    return Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    });
  },
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import {
  bookingTypes,
  appointments,
  blockedTime,
  calendarSyncOutbox,
} from '@/server/db/schema/calendar';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { emailOutbox } from '@/server/db/schema/email-outbox';
import { auditEvents } from '@/server/db/schema/audit';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import {
  submitPublicBookingAction,
  getPublicAvailableSlotsAction,
  getPublicBookingChallengeAction,
} from '@/server/calendar/public-actions';
import {
  getOrCreatePowSecret,
  createFormChallenge,
  POW_MIN_DURATION_MS,
} from '@/server/inquiry-forms/pow';
import { solveAltchaWebCrypto } from '@/app/[locale]/f/_components/pow-solver';
import { generateSingleEventIcs } from '@/lib/calendar/ics';
import { generateUuidV7 } from '@/lib/id';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import * as settingsRepo from '@/server/settings/repo';
import type { DbClient } from '@/server/db/client';

describe('TASK-0044: Public Booking Scheduler Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  const discoveryCallSlug = 'discovery-call';
  const activeBookingTypeId = '01920000-0000-7000-8000-000000000031';

  beforeEach(async () => {
    mockHeadersThrow = false;
    mockHeadersStore.clear();
    mockHeadersStore.set('x-forwarded-for', '198.51.100.25');

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    // 1. Seed studio settings
    await dbClient.insert(studioSettings).values({
      id: '01920000-0000-7000-8000-000000000002',
      studio_name: 'Starlight Studio',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      forms_pow_hmac_key: 'test-secret-hmac-key-for-pow-verification-12345',
    });

    // 2. Seed calendar data (availability schedules and default booking types)
    await seedDefaultCalendarData(dbClient);
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    await testDb.destroy();
  });

  /**
   * Helper to generate a valid, solved ALTCHA PoW payload.
   * Uses an issued timestamp simulated in the past (> 3000ms ago) to pass the timing guard.
   */
  async function generateValidPowPayload(): Promise<string> {
    const secret = await getOrCreatePowSecret(dbClient);
    // Create challenge with issued timestamp 5 seconds ago
    const pastIssued = Date.now() - (POW_MIN_DURATION_MS + 2000);
    const challenge = await createFormChallenge(secret, {
      maxnumber: 1000,
      params: {
        issued: String(pastIssued),
      },
    });

    const solution = await solveAltchaWebCrypto(challenge);
    if (!solution) throw new Error('Failed to solve test ALTCHA challenge');
    return solution.base64;
  }

  // ==========================================
  // AC-1 & AC-2: Availability & Timezone
  // ==========================================

  it('AC-1: getPublicAvailableSlotsAction returns available slots for active booking type without auth', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
    try {
      const res = await getPublicAvailableSlotsAction(
        {
          slug: discoveryCallSlug,
          startDate: '2026-10-26', // A Monday (active in seed)
          endDate: '2026-10-26',
          timezone: 'Europe/Berlin',
        },
        dbClient,
      );

      expect(res.success).toBe(true);
      if (!res.success || !res.data) return;

      expect(res.data.bookingType.slug).toBe('discovery-call');
      expect(res.data.bookingType.durationMinutes).toBe(30);
      expect(res.data.slots.length).toBeGreaterThan(0);

      const firstSlot = res.data.slots[0];
      expect(firstSlot).toBeDefined();
      expect(firstSlot?.startsAt).toBeDefined();
      expect(firstSlot?.endsAt).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-2: available slots convert UTC times to visitor timezone (America/New_York)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
    try {
      const res = await getPublicAvailableSlotsAction(
        {
          slug: discoveryCallSlug,
          startDate: '2026-10-26',
          endDate: '2026-10-26',
          timezone: 'America/New_York',
        },
        dbClient,
      );

      expect(res.success).toBe(true);
      if (!res.success || !res.data) return;

      // Verify slots are converted to America/New_York (-04:00 offset in late October)
      expect(res.data.slots.length).toBeGreaterThan(0);
      const firstSlot = res.data.slots[0];
      expect(firstSlot?.startsAt).toContain('-04:00');
    } finally {
      vi.useRealTimers();
    }
  });

  // ==========================================
  // AC-3: Valid Booking Submission
  // ==========================================

  it('AC-3: creates appointment in status scheduled, enqueues confirmation email, outbox sync, and logs audit', async () => {
    const powPayload = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T14:00:00Z',
        endsAt: '2026-10-26T14:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Emma Watson',
        attendeeEmail: 'emma.watson@example.com',
        attendeePhone: '+49 30 11223344',
        attendeeNotes: 'Excited about the discovery call.',
        website_url: '',
        altcha_payload: powPayload,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;

    expect(result.data.attendeeName).toBe('Emma Watson');
    expect(result.data.attendeeEmail).toBe('emma.watson@example.com');
    expect(result.data.bookingTypeTitle).toBe('Discovery Call');

    // 1. Verify appointments record in status 'scheduled'
    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, result.data.appointmentId));
    expect(appts).toHaveLength(1);
    expect(appts[0]?.status).toBe('scheduled');
    expect(appts[0]?.attendeeName).toBe('Emma Watson');
    expect(appts[0]?.attendeeEmail).toBe('emma.watson@example.com');

    // 2. Verify email_outbox confirmation email enqueued
    const emails = await dbClient
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.appointmentId, result.data.appointmentId));
    expect(emails).toHaveLength(1);
    expect(emails[0]?.kind).toBe('appointment_confirmation');
    expect(emails[0]?.status).toBe('PENDING');

    // 3. Verify calendar_sync_outbox item enqueued
    const syncTasks = await dbClient
      .select()
      .from(calendarSyncOutbox)
      .where(eq(calendarSyncOutbox.entityId, result.data.appointmentId));
    expect(syncTasks).toHaveLength(1);
    expect(syncTasks[0]?.action).toBe('create');
    expect(syncTasks[0]?.status).toBe('PENDING');

    // 4. Verify audit event appointment.created
    const auditLogs = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, result.data.appointmentId));
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe('appointment.created');
    expect(auditLogs[0]?.outcome).toBe('success');
  });

  // ==========================================
  // AC-4: Existing Client Matching
  // ==========================================

  it('AC-4: matches existing client by email, links clientId, and emits appointment.scheduled on timeline', async () => {
    const existingClientId = '01920000-0000-7000-8000-000000000040';
    const existingContactId = '01920000-0000-7000-8000-000000000041';

    await dbClient.insert(clients).values({
      id: existingClientId,
      displayName: 'Sarah Connor',
      kind: 'person',
      preferredLocale: 'en',
    });

    await dbClient.insert(clientContacts).values({
      id: existingContactId,
      clientId: existingClientId,
      givenName: 'Sarah',
      familyName: 'Connor',
      email: 'sarah.connor@example.com',
      emailNormalized: 'sarah.connor@example.com',
      isPrimary: true,
    });

    const powPayload = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T15:00:00Z',
        endsAt: '2026-10-26T15:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Sarah Connor',
        attendeeEmail: 'sarah.connor@example.com',
        website_url: '',
        altcha_payload: powPayload,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;

    // Verify appointment links to existing clientId
    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, result.data.appointmentId));
    expect(appts[0]?.clientId).toBe(existingClientId);
    expect(appts[0]?.leadId).toBeNull();

    // Verify timeline event appointment.scheduled recorded
    const timeline = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, existingClientId));
    expect(timeline.length).toBeGreaterThan(0);
    const apptEvent = timeline.find((t) => t.type === 'appointment.scheduled');
    expect(apptEvent).toBeDefined();
    expect(apptEvent?.subjectId).toBe(result.data.appointmentId);
  });

  // ==========================================
  // AC-5: Lead Auto-Creation & Linking
  // ==========================================

  it('AC-5: auto-creates verified lead with event_type booking_scheduler when visitor is new', async () => {
    const powPayload = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T16:00:00Z',
        endsAt: '2026-10-26T16:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'John Matrix',
        attendeeEmail: 'john.matrix@example.com',
        attendeePhone: '+1 555 123 4567',
        attendeeNotes: 'Commercial session inquiry.',
        website_url: '',
        altcha_payload: powPayload,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;

    // Verify appointment has a linked leadId
    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, result.data.appointmentId));
    expect(appts[0]?.leadId).toBeDefined();
    expect(appts[0]?.clientId).toBeNull();

    // Verify lead record created in inquiry state
    const createdLeadId = appts[0]?.leadId;
    expect(createdLeadId).toBeDefined();
    const createdLead = await dbClient
      .select()
      .from(leads)
      .where(eq(leads.id, createdLeadId ?? ''));
    expect(createdLead).toHaveLength(1);
    expect(createdLead[0]?.givenName).toBe('John');
    expect(createdLead[0]?.familyName).toBe('Matrix');
    expect(createdLead[0]?.email).toBe('john.matrix@example.com');
    expect(createdLead[0]?.verification).toBe('verified');
    expect(createdLead[0]?.eventTypeKey).toBe('booking_scheduler');
    expect(createdLead[0]?.status).toBe('new');
  });

  it('AC-5: links to existing leadId if attendee email matches an existing lead', async () => {
    const existingLeadId = '01920000-0000-7000-8000-000000000050';

    // Seed valid form and notice version for foreign key constraints
    const formId = '01920000-0000-7000-8000-000000000099';
    const noticeVersionId = '01920000-0000-7000-8000-000000000098';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'test-seed-form',
      name: 'Test Seed Form',
      status: 'published',
      defaultLocale: 'en',
      fields: [],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: false,
      acceptUnverified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'Notice',
      acknowledgementTextDe: 'Hinweis',
      privacyPolicyUrl: '/privacy',
      createdByActorId: 'system',
      createdAt: new Date(),
    });

    await dbClient
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));

    // Insert a lead directly
    const [insertedLead] = await dbClient
      .insert(leads)
      .values({
        id: existingLeadId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: new Date(),
        status: 'new',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Existing',
        familyName: 'Lead',
        email: 'existing.lead@example.com',
        emailNormalized: 'existing.lead@example.com',
      })
      .returning();

    expect(insertedLead).toBeDefined();

    const powPayload = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T17:00:00Z',
        endsAt: '2026-10-26T17:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Existing Lead',
        attendeeEmail: 'existing.lead@example.com',
        website_url: '',
        altcha_payload: powPayload,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;

    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.id, result.data.appointmentId));
    expect(appts[0]?.leadId).toBe(existingLeadId);
    expect(appts[0]?.clientId).toBeNull();
  });

  // ==========================================
  // AC-6: Concurrent Double-Booking Collision
  // ==========================================

  it('AC-6: detects collision and cleanly rolls back when slot is already booked', async () => {
    // 1. First client successfully books 10:00 - 10:30 UTC
    const pow1 = await generateValidPowPayload();
    const res1 = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T10:00:00Z',
        endsAt: '2026-10-26T10:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'First Booker',
        attendeeEmail: 'first@example.com',
        website_url: '',
        altcha_payload: pow1,
        locale: 'en',
      },
      dbClient,
    );
    expect(res1.success).toBe(true);

    // 2. Second client attempts to book the exact same slot concurrently
    const pow2 = await generateValidPowPayload();
    const res2 = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T10:00:00Z',
        endsAt: '2026-10-26T10:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Second Booker',
        attendeeEmail: 'second@example.com',
        website_url: '',
        altcha_payload: pow2,
        locale: 'en',
      },
      dbClient,
    );

    expect(res2.success).toBe(false);
    expect(res2.collision).toBe(true);
    expect(res2.code).toBe('COLLISION');
    expect(res2.error).toBe(
      'This time slot was just booked by another client. Please select another time.',
    );

    // Verify only 1 appointment exists for this slot
    const allAppts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.startsAt, new Date('2026-10-26T10:00:00Z')));
    expect(allAppts).toHaveLength(1);
    expect(allAppts[0]?.attendeeEmail).toBe('first@example.com');
  });

  // ==========================================
  // AC-7: Honeypot & PoW Rejections
  // ==========================================

  it('AC-7: rejects submission without creating DB records if honeypot website_url is populated', async () => {
    const powPayload = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T11:00:00Z',
        endsAt: '2026-10-26T11:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Spam Bot',
        attendeeEmail: 'bot@spam.com',
        website_url: 'https://spam-links.ru',
        altcha_payload: powPayload,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('BOT_DETECTED');

    // Verify no appointments or leads created
    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.attendeeEmail, 'bot@spam.com'));
    expect(appts).toHaveLength(0);
  });

  it('AC-7: rejects submission without creating DB records on invalid or missing ALTCHA PoW', async () => {
    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T12:00:00Z',
        endsAt: '2026-10-26T12:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'No Pow User',
        attendeeEmail: 'nopow@example.com',
        website_url: '',
        altcha_payload: 'invalid-base64-payload',
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('POW_INVALID');

    const appts = await dbClient
      .select()
      .from(appointments)
      .where(eq(appointments.attendeeEmail, 'nopow@example.com'));
    expect(appts).toHaveLength(0);
  });

  // ==========================================
  // AC-8: Rate Limiting
  // ==========================================

  it('AC-8: blocks requests exceeding 5 booking submissions within 15 minutes per IP', async () => {
    mockHeadersStore.set('x-forwarded-for', '203.0.113.50');

    // Submit 5 valid bookings from this IP
    for (let i = 1; i <= 5; i++) {
      const pow = await generateValidPowPayload();
      const hourStr = String(8 + i).padStart(2, '0');
      const res = await submitPublicBookingAction(
        {
          slug: discoveryCallSlug,
          startsAt: `2026-10-27T${hourStr}:00:00Z`,
          endsAt: `2026-10-27T${hourStr}:30:00Z`,
          timezone: 'Europe/Berlin',
          attendeeName: `Client ${String(i)}`,
          attendeeEmail: `client${String(i)}@example.com`,
          website_url: '',
          altcha_payload: pow,
          locale: 'en',
        },
        dbClient,
      );
      expect(res.success).toBe(true);
    }

    // 6th submission from the same IP should be blocked by rate limiter
    const pow6 = await generateValidPowPayload();
    const res6 = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-27T14:00:00Z',
        endsAt: '2026-10-27T14:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Blocked Client',
        attendeeEmail: 'blocked@example.com',
        website_url: '',
        altcha_payload: pow6,
        locale: 'en',
      },
      dbClient,
    );

    expect(res6.success).toBe(false);
    expect(res6.code).toBe('RATE_LIMITED');
    expect(res6.error).toContain('Too many booking attempts');
  });

  // ==========================================
  // AC-9: Inactive Booking Type
  // ==========================================

  it('AC-9: returns NOT_FOUND when booking type is inactive (is_active = false)', async () => {
    // Deactivate discovery-call
    await dbClient
      .update(bookingTypes)
      .set({ isActive: false })
      .where(eq(bookingTypes.id, activeBookingTypeId));

    const resSlots = await getPublicAvailableSlotsAction(
      {
        slug: discoveryCallSlug,
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        timezone: 'Europe/Berlin',
      },
      dbClient,
    );
    expect(resSlots.success).toBe(false);
    expect(resSlots.code).toBe('NOT_FOUND');

    const pow = await generateValidPowPayload();
    const resSubmit = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T14:00:00Z',
        endsAt: '2026-10-26T14:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Client',
        attendeeEmail: 'client@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );
    expect(resSubmit.success).toBe(false);
    expect(resSubmit.code).toBe('NOT_FOUND');
  });

  // ==========================================
  // AC-10: German Localization
  // ==========================================

  it('AC-10: returns localized German collision and rate limit messages when locale is de', async () => {
    // 1. First booking
    const pow1 = await generateValidPowPayload();
    await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T13:00:00Z',
        endsAt: '2026-10-26T13:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Hans Müller',
        attendeeEmail: 'hans@example.de',
        website_url: '',
        altcha_payload: pow1,
        locale: 'de',
      },
      dbClient,
    );

    // 2. Collision with German locale
    const pow2 = await generateValidPowPayload();
    const resColDe = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T13:00:00Z',
        endsAt: '2026-10-26T13:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Gretel Meier',
        attendeeEmail: 'gretel@example.de',
        website_url: '',
        altcha_payload: pow2,
        locale: 'de',
      },
      dbClient,
    );

    expect(resColDe.success).toBe(false);
    expect(resColDe.collision).toBe(true);
    expect(resColDe.error).toBe(
      'Dieser Termin wurde gerade von einem anderen Kunden gebucht. Bitte wählen Sie einen anderen Termin.',
    );
  });

  // ==========================================
  // AC-11: Add to Calendar ICS file download
  // ==========================================

  it('AC-11: generates valid downloadable ICS file content for confirmed appointment', async () => {
    const pow = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T09:00:00Z',
        endsAt: '2026-10-26T09:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Laura Croft',
        attendeeEmail: 'laura@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;

    const icsContent = generateSingleEventIcs({
      uid: result.data.appointmentId,
      title: result.data.title,
      startsAt: result.data.startsAt,
      endsAt: result.data.endsAt,
      attendeeName: result.data.attendeeName,
      attendeeEmail: result.data.attendeeEmail,
      location: result.data.locationDetails ?? 'Google Meet',
    });

    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain(`UID:${result.data.appointmentId}@ownlight`);
    expect(icsContent).toContain('SUMMARY:Discovery Call: Laura Croft');
    expect(icsContent).toContain('STATUS:CONFIRMED');
    expect(icsContent).toContain('END:VCALENDAR');
  });

  // ==========================================
  // Challenge Action
  // ==========================================

  it('getPublicBookingChallengeAction issues valid challenge for active booking type', async () => {
    const challengeRes = await getPublicBookingChallengeAction(discoveryCallSlug, dbClient);
    expect(challengeRes.success).toBe(true);
    if (!challengeRes.success || !challengeRes.data) return;

    expect(challengeRes.data.algorithm).toBe('SHA-256');
    expect(challengeRes.data.challenge).toBeDefined();
    expect(challengeRes.data.salt).toBeDefined();
  });

  it('AC-6: detects collision with blocked time intervals', async () => {
    await dbClient.insert(blockedTime).values({
      id: '01920000-0000-7000-8000-000000000088',
      startsAt: new Date('2026-10-26T12:00:00Z'),
      endsAt: new Date('2026-10-26T13:00:00Z'),
      title: 'Studio Maintenance',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const pow = await generateValidPowPayload();
    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T12:00:00Z',
        endsAt: '2026-10-26T12:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Blocked Slot Tester',
        attendeeEmail: 'blocked@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('COLLISION');
    expect(result.collision).toBe(true);
  });

  it('handles FormData input and maps validation failure fieldErrors', async () => {
    const fd = new FormData();
    fd.append('slug', discoveryCallSlug);
    fd.append('startsAt', '2026-10-26T09:00:00Z');
    fd.append('endsAt', '2026-10-26T09:30:00Z');
    fd.append('timezone', 'Europe/Berlin');
    fd.append('attendeeName', '');
    fd.append('attendeeEmail', 'invalid-email');
    fd.append('altcha_payload', 'payload');
    fd.append('locale', 'en');

    const result = await submitPublicBookingAction(fd, dbClient);
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.fieldErrors).toBeDefined();
    expect(result.fieldErrors?.attendeeName).toBeDefined();
    expect(result.fieldErrors?.attendeeEmail).toBeDefined();
  });

  it('submits successfully via FormData', async () => {
    const pow = await generateValidPowPayload();
    const fd = new FormData();
    fd.append('slug', discoveryCallSlug);
    fd.append('startsAt', '2026-10-26T15:00:00Z');
    fd.append('endsAt', '2026-10-26T15:30:00Z');
    fd.append('timezone', 'Europe/Berlin');
    fd.append('attendeeName', 'Form Data Visitor');
    fd.append('attendeeEmail', 'formdata@example.com');
    fd.append('website_url', '');
    fd.append('altcha_payload', pow);
    fd.append('locale', 'en');

    const result = await submitPublicBookingAction(fd, dbClient);
    expect(result.success).toBe(true);
    expect(result.data?.attendeeName).toBe('Form Data Visitor');
  });

  it('getPublicAvailableSlotsAction returns VALIDATION_FAILED on invalid input', async () => {
    const result = await getPublicAvailableSlotsAction(
      { slug: '', startDate: 'invalid', endDate: 'invalid', timezone: '' },
      dbClient,
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.fields).toBeDefined();
  });

  it('AC-6: catches serialization failure (40001) and returns friendly collision error', async () => {
    const pow = await generateValidPowPayload();
    const txSpy = vi
      .spyOn(dbClient, 'transaction')
      .mockRejectedValueOnce(
        new Error('could not serialize access due to concurrent update (40001)'),
      );

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T16:00:00Z',
        endsAt: '2026-10-26T16:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Concurrency Test',
        attendeeEmail: 'concurrent@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'de',
      },
      dbClient,
    );

    txSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.code).toBe('COLLISION');
    expect(result.collision).toBe(true);
    expect(result.error).toContain('Dieser Termin wurde gerade von einem anderen Kunden gebucht');
  });

  it('catches generic unexpected errors and returns INTERNAL_ERROR', async () => {
    const pow = await generateValidPowPayload();
    const txSpy = vi
      .spyOn(dbClient, 'transaction')
      .mockRejectedValueOnce(new Error('Unexpected disk read failure'));

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T16:00:00Z',
        endsAt: '2026-10-26T16:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Crash Test',
        attendeeEmail: 'crash@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );

    txSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.error).toContain('An error occurred while booking');
  });

  it('returns RATE_LIMITED when challenge requests exceed rate limit', async () => {
    for (let i = 0; i < 30; i++) {
      await getPublicBookingChallengeAction(discoveryCallSlug, dbClient);
    }
    const rateLimitedRes = await getPublicBookingChallengeAction(discoveryCallSlug, dbClient);
    expect(rateLimitedRes.success).toBe(false);
    expect(rateLimitedRes.code).toBe('RATE_LIMITED');
  });

  it('AC-6: detects collision with shoot record', async () => {
    const [c] = await dbClient
      .insert(clients)
      .values({
        id: generateUuidV7(),
        kind: 'person',
        displayName: 'Shoot Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const stages = await dbClient.select().from(pipelineStages).limit(1);
    const stageId = stages[0]?.id;

    if (stageId && c?.id) {
      const [proj] = await dbClient
        .insert(projects)
        .values({
          id: generateUuidV7(),
          clientId: c.id,
          stageId,
          title: 'Wedding Shoot Project',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (proj?.id) {
        await dbClient.insert(shoots).values({
          id: generateUuidV7(),
          projectId: proj.id,
          title: 'Main Ceremony Shoot',
          startsAt: new Date('2026-10-26T14:00:00Z'),
          endsAt: new Date('2026-10-26T15:00:00Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const pow = await generateValidPowPayload();
        const result = await submitPublicBookingAction(
          {
            slug: discoveryCallSlug,
            startsAt: '2026-10-26T14:00:00Z',
            endsAt: '2026-10-26T14:30:00Z',
            timezone: 'Europe/Berlin',
            attendeeName: 'Colliding Shoot Tester',
            attendeeEmail: 'shoot@example.com',
            website_url: '',
            altcha_payload: pow,
            locale: 'en',
          },
          dbClient,
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe('COLLISION');
        expect(result.collision).toBe(true);
      }
    }
  });

  it('supports useActionState 2-arg signature (prevState, formData, dbClient)', async () => {
    const pow = await generateValidPowPayload();
    const fd = new FormData();
    fd.append('slug', discoveryCallSlug);
    fd.append('startsAt', '2026-10-26T17:00:00Z');
    fd.append('endsAt', '2026-10-26T17:30:00Z');
    fd.append('timezone', 'Europe/Berlin');
    fd.append('attendeeName', 'Cher');
    fd.append('attendeeEmail', 'cher@example.com');
    fd.append('website_url', '');
    fd.append('altcha_payload', pow);
    fd.append('locale', 'de');

    const prevState = { success: false };
    const result = await submitPublicBookingAction(prevState, fd, dbClient);
    expect(result.success).toBe(true);
    expect(result.data?.attendeeName).toBe('Cher');
  });

  it('handles submission when headers are absent (clientIp null)', async () => {
    mockHeadersStore.clear();
    const pow = await generateValidPowPayload();

    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T17:30:00Z',
        endsAt: '2026-10-26T18:00:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'No IP Visitor',
        attendeeEmail: 'noip@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );

    expect(result.success).toBe(true);
  });

  it('I1-S01: maps unresolved clientIp (null) to shared unknown bucket and rate limits after 5 attempts', async () => {
    mockHeadersStore.clear();

    // The previous test already used 1 attempt with null clientIp (bucket 'unknown')
    // Attempt additional submissions until limit of 5 is exceeded
    let rateLimitedResult: Awaited<ReturnType<typeof submitPublicBookingAction>> | null = null;
    for (let i = 0; i < 6; i++) {
      const pow = await generateValidPowPayload();
      const res = await submitPublicBookingAction(
        {
          slug: discoveryCallSlug,
          startsAt: `2026-10-27T${String(10 + i).padStart(2, '0')}:00:00Z`,
          endsAt: `2026-10-27T${String(10 + i).padStart(2, '0')}:30:00Z`,
          timezone: 'Europe/Berlin',
          attendeeName: `No IP Attendee ${String(i)}`,
          attendeeEmail: `noip${String(i)}@example.com`,
          website_url: '',
          altcha_payload: pow,
          locale: 'en',
        },
        dbClient,
      );
      if (!res.success && res.code === 'RATE_LIMITED') {
        rateLimitedResult = res;
        break;
      }
    }

    expect(rateLimitedResult).not.toBeNull();
    expect(rateLimitedResult?.success).toBe(false);
    expect(rateLimitedResult?.code).toBe('RATE_LIMITED');
    expect(rateLimitedResult?.error).toContain('Too many booking attempts');
  }, 120_000);

  it('AC-7: returns localized German error on invalid PoW when locale is de', async () => {
    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T18:00:00Z',
        endsAt: '2026-10-26T18:30:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'German PoW Tester',
        attendeeEmail: 'pow.de@example.com',
        website_url: '',
        altcha_payload: 'invalid-payload-data',
        locale: 'de',
      },
      dbClient,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('POW_INVALID');
    expect(result.error).toContain('Sicherheitsüberprüfung fehlgeschlagen');
  });

  it('handles null/non-object input safely', async () => {
    const result = await submitPublicBookingAction(null, dbClient);
    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
  });

  it('getPublicBookingChallengeAction falls back to unknown IP when headers() throws', async () => {
    mockHeadersThrow = true;
    const res = await getPublicBookingChallengeAction(discoveryCallSlug, dbClient);
    expect(res.success).toBe(true);
    expect(res.data?.algorithm).toBe('SHA-256');
  });

  it('submitPublicBookingAction falls back to null IP when headers() throws', async () => {
    mockHeadersThrow = true;
    const pow = await generateValidPowPayload();
    const result = await submitPublicBookingAction(
      {
        slug: discoveryCallSlug,
        startsAt: '2026-10-26T18:30:00Z',
        endsAt: '2026-10-26T19:00:00Z',
        timezone: 'Europe/Berlin',
        attendeeName: 'Headers Throw Visitor',
        attendeeEmail: 'headersthrow@example.com',
        website_url: '',
        altcha_payload: pow,
        locale: 'en',
      },
      dbClient,
    );
    expect(result.success).toBe(true);
  });

  it('getPublicAvailableSlotsAction falls back to Europe/Berlin when getStudioSettings throws', async () => {
    const spy = vi
      .spyOn(settingsRepo, 'getStudioSettings')
      .mockRejectedValueOnce(new Error('DB settings failed'));

    const res = await getPublicAvailableSlotsAction(
      {
        slug: discoveryCallSlug,
        startDate: '2026-10-26',
        endDate: '2026-10-27',
        timezone: 'UTC',
      },
      dbClient,
    );
    expect(res.success).toBe(true);
    expect(res.data?.studioTimezone).toBe('Europe/Berlin');

    spy.mockRestore();
  });

  it('handles shoot with null endsAt during availability calculation', async () => {
    const [c] = await dbClient
      .insert(clients)
      .values({
        id: generateUuidV7(),
        kind: 'person',
        displayName: 'Open Shoot Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const stages = await dbClient.select().from(pipelineStages).limit(1);
    const stageId = stages[0]?.id;

    if (stageId && c?.id) {
      const [proj] = await dbClient
        .insert(projects)
        .values({
          id: generateUuidV7(),
          clientId: c.id,
          stageId,
          title: 'Open Shoot Project',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (proj?.id) {
        await dbClient.insert(shoots).values({
          id: generateUuidV7(),
          projectId: proj.id,
          title: 'Open Shoot Without EndsAt',
          startsAt: new Date('2026-10-26T11:00:00Z'),
          endsAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await getPublicAvailableSlotsAction(
          {
            slug: discoveryCallSlug,
            startDate: '2026-10-26',
            endDate: '2026-10-26',
            timezone: 'UTC',
          },
          dbClient,
        );

        expect(res.success).toBe(true);
      }
    }
  });
});

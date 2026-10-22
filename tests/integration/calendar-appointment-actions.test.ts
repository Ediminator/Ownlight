import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { createAppointmentAction, cancelAppointmentAction } from '@/server/calendar/actions';
import { user } from '@/server/db/schema/auth';
import { clients } from '@/server/db/schema/clients';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { appointments } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq } from 'drizzle-orm';

describe('TASK-0042: Calendar Appointment Actions Integration Tests (AC-5, AC-6, AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let testClientId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Create Owner User
    const [insertedUser] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedUser) throw new Error('Expected user to be inserted');
    ownerUser = insertedUser;

    // 2. Create Owner Session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Create sample client for timeline checks
    const [insertedClient] = await dbClient
      .insert(clients)
      .values({
        id: '01920000-0000-7000-8000-000000000051',
        displayName: 'Emma Watson',
        kind: 'person',
        preferredLocale: 'en',
      })
      .returning();
    if (!insertedClient) throw new Error('Expected client to be inserted');
    testClientId = insertedClient.id;
  }, 30000);

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  describe('AC-5: Appointment Creation Server Action', () => {
    it('AC-5: creates appointment with attendee details and records appointment.created audit log', async () => {
      const startsAt = new Date('2026-10-25T10:00:00.000Z');
      const endsAt = new Date('2026-10-25T11:00:00.000Z');

      const result = await createAppointmentAction(
        {
          title: 'Consultation with Emma',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          attendeeName: 'Emma Watson',
          attendeeEmail: 'emma@example.org',
          attendeePhone: '+49 30 123456',
          locationType: 'google_meet',
          attendeeNotes: 'Discussing wedding packages',
          clientId: testClientId,
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.title).toBe('Consultation with Emma');
      expect(result.data.attendeeName).toBe('Emma Watson');
      expect(result.data.status).toBe('scheduled');

      // Verify DB record
      const [apptInDb] = await dbClient
        .select()
        .from(appointments)
        .where(eq(appointments.id, result.data.id));
      expect(apptInDb).toBeDefined();
      expect(apptInDb?.attendeeEmail).toBe('emma@example.org');

      // Verify Audit Log (AC-5)
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'appointment.created'));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(result.data.id);
    });

    it('AC-5: rejects appointment creation with invalid date range or missing required fields', async () => {
      const result = await createAppointmentAction(
        {
          title: 'Invalid Appointment',
          startsAt: '2026-10-25T12:00:00.000Z',
          endsAt: '2026-10-25T10:00:00.000Z', // ends before starts
          attendeeName: 'Test',
          attendeeEmail: 'test@example.org',
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('AC-6: Appointment Cancellation Server Action', () => {
    it('AC-6: cancels appointment with reason, logs audit and timeline events', async () => {
      // 1. First create an appointment
      const createRes = await createAppointmentAction(
        {
          title: 'Consultation to Cancel',
          startsAt: '2026-10-26T14:00:00.000Z',
          endsAt: '2026-10-26T15:00:00.000Z',
          attendeeName: 'Emma Watson',
          attendeeEmail: 'emma@example.org',
          clientId: testClientId,
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;

      const apptId = createRes.data.id;

      // 2. Cancel appointment
      const cancelRes = await cancelAppointmentAction(
        apptId,
        { reason: 'Client requested reschedule due to illness' },
        dbClient,
      );

      expect(cancelRes.success).toBe(true);
      if (!cancelRes.success) return;

      expect(cancelRes.data.status).toBe('cancelled');
      expect(cancelRes.data.cancellationReason).toBe('Client requested reschedule due to illness');

      // Verify DB record updated
      const [updatedDb] = await dbClient
        .select()
        .from(appointments)
        .where(eq(appointments.id, apptId));
      expect(updatedDb?.status).toBe('cancelled');

      // Verify Timeline event (AC-6)
      const timelineRows = await dbClient
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.type, 'appointment.cancelled'));
      expect(timelineRows.length).toBeGreaterThan(0);
      expect(timelineRows[0]?.clientId).toBe(testClientId);

      // Verify Audit log (AC-6)
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'appointment.cancelled'));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(apptId);
    });
  });

  describe('AC-9: Unauthenticated access rejection', () => {
    it('AC-9: rejects unauthenticated call to createAppointmentAction with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear(); // remove owner session

      const result = await createAppointmentAction(
        {
          title: 'Unauthenticated appointment',
          startsAt: '2026-10-25T10:00:00.000Z',
          endsAt: '2026-10-25T11:00:00.000Z',
          attendeeName: 'Hacker',
          attendeeEmail: 'hacker@example.org',
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-9: rejects unauthenticated call to cancelAppointmentAction with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const result = await cancelAppointmentAction(
        '01920000-0000-7000-8000-000000000099',
        { reason: 'Unauthorized' },
        dbClient,
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });
  });
});

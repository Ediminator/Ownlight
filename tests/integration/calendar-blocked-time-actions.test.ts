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
import {
  createBlockedTimeAction,
  updateBlockedTimeAction,
  deleteBlockedTimeAction,
  getCalendarEventsAction,
  createAppointmentAction,
} from '@/server/calendar/actions';
import { user } from '@/server/db/schema/auth';
import { clients } from '@/server/db/schema/clients';
import { projects, shoots, shootLocations } from '@/server/db/schema/projects';
import { blockedTime } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq } from 'drizzle-orm';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';

describe('TASK-0042: Calendar Blocked Time & Unified Query Actions (AC-1, AC-7, AC-8, AC-9)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    await seedDefaultPipelineStages(dbClient);

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
  }, 30000);

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  describe('AC-7: Blocked Time Creation Server Action', () => {
    it('AC-7: creates blackout window with "Studio Maintenance" and all-day checked', async () => {
      const startsAt = new Date('2026-10-28T00:00:00.000Z');
      const endsAt = new Date('2026-10-28T23:59:59.999Z');

      const result = await createBlockedTimeAction(
        {
          title: 'Studio Maintenance',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          allDay: true,
          notes: 'Annual studio painting and lighting overhaul',
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.title).toBe('Studio Maintenance');
      expect(result.data.allDay).toBe(true);

      // Verify in DB
      const [inDb] = await dbClient
        .select()
        .from(blockedTime)
        .where(eq(blockedTime.id, result.data.id));
      expect(inDb).toBeDefined();
      expect(inDb?.allDay).toBe(true);

      // Verify Audit log (AC-7)
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'blocked_time.created'));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(result.data.id);
    });
  });

  describe('AC-8: Blocked Time Update and Deletion Server Action', () => {
    it('AC-8: deletes existing blocked time record and logs blocked_time.deleted', async () => {
      // 1. Create a blocked time
      const createRes = await createBlockedTimeAction(
        {
          title: 'To Be Deleted',
          startsAt: '2026-10-29T10:00:00.000Z',
          endsAt: '2026-10-29T12:00:00.000Z',
          allDay: false,
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;

      const blockId = createRes.data.id;

      // 2. Delete blocked time
      const delRes = await deleteBlockedTimeAction(blockId, dbClient);
      expect(delRes.success).toBe(true);

      // Verify DB record is gone
      const [inDb] = await dbClient.select().from(blockedTime).where(eq(blockedTime.id, blockId));
      expect(inDb).toBeUndefined();

      // Verify Audit log (AC-8)
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'blocked_time.deleted'));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(blockId);
    });

    it('AC-8: updates existing blocked time record', async () => {
      const createRes = await createBlockedTimeAction(
        {
          title: 'Original Block',
          startsAt: '2026-10-29T10:00:00.000Z',
          endsAt: '2026-10-29T12:00:00.000Z',
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;

      const updateRes = await updateBlockedTimeAction(
        createRes.data.id,
        {
          title: 'Updated Block Title',
          allDay: true,
        },
        dbClient,
      );

      expect(updateRes.success).toBe(true);
      if (!updateRes.success) return;
      expect(updateRes.data.title).toBe('Updated Block Title');
      expect(updateRes.data.allDay).toBe(true);
    });
  });

  describe('AC-1: Unified Range Query Aggregating Shoots, Appointments, and Blocked Time', () => {
    it('AC-1: returns unified calendar events across shoots, appointments, and blocked time', async () => {
      // 1. Create client & project
      const [client] = await dbClient
        .insert(clients)
        .values({
          id: '01920000-0000-7000-8000-000000000061',
          displayName: 'John Doe',
          kind: 'person',
          preferredLocale: 'en',
        })
        .returning();

      if (!client) throw new Error('Expected client');

      const [proj] = await dbClient
        .insert(projects)
        .values({
          id: '01920000-0000-7000-8000-000000000071',
          clientId: client.id,
          stageId: '01920000-0000-7000-8000-000000000001',
          title: 'Wedding: John & Jane',
          projectTypeKey: 'wedding',
        })
        .returning();
      if (!proj) throw new Error('Expected project');

      // 2. Create Shoot with Location
      const [shoot] = await dbClient
        .insert(shoots)
        .values({
          id: '01920000-0000-7000-8000-000000000081',
          projectId: proj.id,
          title: 'Ceremony Shoot',
          startsAt: new Date('2026-10-20T14:00:00.000Z'),
          endsAt: new Date('2026-10-20T18:00:00.000Z'),
        })
        .returning();
      if (!shoot) throw new Error('Expected shoot');

      await dbClient.insert(shootLocations).values({
        id: '01920000-0000-7000-8000-000000000082',
        shootId: shoot.id,
        name: 'St. Mary Church',
        order: 1,
      });

      // 3. Create Appointment
      await createAppointmentAction(
        {
          title: 'Consultation with John',
          startsAt: '2026-10-21T10:00:00.000Z',
          endsAt: '2026-10-21T11:00:00.000Z',
          attendeeName: 'John Doe',
          attendeeEmail: 'john@example.org',
          locationType: 'in_person',
        },
        dbClient,
      );

      // 4. Create Blocked Time
      await createBlockedTimeAction(
        {
          title: 'Studio Maintenance',
          startsAt: '2026-10-22T00:00:00.000Z',
          endsAt: '2026-10-22T23:59:59.999Z',
          allDay: true,
        },
        dbClient,
      );

      // 5. Query Unified Events for October 2026
      const result = await getCalendarEventsAction(
        {
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-10-31T23:59:59.999Z',
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      const events = result.data;
      expect(events.length).toBeGreaterThanOrEqual(3);

      // Shoot check
      const shootEvt = events.find((e) => e.type === 'shoot');
      expect(shootEvt).toBeDefined();
      expect(shootEvt?.title).toBe('Ceremony Shoot');
      expect(shootEvt?.projectTitle).toBe('Wedding: John & Jane');
      expect(shootEvt?.locationName).toBe('St. Mary Church');

      // Appointment check
      const apptEvt = events.find((e) => e.type === 'appointment');
      expect(apptEvt).toBeDefined();
      expect(apptEvt?.attendeeName).toBe('John Doe');
      expect(apptEvt?.locationType).toBe('in_person');

      // Blocked Time check
      const blockEvt = events.find((e) => e.type === 'blocked_time');
      expect(blockEvt).toBeDefined();
      expect(blockEvt?.title).toBe('Studio Maintenance');
      expect(blockEvt?.allDay).toBe(true);
    });
  });

  describe('AC-9: Unauthenticated access rejection', () => {
    it('AC-9: rejects unauthenticated call to createBlockedTimeAction with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const result = await createBlockedTimeAction(
        {
          title: 'Hacked Blocked Time',
          startsAt: '2026-10-28T00:00:00.000Z',
          endsAt: '2026-10-28T23:59:59.999Z',
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-9: rejects unauthenticated call to deleteBlockedTimeAction with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const result = await deleteBlockedTimeAction('some-id', dbClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-9: rejects unauthenticated call to getCalendarEventsAction with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const result = await getCalendarEventsAction(
        {
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-10-31T23:59:59.999Z',
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });
  });
});

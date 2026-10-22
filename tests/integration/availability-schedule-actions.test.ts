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
  updateWeeklyScheduleAction,
  createDateOverrideAction,
  deleteDateOverrideAction,
} from '@/server/calendar/availability-actions';
import { user } from '@/server/db/schema/auth';
import { availabilitySchedules, availabilityOverrides } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import * as service from '@/server/calendar/service';
import * as repo from '@/server/calendar/repo';

describe('TASK-0043: Availability Schedule & Date Override Actions Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Seed default calendar data (schedules and booking types)
    await seedDefaultCalendarData(dbClient);

    // Create Owner User
    const [insertedUser] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Studio Owner',
        email: 'owner@example.org',
        role: 'owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedUser) throw new Error('Expected user to be inserted');
    ownerUser = insertedUser;

    // Create Owner Session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  }, 60000);

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  // AC-1: updateWeeklyScheduleAction persists schedule and records audit log
  describe('AC-1: Weekly Schedule Persistence (R-A)', () => {
    it('AC-1: updates Monday working hours to 08:30 - 16:30, persists schedules, and emits availability.updated audit log', async () => {
      // Modify Monday (dayOfWeek: 1) to 08:30 - 16:30
      const schedulesPayload = [
        { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isActive: false },
        { dayOfWeek: 1, startTime: '08:30', endTime: '16:30', isActive: true },
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isActive: true },
        { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', isActive: true },
        { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', isActive: true },
        { dayOfWeek: 5, startTime: '09:00', endTime: '17:00', isActive: true },
        { dayOfWeek: 6, startTime: '10:00', endTime: '14:00', isActive: false },
      ];

      const result = await updateWeeklyScheduleAction({ schedules: schedulesPayload }, dbClient);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toHaveLength(7);
      const monday = result.data.find((s) => s.dayOfWeek === 1);
      expect(monday).toBeDefined();
      expect(monday?.startTime).toBe('08:30');
      expect(monday?.endTime).toBe('16:30');
      expect(monday?.isActive).toBe(true);

      // Verify DB persistence
      const dbSchedules = await dbClient
        .select()
        .from(availabilitySchedules)
        .where(eq(availabilitySchedules.dayOfWeek, 1));
      expect(dbSchedules[0]?.startTime).toBe('08:30');
      expect(dbSchedules[0]?.endTime).toBe('16:30');

      // Verify audit log availability.updated
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'availability.updated'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      const auditEvent = auditRows[0];
      expect(auditEvent).toBeDefined();
      if (!auditEvent) return;
      expect(auditEvent.action).toBe('availability.updated');
      expect(auditEvent.actorId).toBe(ownerUser.id);
      expect(auditEvent.targetType).toBe('availability');
      expect(auditEvent.targetId).toBe('schedules');
      expect(auditEvent.outcome).toBe('success');
      expect(auditEvent.metadata).toMatchObject({
        schedule_count: 7,
      });
    });
  });

  // AC-2: Client and server validation for startTime < endTime
  describe('AC-2: Weekly Schedule Validation', () => {
    it('AC-2: rejects schedule submission when daily endTime <= startTime (e.g. 17:00 - 09:00)', async () => {
      const invalidPayload = [
        { dayOfWeek: 1, startTime: '17:00', endTime: '09:00', isActive: true },
      ];

      const result = await updateWeeklyScheduleAction({ schedules: invalidPayload }, dbClient);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('VALIDATION_FAILED');
      expect(result.error).toContain('End time must be after start time');
      expect(result.fields).toBeDefined();
    });
  });

  // AC-3: Date Overrides Creation (R-A)
  describe('AC-3: Date Override Creation (R-A)', () => {
    it('AC-3: creates date override for 2026-11-20 marked unavailable with reason Conference and logs availability.updated', async () => {
      const result = await createDateOverrideAction(
        {
          date: '2026-11-20',
          isUnavailable: true,
          reason: 'Conference',
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.date).toBe('2026-11-20');
      expect(result.data.isUnavailable).toBe(true);
      expect(result.data.reason).toBe('Conference');

      // Verify DB persistence
      const dbOverrides = await dbClient
        .select()
        .from(availabilityOverrides)
        .where(eq(availabilityOverrides.id, result.data.id));
      expect(dbOverrides).toHaveLength(1);
      expect(dbOverrides[0]?.reason).toBe('Conference');

      // Verify audit log availability.updated with non-PII constraint
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'availability.updated'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      const auditEvent = auditRows[0];
      expect(auditEvent).toBeDefined();
      if (!auditEvent) return;
      expect(auditEvent.actorId).toBe(ownerUser.id);
      expect(auditEvent.targetId).toBe(result.data.id);
      // Ensure reason is NOT logged in audit metadata (privacy requirement)
      expect(auditEvent.metadata).not.toHaveProperty('reason');
    });
  });

  // AC-4: Date Override Deletion (R-A)
  describe('AC-4: Date Override Deletion (R-A)', () => {
    it('AC-4: deletes existing date override restoring default hours and records availability.updated', async () => {
      // 1. Create an override
      const createRes = await createDateOverrideAction(
        {
          date: '2026-12-15',
          isUnavailable: true,
          reason: 'Holiday',
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;
      const overrideId = createRes.data.id;

      // 2. Delete the override
      const deleteRes = await deleteDateOverrideAction(overrideId, dbClient);
      expect(deleteRes.success).toBe(true);

      // Verify DB record is removed
      const remaining = await dbClient
        .select()
        .from(availabilityOverrides)
        .where(eq(availabilityOverrides.id, overrideId));
      expect(remaining).toHaveLength(0);

      // Verify audit log
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'availability.updated'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(overrideId);
    });

    it('AC-4: accepts delete input as object with id and rejects invalid non-string input', async () => {
      // 1. Create an override
      const createRes = await createDateOverrideAction(
        {
          date: '2026-12-16',
          isUnavailable: true,
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;

      // Delete with object payload { id: ... }
      const objDeleteRes = await deleteDateOverrideAction({ id: createRes.data.id }, dbClient);
      expect(objDeleteRes.success).toBe(true);

      // Delete with invalid payload
      const invalidRes = await deleteDateOverrideAction(12345, dbClient);
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.code).toBe('VALIDATION_FAILED');
      }
    });

    it('AC-3: rejects date override creation with invalid date or times', async () => {
      const invalidRes = await createDateOverrideAction({ date: 'invalid-date' }, dbClient);
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // AC-8: Unauthenticated access rejection
  describe('AC-8: Authorization Enforcement', () => {
    it('AC-8: rejects unauthenticated schedule update with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear(); // remove session

      const res = await updateWeeklyScheduleAction(
        {
          schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }],
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-8: rejects unauthenticated date override creation with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const res = await createDateOverrideAction(
        {
          date: '2026-11-20',
          isUnavailable: true,
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-8: rejects unauthenticated date override deletion with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const res = await deleteDateOverrideAction('01920000-0000-7000-8000-000000000099', dbClient);

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  describe('Service & Repo direct queries for overrides', () => {
    it('fetches all availability overrides via repo and service', async () => {
      const overridesBefore = await service.getAllAvailabilityOverrides(dbClient);
      const repoBefore = await repo.listAllAvailabilityOverrides(dbClient);
      expect(overridesBefore).toEqual([]);
      expect(repoBefore).toEqual([]);

      // Insert an override
      await service.createAvailabilityOverride(
        { date: '2026-11-20', isUnavailable: true, reason: 'Conference' },
        ownerUser.id,
        dbClient,
      );

      const overridesAfter = await service.getAllAvailabilityOverrides(dbClient);
      const repoAfter = await repo.listAllAvailabilityOverrides(dbClient);
      expect(overridesAfter.length).toBe(1);
      expect(repoAfter.length).toBe(1);
      expect(overridesAfter[0]?.reason).toBe('Conference');
    });

    it('returns NOT_FOUND when deleting a non-existent override directly in service', async () => {
      const res = await service.deleteAvailabilityOverride(
        '01920000-0000-7000-8000-000000000099',
        ownerUser.id,
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('returns VALIDATION_FAILED when creating an invalid override directly in service', async () => {
      const res = await service.createAvailabilityOverride(
        { date: 'bad-date', isUnavailable: true },
        ownerUser.id,
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });
});

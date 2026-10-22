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
  createBookingTypeAction,
  updateBookingTypeAction,
  deleteBookingTypeAction,
} from '@/server/calendar/availability-actions';
import { user } from '@/server/db/schema/auth';
import { bookingTypes } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import * as service from '@/server/calendar/service';

describe('TASK-0043: Booking Type Actions Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Seed default calendar data (creates discovery-call, wedding-consultation)
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
  }, 30000);

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  // AC-5: Create Booking Type Action
  describe('AC-5: Booking Type Creation (R-A)', () => {
    it('AC-5: creates booking type Portrait Consultation and logs booking_type.created', async () => {
      const result = await createBookingTypeAction(
        {
          title: 'Portrait Consultation',
          slug: 'portrait-consultation',
          durationMinutes: 45,
          bufferBeforeMinutes: 10,
          bufferAfterMinutes: 15,
          minNoticeHours: 24,
          maxFutureDays: 60,
          locationType: 'google_meet',
          color: 'indigo',
          isActive: true,
        },
        dbClient,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.title).toBe('Portrait Consultation');
      expect(result.data.slug).toBe('portrait-consultation');
      expect(result.data.durationMinutes).toBe(45);
      expect(result.data.bufferBeforeMinutes).toBe(10);
      expect(result.data.bufferAfterMinutes).toBe(15);
      expect(result.data.locationType).toBe('google_meet');

      // Verify DB persistence
      const dbRows = await dbClient
        .select()
        .from(bookingTypes)
        .where(eq(bookingTypes.slug, 'portrait-consultation'));
      expect(dbRows).toHaveLength(1);
      expect(dbRows[0]?.title).toBe('Portrait Consultation');

      // Verify audit log booking_type.created
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'booking_type.created'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      const auditEvent = auditRows[0];
      expect(auditEvent).toBeDefined();
      if (!auditEvent) return;
      expect(auditEvent.action).toBe('booking_type.created');
      expect(auditEvent.actorId).toBe(ownerUser.id);
      expect(auditEvent.targetId).toBe(result.data.id);
      expect(auditEvent.metadata).toMatchObject({
        booking_type_id: result.data.id,
        slug: 'portrait-consultation',
        duration_minutes: 45,
      });
    });
  });

  // AC-6: Slug Uniqueness and Format Validation
  describe('AC-6: Slug Validation and Uniqueness', () => {
    it('AC-6: rejects duplicate slug with CONFLICT code', async () => {
      // Default seed creates "discovery-call"
      const result = await createBookingTypeAction(
        {
          title: 'Another Discovery Call',
          slug: 'discovery-call', // already exists
          durationMinutes: 30,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('CONFLICT');
      expect(result.error).toContain('already exists');
    });

    it('AC-6: rejects invalid slug formats with VALIDATION_FAILED code', async () => {
      const result = await createBookingTypeAction(
        {
          title: 'Invalid Slug',
          slug: 'invalid_slug_with_underscores',
          durationMinutes: 30,
        },
        dbClient,
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('VALIDATION_FAILED');
    });
  });

  // AC-7: Update and Delete Booking Type Actions
  describe('AC-7: Booking Type Update and Deletion (R-A)', () => {
    it('AC-7: updates duration or toggles is_active to false and logs booking_type.updated', async () => {
      // 1. Fetch existing booking type from seed (discovery-call)
      const existing = await dbClient
        .select()
        .from(bookingTypes)
        .where(eq(bookingTypes.slug, 'discovery-call'));
      expect(existing).toHaveLength(1);
      const bookingTypeId = existing[0]?.id;
      expect(bookingTypeId).toBeDefined();
      if (!bookingTypeId) return;

      // 2. Update duration to 45 and is_active to false
      const updateRes = await updateBookingTypeAction(
        bookingTypeId,
        {
          durationMinutes: 45,
          isActive: false,
        },
        dbClient,
      );

      expect(updateRes.success).toBe(true);
      if (!updateRes.success) return;

      expect(updateRes.data.durationMinutes).toBe(45);
      expect(updateRes.data.isActive).toBe(false);

      // Verify DB persistence
      const updatedDb = await dbClient
        .select()
        .from(bookingTypes)
        .where(eq(bookingTypes.id, bookingTypeId));
      expect(updatedDb[0]?.durationMinutes).toBe(45);
      expect(updatedDb[0]?.isActive).toBe(false);

      // Verify audit log booking_type.updated
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'booking_type.updated'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(bookingTypeId);
    });

    it('AC-7: rejects updating slug to another existing booking type slug with CONFLICT', async () => {
      // Find two booking types: discovery-call and consultation
      const seeded = await dbClient.select().from(bookingTypes);
      expect(seeded.length).toBeGreaterThanOrEqual(2);

      const discovery = seeded.find((b) => b.slug === 'discovery-call');
      const consultation = seeded.find((b) => b.slug === 'consultation');
      expect(discovery).toBeDefined();
      expect(consultation).toBeDefined();
      if (!discovery || !consultation) return;

      // Try updating consultation's slug to discovery's slug
      const updateRes = await updateBookingTypeAction(
        consultation.id,
        { slug: discovery.slug },
        dbClient,
      );

      expect(updateRes.success).toBe(false);
      if (updateRes.success) return;
      expect(updateRes.code).toBe('CONFLICT');
    });

    it('AC-7: deletes booking type and logs booking_type.deleted', async () => {
      // Create a temporary booking type to delete
      const created = await createBookingTypeAction(
        {
          title: 'To Be Deleted',
          slug: 'to-be-deleted',
          durationMinutes: 30,
        },
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const deleteRes = await deleteBookingTypeAction(created.data.id, dbClient);
      expect(deleteRes.success).toBe(true);

      // Verify deletion from DB
      const remaining = await dbClient
        .select()
        .from(bookingTypes)
        .where(eq(bookingTypes.id, created.data.id));
      expect(remaining).toHaveLength(0);

      // Verify audit log booking_type.deleted
      const auditRows = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'booking_type.deleted'))
        .orderBy(desc(auditEvents.occurredAt));

      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0]?.targetId).toBe(created.data.id);
    });

    it('AC-7: accepts delete input as object with id and rejects invalid input format', async () => {
      const created = await createBookingTypeAction(
        {
          title: 'Object Delete Target',
          slug: 'object-delete-target',
          durationMinutes: 30,
        },
        dbClient,
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      // Delete with object payload { id: ... }
      const objDeleteRes = await deleteBookingTypeAction({ id: created.data.id }, dbClient);
      expect(objDeleteRes.success).toBe(true);

      // Delete with invalid payload
      const invalidRes = await deleteBookingTypeAction(false, dbClient);
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.code).toBe('VALIDATION_FAILED');
      }
    });

    it('AC-7: rejects update with invalid payload', async () => {
      const res = await updateBookingTypeAction(
        '01920000-0000-7000-8000-000000000001',
        { durationMinutes: -10 },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('AC-5: rejects create with invalid payload', async () => {
      const res = await createBookingTypeAction({ title: '', slug: '' }, dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // AC-8: Authorization Enforcement
  describe('AC-8: Authorization Enforcement', () => {
    it('AC-8: rejects unauthenticated create booking type action with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const res = await createBookingTypeAction(
        {
          title: 'Unauthenticated Type',
          slug: 'unauthenticated-type',
          durationMinutes: 30,
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-8: rejects unauthenticated update booking type action with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const res = await updateBookingTypeAction(
        '01920000-0000-7000-8000-000000000099',
        { durationMinutes: 60 },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-8: rejects unauthenticated delete booking type action with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const res = await deleteBookingTypeAction('01920000-0000-7000-8000-000000000099', dbClient);

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  describe('Service direct queries for booking types', () => {
    it('fetches booking types by id, slug and list', async () => {
      const types = await service.getBookingTypes(true, dbClient);
      expect(types.length).toBeGreaterThan(0);

      const first = types[0];
      expect(first).toBeDefined();
      if (!first) return;
      const byId = await service.getBookingTypeById(first.id, dbClient);
      const bySlug = await service.getBookingTypeBySlug(first.slug, dbClient);

      expect(byId?.id).toBe(first.id);
      expect(bySlug?.slug).toBe(first.slug);
    });

    it('returns NOT_FOUND when updating non-existent booking type directly in service', async () => {
      const res = await service.updateBookingType(
        '01920000-0000-7000-8000-000000000099',
        { title: 'Non-existent' },
        ownerUser.id,
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND when deleting non-existent booking type directly in service', async () => {
      const res = await service.deleteBookingType(
        '01920000-0000-7000-8000-000000000099',
        ownerUser.id,
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('NOT_FOUND');
      }
    });
  });
});

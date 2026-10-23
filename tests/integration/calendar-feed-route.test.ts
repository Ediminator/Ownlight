import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
import { clients } from '@/server/db/schema/clients';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import { appointments, blockedTime, calendarFeeds } from '@/server/db/schema/calendar';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { hashFeedToken, generateFeedToken } from '@/server/calendar/ical';
import { GET } from '@/app/api/calendar/feed/[token]/route';
import {
  getCalendarFeedAction,
  generateFeedTokenAction,
  revokeFeedTokenAction,
  updateFeedSummaryLevelAction,
} from '@/server/calendar/feed-actions';
import { eq } from 'drizzle-orm';

describe('TASK-0045: Calendar Feed Route and Server Actions Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let clientUser: { id: string; name: string; email: string; role: string };
  let clientSessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Create Owner User
    const [insertedOwner] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Studio Owner',
        email: 'owner@example.com',
        role: 'owner',
      })
      .returning();
    if (!insertedOwner) throw new Error('Failed to insert owner');
    ownerUser = insertedOwner;

    const ownerSession = await createSession(ownerUser.id, dbClient);
    sessionToken = ownerSession.token;

    // 2. Create Non-owner (Client/Assistant) User
    const [insertedClient] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000002',
        name: 'Standard Client',
        email: 'client@example.com',
        role: 'client',
      })
      .returning();
    if (!insertedClient) throw new Error('Failed to insert client');
    clientUser = insertedClient;

    const clientSession = await createSession(clientUser.id, dbClient);
    clientSessionToken = clientSession.token;

    // By default, set owner session
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  // AC-1 (R-A) & AC-6: Route handler returns 200 with text/calendar, CRLF, and anti-cache headers
  describe('AC-1 & AC-6: Calendar Feed Route Handler GET /api/calendar/feed/[token].ics', () => {
    it('AC-1: responds with HTTP 200, Content-Type text/calendar, and RFC 5545 CRLF payload with .ics suffix', async () => {
      const rawToken = generateFeedToken();
      const tokenHash = hashFeedToken(rawToken);

      await dbClient.insert(calendarFeeds).values({
        id: '01920000-feed-7000-8000-000000000001',
        tokenHash,
        name: 'Studio Main Feed',
        summaryLevel: 'standard',
        isActive: true,
      });

      const request = new NextRequest(
        `https://studio.example.com/api/calendar/feed/${rawToken}.ics`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ token: `${rawToken}.ics` }),
        client: dbClient,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe(
        'private, no-cache, no-store, max-age=0, must-revalidate',
      );
      expect(response.headers.get('Pragma')).toBe('no-cache');

      const body = await response.text();
      expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);

      // Verify that last_accessed_at was updated in DB
      const [feed] = await dbClient
        .select()
        .from(calendarFeeds)
        .where(eq(calendarFeeds.tokenHash, tokenHash));
      expect(feed?.lastAccessedAt).not.toBeNull();
    });

    it('AC-1: handles tokens without .ics suffix seamlessly', async () => {
      const rawToken = generateFeedToken();
      const tokenHash = hashFeedToken(rawToken);

      await dbClient.insert(calendarFeeds).values({
        id: '01920000-feed-7000-8000-000000000002',
        tokenHash,
        name: 'Studio Main Feed',
        summaryLevel: 'standard',
        isActive: true,
      });

      const request = new NextRequest(`https://studio.example.com/api/calendar/feed/${rawToken}`);
      const response = await GET(request, {
        params: Promise.resolve({ token: rawToken }),
        client: dbClient,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    });

    it('AC-6: returns HTTP 404 with strict anti-caching headers for non-existent token', async () => {
      const nonExistentToken = 'non-existent-feed-token-value-12345';
      const request = new NextRequest(
        `https://studio.example.com/api/calendar/feed/${nonExistentToken}.ics`,
      );
      const response = await GET(request, {
        params: Promise.resolve({ token: `${nonExistentToken}.ics` }),
        client: dbClient,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe(
        'private, no-cache, no-store, max-age=0, must-revalidate',
      );
      expect(response.headers.get('Pragma')).toBe('no-cache');
    });
  });

  // AC-2 & AC-3: Privacy summary levels
  describe('AC-2 & AC-3: Privacy Summary Levels in Feed Route', () => {
    beforeEach(async () => {
      // Seed client
      const [testClient] = await dbClient
        .insert(clients)
        .values({
          id: '01920000-0001-7000-8000-000000000001',
          kind: 'person',
          displayName: 'Emma Watson',
          preferredLocale: 'en',
        })
        .returning();

      if (!testClient) throw new Error('Client insert failed');

      // Find existing stage seeded by migrations
      const [stage] = await dbClient
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.key, 'booked'))
        .limit(1);
      if (!stage) throw new Error('Booked stage not found');

      // Seed project
      const [project] = await dbClient
        .insert(projects)
        .values({
          id: '01920000-0003-7000-8000-000000000001',
          clientId: testClient.id,
          stageId: stage.id,
          title: 'Emma & Liam Watson',
        })
        .returning();
      if (!project) throw new Error('Project insert failed');

      // Seed shoot in range (tomorrow)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowEnd = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);
      await dbClient.insert(shoots).values({
        id: '01920000-0004-7000-8000-000000000001',
        projectId: project.id,
        title: 'Shoot',
        startsAt: tomorrow,
        endsAt: tomorrowEnd,
        notes: 'Secret internal shoot note',
      });

      // Seed appointment in range
      const inTwoDays = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const inTwoDaysEnd = new Date(inTwoDays.getTime() + 60 * 60 * 1000);
      await dbClient.insert(appointments).values({
        id: '01920000-0005-7000-8000-000000000001',
        title: 'Consultation: Clara Schumann',
        status: 'scheduled',
        startsAt: inTwoDays,
        endsAt: inTwoDaysEnd,
        attendeeName: 'Clara Schumann',
        attendeeEmail: 'clara@example.org',
        attendeePhone: '+49 171 9998887',
        locationType: 'phone',
        attendeeNotes: 'Private medical budget constraints',
      });

      // Seed blocked time in range
      const inThreeDays = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const inThreeDaysEnd = new Date(inThreeDays.getTime() + 4 * 60 * 60 * 1000);
      await dbClient.insert(blockedTime).values({
        id: '01920000-0006-7000-8000-000000000001',
        title: 'Studio Maintenance',
        startsAt: inThreeDays,
        endsAt: inThreeDaysEnd,
        notes: 'Locksmith coming',
      });
    });

    it('AC-2: under standard summary level, masks surnames and excludes private notes and phone numbers', async () => {
      const token = generateFeedToken();
      await dbClient.insert(calendarFeeds).values({
        id: '01920000-0007-7000-8000-000000000001',
        tokenHash: hashFeedToken(token),
        summaryLevel: 'standard',
        isActive: true,
      });

      const request = new NextRequest(`https://studio.example.com/api/calendar/feed/${token}.ics`);
      const response = await GET(request, {
        params: Promise.resolve({ token: `${token}.ics` }),
        client: dbClient,
      });

      expect(response.status).toBe(200);
      const body = await response.text();

      // Check surname masking in summaries
      expect(body).toContain('Consultation: Clara S.');
      expect(body).toContain('Shoot: Emma & Liam W.');
      expect(body).toContain('Studio Maintenance');

      // Check strict omission of private notes, phone numbers, full names
      expect(body).not.toContain('Schumann');
      expect(body).not.toContain('Liam Watson');
      expect(body).not.toContain('+49 171 9998887');
      expect(body).not.toContain('budget constraints');
      expect(body).not.toContain('Secret internal shoot note');
      expect(body).not.toContain('Locksmith coming');
    });

    it('AC-3: under minimal summary level, sets SUMMARY:Busy and zeroes all identifiers and locations', async () => {
      const token = generateFeedToken();
      await dbClient.insert(calendarFeeds).values({
        id: '01920000-feed-7000-8000-000000000011',
        tokenHash: hashFeedToken(token),
        summaryLevel: 'minimal',
        isActive: true,
      });

      const request = new NextRequest(`https://studio.example.com/api/calendar/feed/${token}.ics`);
      const response = await GET(request, {
        params: Promise.resolve({ token: `${token}.ics` }),
        client: dbClient,
      });

      expect(response.status).toBe(200);
      const body = await response.text();

      // All events must have SUMMARY:Busy
      expect(body).toContain('SUMMARY:Busy');
      expect(body).not.toContain('Clara');
      expect(body).not.toContain('Emma');
      expect(body).not.toContain('Consultation');
      expect(body).not.toContain('Shoot');
      expect(body).not.toContain('Studio Maintenance');
      expect(body).not.toContain('LOCATION');
      expect(body).not.toContain('DESCRIPTION');
    });
  });

  // AC-4 (R-A): Revocation marks revoked_at, emits audit event, and old token returns 404
  describe('AC-4: Token Revocation and Regeneration', () => {
    it('AC-4: revokeFeedTokenAction revokes current feed, emits calendar_feed.revoked, and old token returns 404', async () => {
      const oldToken = generateFeedToken();
      const oldHash = hashFeedToken(oldToken);

      const [initialFeed] = await dbClient
        .insert(calendarFeeds)
        .values({
          id: '01920000-feed-7000-8000-000000000020',
          tokenHash: oldHash,
          name: 'Main Studio Feed',
          summaryLevel: 'standard',
          isActive: true,
        })
        .returning();
      if (!initialFeed) throw new Error('Initial feed insert failed');
      const feedId = initialFeed.id;

      // 1. Initial request works
      const req1 = new NextRequest(`https://studio.example.com/api/calendar/feed/${oldToken}.ics`);
      const res1 = await GET(req1, {
        params: Promise.resolve({ token: `${oldToken}.ics` }),
        client: dbClient,
      });
      expect(res1.status).toBe(200);

      // 2. Revoke & Regenerate via server action
      const revokeResult = await revokeFeedTokenAction({ feedId }, dbClient);
      expect(revokeResult.success).toBe(true);
      if (!revokeResult.success) return;

      expect(revokeResult.data.token).toBeDefined();
      expect(revokeResult.data.token).not.toBe(oldToken);

      // 3. Verify audit log event calendar_feed.revoked
      const [auditEvent] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'calendar_feed.revoked'));
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.targetId).toBe(feedId);

      // 4. Verify old token now immediately returns HTTP 404
      const reqOld = new NextRequest(
        `https://studio.example.com/api/calendar/feed/${oldToken}.ics`,
      );
      const resOld = await GET(reqOld, {
        params: Promise.resolve({ token: `${oldToken}.ics` }),
        client: dbClient,
      });
      expect(resOld.status).toBe(404);

      // 5. Verify new token returns HTTP 200
      const reqNew = new NextRequest(
        `https://studio.example.com/api/calendar/feed/${revokeResult.data.token}.ics`,
      );
      const resNew = await GET(reqNew, {
        params: Promise.resolve({ token: `${revokeResult.data.token}.ics` }),
        client: dbClient,
      });
      expect(resNew.status).toBe(200);
    });
  });

  // AC-5: SHA-256 token hashing in database
  describe('AC-5: Database Token Hashing', () => {
    it('AC-5: only SHA-256 hash is persisted in calendar_feeds, raw token is never stored in DB', async () => {
      const result = await generateFeedTokenAction({ summaryLevel: 'standard' }, dbClient);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const rawToken = result.data.token;
      const expectedHash = hashFeedToken(rawToken);

      const [storedFeed] = await dbClient
        .select()
        .from(calendarFeeds)
        .where(eq(calendarFeeds.id, result.data.feed.id));

      expect(storedFeed).toBeDefined();
      expect(storedFeed?.tokenHash).toBe(expectedHash);
      // Ensure raw token is not stored in any text column
      expect(storedFeed?.name).not.toContain(rawToken);
    });
  });

  // AC-7: getCalendarFeedAction returns active feed and initial token if none exists
  describe('AC-7: getCalendarFeedAction', () => {
    it('AC-7: creates initial feed and returns newly generated token when no feed exists', async () => {
      const result = await getCalendarFeedAction(dbClient);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.feed).toBeDefined();
      expect(result.data.token).toBeDefined();
      expect(result.data.feed?.isActive).toBe(true);
    });

    it('AC-7: returns existing feed metadata without raw token when active feed already exists', async () => {
      const token = generateFeedToken();
      await dbClient.insert(calendarFeeds).values({
        id: '01920000-feed-7000-8000-000000000030',
        tokenHash: hashFeedToken(token),
        summaryLevel: 'full',
        isActive: true,
      });

      const result = await getCalendarFeedAction(dbClient);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.feed?.id).toBe('01920000-feed-7000-8000-000000000030');
      expect(result.data.feed?.summaryLevel).toBe('full');
      // Token is null / undefined because it was previously stored
      expect(result.data.token).toBeUndefined();
    });
  });

  // AC-8: Authorization enforcement on Server Actions
  describe('AC-8: Authorization Guards on Server Actions', () => {
    it('AC-8: rejects unauthenticated visitors with UNAUTHENTICATED', async () => {
      mockCookiesStore.clear();

      const getRes = await getCalendarFeedAction(dbClient);
      expect(getRes.success).toBe(false);
      expect(getRes.code).toBe('UNAUTHENTICATED');

      const genRes = await generateFeedTokenAction({}, dbClient);
      expect(genRes.success).toBe(false);
      expect(genRes.code).toBe('UNAUTHENTICATED');

      const revRes = await revokeFeedTokenAction(
        { feedId: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(revRes.success).toBe(false);
      expect(revRes.code).toBe('UNAUTHENTICATED');

      const updRes = await updateFeedSummaryLevelAction({ summaryLevel: 'minimal' }, dbClient);
      expect(updRes.success).toBe(false);
      expect(updRes.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: rejects non-owner authenticated users with FORBIDDEN', async () => {
      // Set non-owner client session
      mockCookiesStore.set(SESSION_COOKIE_NAME, clientSessionToken);

      const getRes = await getCalendarFeedAction(dbClient);
      expect(getRes.success).toBe(false);
      expect(getRes.code).toBe('FORBIDDEN');

      const genRes = await generateFeedTokenAction({}, dbClient);
      expect(genRes.success).toBe(false);
      expect(genRes.code).toBe('FORBIDDEN');

      const revRes = await revokeFeedTokenAction(
        { feedId: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(revRes.success).toBe(false);
      expect(revRes.code).toBe('FORBIDDEN');

      const updRes = await updateFeedSummaryLevelAction({ summaryLevel: 'minimal' }, dbClient);
      expect(updRes.success).toBe(false);
      expect(updRes.code).toBe('FORBIDDEN');
    });
  });

  // Summary level updates
  describe('Summary Level Update Action', () => {
    it('updates summary level to full and persists in DB', async () => {
      const [feed] = await dbClient
        .insert(calendarFeeds)
        .values({
          id: '01920000-feed-7000-8000-000000000040',
          tokenHash: hashFeedToken(generateFeedToken()),
          summaryLevel: 'standard',
          isActive: true,
        })
        .returning();

      if (!feed) throw new Error('Feed insert failed');
      const feedId = feed.id;

      const result = await updateFeedSummaryLevelAction({ feedId, summaryLevel: 'full' }, dbClient);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.summaryLevel).toBe('full');

      const [updated] = await dbClient
        .select()
        .from(calendarFeeds)
        .where(eq(calendarFeeds.id, feedId));
      expect(updated?.summaryLevel).toBe('full');
    });

    it('rejects invalid summary levels with VALIDATION_FAILED', async () => {
      const result = await updateFeedSummaryLevelAction(
        { summaryLevel: 'super_secret' as unknown as 'standard' },
        dbClient,
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('returns NOT_FOUND when updating non-existent feedId', async () => {
      const result = await updateFeedSummaryLevelAction(
        { feedId: '01920000-0000-7000-8000-000000009999', summaryLevel: 'minimal' },
        dbClient,
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });
  });

  // Action Validation & Edge cases
  describe('Server Action Validation Failures & Route Edge Cases', () => {
    it('generateFeedTokenAction rejects invalid summary level with VALIDATION_FAILED', async () => {
      const result = await generateFeedTokenAction(
        { summaryLevel: 'ultra_secret' as unknown as 'standard' },
        dbClient,
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('revokeFeedTokenAction rejects non-uuid feedId with VALIDATION_FAILED', async () => {
      const result = await revokeFeedTokenAction({ feedId: 'not-a-valid-uuid' }, dbClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('revokeFeedTokenAction returns NOT_FOUND for non-existent feedId', async () => {
      const result = await revokeFeedTokenAction(
        { feedId: '01920000-0000-7000-8000-000000009999' },
        dbClient,
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('route handler returns 404 for empty token or just .ics suffix', async () => {
      const reqEmpty = new NextRequest('https://studio.example.com/api/calendar/feed/.ics');
      const resEmpty = await GET(reqEmpty, {
        params: Promise.resolve({ token: '.ics' }),
        client: dbClient,
      });
      expect(resEmpty.status).toBe(404);

      const reqMissing = new NextRequest('https://studio.example.com/api/calendar/feed/');
      const resMissing = await GET(reqMissing, {
        params: Promise.resolve({ token: '' }),
        client: dbClient,
      });
      expect(resMissing.status).toBe(404);
    });
  });
});

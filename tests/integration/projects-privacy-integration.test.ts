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
import { exportClientDataAction } from '@/server/privacy/export/actions';
import { eraseClientDataAction } from '@/server/privacy/erasure/actions';
import { runRetentionSweep } from '@/server/retention/sweep';
import { findActiveClientIds } from '@/server/clients/activity';
import { resetExportProviders } from '@/server/privacy/export/registry';
import {
  resetErasureProviders,
  resetErasureHoldProviders,
} from '@/server/privacy/erasure/registry';
import { resetActivityProviders } from '@/server/clients/activity';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import {
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
  pipelineStages,
} from '@/server/db/schema/projects';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';

describe('TASK-0035 Projects Privacy Integration Tests (AC-1 through AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUserId: string;
  let sessionToken: string;

  // Stages
  let stageInquiryId: string;
  let stageBookedId: string;
  let stageCompletedId: string;
  let stageArchivedId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    resetExportProviders();
    resetErasureProviders();
    resetErasureHoldProviders();
    resetActivityProviders();

    // 1. Studio Owner User
    ownerUserId = '018f0000-0000-7000-8000-000000000099';
    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Studio Owner',
      email: 'owner@example.org',
      emailVerified: true,
      role: 'owner',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Active owner session
    const sessionRes = await createSession(ownerUserId, dbClient);
    sessionToken = sessionRes.token;

    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    // 3. Studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Ownlight Test Studio',
      currency: 'EUR',
      default_locale: 'en',
      timezone: 'UTC',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // 4. Lookup existing pipeline stages from database migrations
    const existingStages = await dbClient.select().from(pipelineStages);
    stageInquiryId = existingStages.find((s) => s.category === 'inquiry')?.id ?? '';
    stageBookedId = existingStages.find((s) => s.category === 'booked')?.id ?? '';
    stageCompletedId = existingStages.find((s) => s.category === 'completed')?.id ?? '';
    stageArchivedId = existingStages.find((s) => s.category === 'archived')?.id ?? '';
  });

  afterEach(async () => {
    resetExportProviders();
    resetErasureProviders();
    resetErasureHoldProviders();
    resetActivityProviders();
    await testDb.destroy();
  });

  it('AC-1 (R-A): exportClientDataAction exports projects category containing all project records in structured JSON and localized HTML tables', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000100';
    const contactId = '018f0000-0000-7000-8000-000000000101';
    const projectId = '018f0000-0000-7000-8000-000000000102';
    const shootId = '018f0000-0000-7000-8000-000000000103';
    const locationId = '018f0000-0000-7000-8000-000000000104';
    const timelineItemId = '018f0000-0000-7000-8000-000000000105';
    const taskId = '018f0000-0000-7000-8000-000000000106';
    const participantId = '018f0000-0000-7000-8000-000000000107';

    // 1. Seed Client & Contact
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Emma & Liam Davis',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      lastActivityAt: new Date('2026-02-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Emma',
      familyName: 'Davis',
      email: 'emma.davis@example.org',
      emailNormalized: 'emma.davis@example.org',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });

    // 2. Seed Project with primary shoot starts at
    const shootDate = new Date('2026-09-20T13:00:00Z');
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageBookedId,
      title: 'Davis Wedding Celebration',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: shootDate,
      primaryShootTimezone: 'Europe/Berlin',
      currency: 'EUR',
      priceMinor: 250000,
      notes: 'Full day coverage with second shooter',
      createdAt: new Date('2026-02-05T00:00:00Z'),
      lastActivityAt: new Date('2026-02-10T00:00:00Z'),
    });

    // 3. Seed Shoot
    await dbClient.insert(shoots).values({
      id: shootId,
      projectId,
      title: 'Main Wedding Day',
      startsAt: shootDate,
      endsAt: new Date('2026-09-20T23:00:00Z'),
      timezone: 'Europe/Berlin',
      notes: 'Bring 70-200mm lens',
    });

    // 4. Seed Shoot Location
    await dbClient.insert(shootLocations).values({
      id: locationId,
      shootId,
      name: 'St. Mary Church',
      addressLine1: 'Kirchplatz 1',
      city: 'Berlin',
      postalCode: '10115',
      countryCode: 'DE',
      order: 1,
    });

    // 5. Seed Shoot Timeline Item
    await dbClient.insert(shootTimelineItems).values({
      id: timelineItemId,
      shootId,
      locationId,
      title: 'Ceremony Begins',
      startsAt: new Date('2026-09-20T14:00:00Z'),
      endsAt: new Date('2026-09-20T15:00:00Z'),
      order: 1,
    });

    // 6. Seed Project Task
    await dbClient.insert(projectTasks).values({
      id: taskId,
      projectId,
      stageId: stageBookedId,
      title: 'Send welcome questionnaire',
      isCompleted: true,
      completedAt: new Date('2026-02-08T00:00:00Z'),
      order: 1,
    });

    // 7. Seed Project Participant
    await dbClient.insert(projectParticipants).values({
      id: participantId,
      projectId,
      contactId,
      role: 'Bride',
      isPrimary: true,
      name: 'Emma Davis',
      email: 'emma.davis@example.org',
    });

    // Call production DSAR export in JSON
    const jsonRes = await exportClientDataAction(
      {
        clientId,
        format: 'json',
        locale: 'en',
      },
      dbClient,
    );

    expect(jsonRes.success).toBe(true);
    if (!jsonRes.success) return;

    const projCategory = jsonRes.exportData.categories.projects;
    expect(projCategory).toBeDefined();
    if (!projCategory) throw new Error('Expected projects category');
    expect(projCategory).toHaveLength(1);

    const exportedProj = projCategory[0] as Record<string, unknown>;
    expect(exportedProj.project).toBe('Davis Wedding Celebration');
    expect(exportedProj.stage).toBe('Booked');
    expect(exportedProj.locations).toContain('St. Mary Church');
    expect(exportedProj.timeline).toContain('Ceremony Begins');
    expect(exportedProj.tasks).toContain('Send welcome questionnaire');
    expect(exportedProj.participants).toContain('Bride');

    // Call production DSAR export in HTML
    const htmlRes = await exportClientDataAction(
      {
        clientId,
        format: 'html',
        locale: 'en',
      },
      dbClient,
    );

    expect(htmlRes.success).toBe(true);
    if (!htmlRes.success) return;
    expect(htmlRes.content).toContain('Davis Wedding Celebration');
    expect(htmlRes.content).toContain('St. Mary Church');
    expect(htmlRes.content).toContain('Ceremony Begins');
    expect(htmlRes.content).toContain('Projects &amp; Shoots');
  });

  it('AC-2 (R-A): eraseClientDataAction blocks erasure with ERASURE_BLOCKED when client has active project, logs privacy.erasure.blocked audit event, and deletes 0 records', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000200';
    const contactId = '018f0000-0000-7000-8000-000000000201';
    const projectId = '018f0000-0000-7000-8000-000000000202';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Active Client Corp',
      kind: 'company',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Active',
      familyName: 'Manager',
      email: 'manager@example.org',
      emailNormalized: 'manager@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Project in 'inquiry' stage category (active)
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageInquiryId,
      title: 'Commercial Campaign Q4',
      projectTypeKey: 'commercial',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    const eraseRes = await eraseClientDataAction(
      {
        clientId,
        confirmation: 'Active Client Corp',
      },
      dbClient,
    );

    expect(eraseRes.success).toBe(false);
    expect((eraseRes as { code: string }).code).toBe('ERASURE_BLOCKED');
    const blockedHolds = (eraseRes as { holds: { reason: string }[] }).holds;
    expect(blockedHolds).toBeDefined();
    expect(blockedHolds.some((h) => h.reason === 'active_project')).toBe(true);

    // Records untouched
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);
    const projectRows = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    expect(projectRows).toHaveLength(1);

    // privacy.erasure.blocked audit event emitted
    const blockedAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.blocked'));
    expect(blockedAudits).toHaveLength(1);
    expect(blockedAudits[0]?.targetId).toBe(clientId);
    expect(blockedAudits[0]?.outcome).toBe('denied');
  });

  it('AC-3 (R-A): eraseClientDataAction blocks erasure with upcoming_shoot hold when projects are completed/archived but future shoot is scheduled', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000300';
    const contactId = '018f0000-0000-7000-8000-000000000301';
    const projectId = '018f0000-0000-7000-8000-000000000302';
    const shootId = '018f0000-0000-7000-8000-000000000303';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Future Shoot Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Sam',
      familyName: 'Walker',
      email: 'sam.walker@example.org',
      emailNormalized: 'sam.walker@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Project is in completed stage
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageCompletedId,
      title: 'Delivered Portrait with Add-On Session',
      projectTypeKey: 'portrait',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Shoot in the future (starts_at >= now)
    const futureDate = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    await dbClient.insert(shoots).values({
      id: shootId,
      projectId,
      title: 'Sunset Beach Session',
      startsAt: futureDate,
      timezone: 'Europe/Berlin',
    });

    const eraseRes = await eraseClientDataAction(
      {
        clientId,
        confirmation: 'Future Shoot Client',
      },
      dbClient,
    );

    expect(eraseRes.success).toBe(false);
    expect((eraseRes as { code: string }).code).toBe('ERASURE_BLOCKED');
    const blockedHolds = (eraseRes as { holds: { reason: string; retainUntil: string }[] }).holds;
    expect(blockedHolds).toBeDefined();
    const shootHold = blockedHolds.find((h) => h.reason === 'upcoming_shoot');
    expect(shootHold).toBeDefined();
    expect(shootHold?.retainUntil).toBe(futureDate.toISOString());

    // Records untouched
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);
  });

  it('AC-4 (R-A): eraseClientDataAction permanently cascades all projects, shoots, locations, timeline items, participants, tasks when projects are archived/completed and no upcoming shoots', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000400';
    const contactId = '018f0000-0000-7000-8000-000000000401';
    const projectId = '018f0000-0000-7000-8000-000000000402';
    const shootId = '018f0000-0000-7000-8000-000000000403';
    const locationId = '018f0000-0000-7000-8000-000000000404';
    const timelineItemId = '018f0000-0000-7000-8000-000000000405';
    const taskId = '018f0000-0000-7000-8000-000000000406';
    const participantId = '018f0000-0000-7000-8000-000000000407';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Archived Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      lastActivityAt: new Date('2025-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Old',
      familyName: 'Client',
      email: 'old.client@example.org',
      emailNormalized: 'old.client@example.org',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });

    // Archived project
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageArchivedId,
      title: '2025 Archived Shoot',
      projectTypeKey: 'portrait',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      lastActivityAt: new Date('2025-01-01T00:00:00Z'),
    });

    // Past shoot
    await dbClient.insert(shoots).values({
      id: shootId,
      projectId,
      title: 'Studio Session',
      startsAt: new Date('2025-02-01T10:00:00Z'),
      timezone: 'Europe/Berlin',
    });

    await dbClient.insert(shootLocations).values({
      id: locationId,
      shootId,
      name: 'Old Studio',
      order: 1,
    });

    await dbClient.insert(shootTimelineItems).values({
      id: timelineItemId,
      shootId,
      title: 'Prep & Shoot',
      startsAt: new Date('2025-02-01T10:00:00Z'),
      order: 1,
    });

    await dbClient.insert(projectTasks).values({
      id: taskId,
      projectId,
      title: 'Old task',
      order: 1,
    });

    await dbClient.insert(projectParticipants).values({
      id: participantId,
      projectId,
      contactId,
      role: 'Subject',
    });

    // Execute erasure
    const eraseRes = await eraseClientDataAction(
      {
        clientId,
        confirmation: 'Archived Client',
      },
      dbClient,
    );

    expect(eraseRes.success).toBe(true);

    // Verify all records deleted
    expect(await dbClient.select().from(clients).where(eq(clients.id, clientId))).toHaveLength(0);
    expect(
      await dbClient.select().from(clientContacts).where(eq(clientContacts.id, contactId)),
    ).toHaveLength(0);
    expect(await dbClient.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(
      0,
    );
    expect(await dbClient.select().from(shoots).where(eq(shoots.id, shootId))).toHaveLength(0);
    expect(
      await dbClient.select().from(shootLocations).where(eq(shootLocations.id, locationId)),
    ).toHaveLength(0);
    expect(
      await dbClient
        .select()
        .from(shootTimelineItems)
        .where(eq(shootTimelineItems.id, timelineItemId)),
    ).toHaveLength(0);
    expect(
      await dbClient.select().from(projectTasks).where(eq(projectTasks.id, taskId)),
    ).toHaveLength(0);
    expect(
      await dbClient
        .select()
        .from(projectParticipants)
        .where(eq(projectParticipants.id, participantId)),
    ).toHaveLength(0);

    // Audit event privacy.erasure.completed emitted
    const completedAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.completed'));
    expect(completedAudits).toHaveLength(1);
    expect(completedAudits[0]?.targetId).toBe(clientId);
  });

  it('AC-5 (R-A): retention sweep findActiveClientIds recognizes active projects, preventing retention runner from purging client record', async () => {
    const activeClientId = '018f0000-0000-7000-8000-000000000500';
    const dormantClientId = '018f0000-0000-7000-8000-000000000501';
    const cutoff = new Date(Date.now() - 36 * 30 * 24 * 3600 * 1000); // 36 months ago

    // Seed active client with an in-progress project
    await dbClient.insert(clients).values({
      id: activeClientId,
      displayName: 'Client With Active Project',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      lastActivityAt: new Date('2020-01-01T00:00:00Z'), // client record itself is old!
    });
    await dbClient.insert(clientContacts).values({
      id: '018f0000-0000-7000-8000-000000000502',
      clientId: activeClientId,
      isPrimary: true,
      givenName: 'Active',
      familyName: 'Project Owner',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    });
    await dbClient.insert(projects).values({
      id: '018f0000-0000-7000-8000-000000000503',
      clientId: activeClientId,
      stageId: stageInquiryId, // active stage category
      title: 'Active Commission',
      projectTypeKey: 'wedding',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      lastActivityAt: new Date('2020-01-01T00:00:00Z'),
    });

    // Seed truly dormant client with archived project and no recent activity
    await dbClient.insert(clients).values({
      id: dormantClientId,
      displayName: 'Dormant Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      lastActivityAt: new Date('2020-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: '018f0000-0000-7000-8000-000000000504',
      clientId: dormantClientId,
      isPrimary: true,
      givenName: 'Dormant',
      familyName: 'Person',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    });
    await dbClient.insert(projects).values({
      id: '018f0000-0000-7000-8000-000000000505',
      clientId: dormantClientId,
      stageId: stageArchivedId, // archived
      title: 'Archived Project',
      projectTypeKey: 'portrait',
      createdAt: new Date('2020-01-01T00:00:00Z'),
      lastActivityAt: new Date('2020-01-01T00:00:00Z'),
    });

    const activeIds = await findActiveClientIds(dbClient, cutoff, [
      activeClientId,
      dormantClientId,
    ]);

    expect(activeIds.has(activeClientId)).toBe(true);
    expect(activeIds.has(dormantClientId)).toBe(false);

    // Run sweep: activeClientId must be protected from retention sweep
    const sweepResult = await runRetentionSweep({
      dryRun: true,
      policyIds: ['inactive-clients'],
      client: dbClient,
      now: new Date(),
    });

    const inactivePolicyResult = sweepResult.policies.find(
      (p) => p.policyId === 'inactive-clients',
    );
    if (inactivePolicyResult) {
      expect(inactivePolicyResult.erasableIds).not.toContain(activeClientId);
      expect(inactivePolicyResult.erasableIds).toContain(dormantClientId);
    }
  });

  it('AC-6: contact-level DSAR export includes project title and assigned role for contact listed as participant', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000600';
    const primaryContactId = '018f0000-0000-7000-8000-000000000601';
    const vendorContactId = '018f0000-0000-7000-8000-000000000602';
    const projectId = '018f0000-0000-7000-8000-000000000603';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Smith Wedding Client',
      kind: 'person',
      preferredLocale: 'en',
    });
    await dbClient.insert(clientContacts).values([
      {
        id: primaryContactId,
        clientId,
        isPrimary: true,
        givenName: 'John',
        familyName: 'Smith',
        email: 'john.smith@example.org',
        emailNormalized: 'john.smith@example.org',
      },
      {
        id: vendorContactId,
        clientId,
        isPrimary: false,
        givenName: 'Sarah',
        familyName: 'Jenkins',
        email: 'sarah.jenkins@example.org',
        emailNormalized: 'sarah.jenkins@example.org',
      },
    ]);

    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageBookedId,
      title: 'Smith Summer Gala',
      projectTypeKey: 'event',
    });

    // Vendor contact is assigned as "Event Coordinator" in participants
    await dbClient.insert(projectParticipants).values({
      id: '018f0000-0000-7000-8000-000000000604',
      projectId,
      contactId: vendorContactId,
      role: 'Event Coordinator',
      isPrimary: false,
    });

    const exportRes = await exportClientDataAction(
      {
        contactId: vendorContactId,
        format: 'json',
        locale: 'en',
      },
      dbClient,
    );

    expect(exportRes.success).toBe(true);
    if (!exportRes.success) return;

    const projCategory = exportRes.exportData.categories.projects;
    expect(projCategory).toBeDefined();
    if (!projCategory) throw new Error('Expected projects category');
    expect(projCategory.length).toBeGreaterThanOrEqual(1);

    const vendorProj = projCategory[0] as Record<string, unknown>;
    expect(vendorProj.project).toBe('Smith Summer Gala');
    expect(vendorProj.role).toBe('Event Coordinator');
  });

  it('AC-7: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    // Clear session cookies so caller is unauthenticated
    mockCookiesStore.clear();

    const exportRes = await exportClientDataAction(
      {
        clientId: '018f0000-0000-7000-8000-000000000700',
      },
      dbClient,
    );

    expect(exportRes.success).toBe(false);
    expect((exportRes as { code?: string }).code).toBe('UNAUTHENTICATED');

    const eraseRes = await eraseClientDataAction(
      {
        clientId: '018f0000-0000-7000-8000-000000000700',
        confirmation: 'Some Name',
      },
      dbClient,
    );

    expect(eraseRes.success).toBe(false);
    expect((eraseRes as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: German locale export generation renders all category titles, table headers (Projekt, Phase, Shooting-Datum, Orte, Zeitplan, Aufgaben, Teilnehmer), and disclosures in German', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000800';
    const contactId = '018f0000-0000-7000-8000-000000000801';
    const projectId = '018f0000-0000-7000-8000-000000000802';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Deutscher Kunde',
      kind: 'person',
      preferredLocale: 'de',
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Maximilian',
      familyName: 'Mustermann',
      email: 'max@example.org',
      emailNormalized: 'max@example.org',
    });
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: stageBookedId,
      title: 'Herbst-Fotoshooting',
      projectTypeKey: 'portrait',
      primaryShootStartsAt: new Date('2026-10-25T14:00:00Z'),
    });

    const res = await exportClientDataAction(
      {
        clientId,
        format: 'html',
        locale: 'de',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const html = res.content;

    // German category heading and disclosures
    expect(html).toContain('Projekte &amp; Shootings');
    expect(html).toContain('Durchführung und Erfüllung von Fotografieaufträgen');
    expect(html).toContain('Art. 6 Abs. 1 lit. b DSGVO');
    expect(html).toContain('Handels- und steuerrechtliche Aufbewahrungsfristen');

    // German table headers per AC-8
    expect(html).toContain('Projekt');
    expect(html).toContain('Phase');
    expect(html).toContain('Shooting-Datum');
    expect(html).toContain('Orte');
    expect(html).toContain('Zeitplan');
    expect(html).toContain('Aufgaben');
    expect(html).toContain('Teilnehmer');
  });
});

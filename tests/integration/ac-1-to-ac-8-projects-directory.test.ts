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
import { createProjectAction, deleteProjectAction } from '@/server/projects/actions';
import { convertLeadToClientAction } from '@/server/leads/actions';
import { getKanbanBoardData } from '@/server/projects/service';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { clients } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { projects, shoots, shootLocations } from '@/server/db/schema/projects';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0037: Projects Directory & Creation Integration Tests (AC-1 to AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let clientId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Seed owner user
    ownerUser = {
      id: generateUuidV7(),
      name: 'Studio Owner',
      email: 'owner@example.org',
      role: 'owner',
    };
    await dbClient.insert(user).values({
      id: ownerUser.id,
      name: ownerUser.name,
      email: ownerUser.email,
      role: ownerUser.role,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Create web session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Seed client
    clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Emma Watson',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    (globalThis as unknown as { db: DbClient | undefined }).db = undefined;
    await testDb.destroy();
  });

  it('AC-1 / AC-3: getKanbanBoardData returns primaryShootLocationName, lastActivityAt, and joined client for projects directory table', async () => {
    const [stages] = await Promise.all([dbClient.query.pipelineStages.findMany()]);
    const inquiryStage = stages.find((s) => s.key === 'inquiry') ?? stages[0];
    if (!inquiryStage) throw new Error('Expected stage');

    const projId = generateUuidV7();
    const shootId = generateUuidV7();
    const shootDate = new Date('2027-06-19T10:00:00.000Z');

    await dbClient.insert(projects).values({
      id: projId,
      clientId,
      stageId: inquiryStage.id,
      title: 'Emma & Liam Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: shootDate,
      primaryShootTimezone: 'Europe/Berlin',
      currency: 'EUR',
      priceMinor: 250000,
    });

    await dbClient.insert(shoots).values({
      id: shootId,
      projectId: projId,
      title: 'Main Shoot',
      startsAt: shootDate,
      timezone: 'Europe/Berlin',
    });

    await dbClient.insert(shootLocations).values({
      id: generateUuidV7(),
      shootId,
      name: 'Botanical Gardens, Berlin',
      order: 1,
    });

    const data = await getKanbanBoardData(dbClient);
    const found = data.projects.find((p) => p.id === projId);

    expect(found).toBeDefined();
    expect(found?.title).toBe('Emma & Liam Wedding');
    expect(found?.clientDisplayName).toBe('Emma Watson');
    expect(found?.primaryShootLocationName).toBe('Botanical Gardens, Berlin');
    expect(found?.lastActivityAt).toBeDefined();
    expect(found?.priceMinor).toBe(250000);
  });

  it('AC-4: createProjectAction successfully creates a project with optional shoot date, location, and notes', async () => {
    const shootStartsAt = new Date('2027-08-15T14:00:00.000Z');

    const res = await createProjectAction(
      {
        clientId,
        title: 'Lucas Portrait Session',
        projectTypeKey: 'portrait',
        priceMinor: 350000,
        currency: 'EUR',
        shootStartsAt,
        shootTimezone: 'Europe/Berlin',
        shootLocation: 'Studio West Berlin',
        notes: 'Client requested natural window lighting',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const projectId = res.data.projectId;
    expect(projectId).toBeDefined();

    const [createdProject] = await dbClient
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    expect(createdProject).toBeDefined();
    expect(createdProject?.title).toBe('Lucas Portrait Session');
    expect(createdProject?.priceMinor).toBe(350000);
    expect(createdProject?.notes).toBe('Client requested natural window lighting');
    expect(createdProject?.primaryShootStartsAt).toEqual(shootStartsAt);

    // Verify created shoot and shoot location
    const [createdShoot] = await dbClient
      .select()
      .from(shoots)
      .where(eq(shoots.projectId, projectId))
      .limit(1);

    expect(createdShoot).toBeDefined();
    if (!createdShoot) throw new Error('Expected createdShoot');
    expect(createdShoot.startsAt).toEqual(shootStartsAt);

    const [createdLoc] = await dbClient
      .select()
      .from(shootLocations)
      .where(eq(shootLocations.shootId, createdShoot.id))
      .limit(1);

    expect(createdLoc).toBeDefined();
    expect(createdLoc?.name).toBe('Studio West Berlin');
  });

  it('AC-4: createProjectAction rejects empty title, invalid client ID, or oversized inputs', async () => {
    // Missing title
    const resNoTitle = await createProjectAction(
      {
        clientId,
        title: '   ',
      },
      dbClient,
    );
    expect(resNoTitle.success).toBe(false);

    // Title exceeds 200 chars
    const resLongTitle = await createProjectAction(
      {
        clientId,
        title: 'A'.repeat(201),
      },
      dbClient,
    );
    expect(resLongTitle.success).toBe(false);

    // Non-existent client
    const resBadClient = await createProjectAction(
      {
        clientId: generateUuidV7(),
        title: 'Valid Title',
      },
      dbClient,
    );
    expect(resBadClient.success).toBe(false);
  });

  it('AC-5: convertLeadToClientAction atomically creates linked project and returns project info', async () => {
    const formId = generateUuidV7();
    const noticeVersionId = generateUuidV7();

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'contact-test',
      name: 'Test Inquiries',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'family_name', enabled: true, required: false, order: 1 },
        { key: 'email', enabled: true, required: true, order: 2 },
      ],
      eventTypes: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
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
      acknowledgementTextEn: 'I acknowledge the privacy notice.',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
      privacyPolicyUrl: 'https://example.org/privacy',
      createdByActorId: ownerUser.id,
      createdAt: new Date(),
    });

    const leadId = generateUuidV7();
    await dbClient.insert(leads).values({
      id: leadId,
      formId,
      noticeVersionId,
      noticeAcknowledgedAt: new Date(),
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      locale: 'en',
      givenName: 'Sarah',
      familyName: 'Connor',
      email: 'sarah.connor@example.org',
      emailNormalized: 'sarah.connor@example.org',
      eventTypeKey: 'wedding',
      eventDate: '2027-09-20',
      eventLocation: 'Lake Como Villa',
      receivedAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await convertLeadToClientAction(
      {
        leadId,
        mode: 'new_client',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.clientId).toBeDefined();
    expect(res.projectId).toBeDefined();
    expect(res.projectTitle).toBe('Sarah Connor - Wedding');
    if (!res.projectId) throw new Error('Expected res.projectId');

    // Verify project record in db
    const [projectRow] = await dbClient
      .select()
      .from(projects)
      .where(eq(projects.id, res.projectId))
      .limit(1);

    expect(projectRow).toBeDefined();
    expect(projectRow?.leadId).toBe(leadId);
    expect(projectRow?.title).toBe('Sarah Connor - Wedding');
  });

  it('Security: createProjectAction rejects unauthenticated calls and bearer tokens', async () => {
    // 1. Unauthenticated
    mockCookiesStore.clear();
    const resUnauth = await createProjectAction(
      {
        clientId,
        title: 'Unauthenticated Attempt',
      },
      dbClient,
    );
    expect(resUnauth.success).toBe(false);
    if (!resUnauth.success) {
      expect(resUnauth.code).toBe('UNAUTHENTICATED');
    }

    // 2. Bearer token rejection
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('authorization', 'Bearer invalid-token');
    const resBearer = await createProjectAction(
      {
        clientId,
        title: 'Bearer Token Attempt',
      },
      dbClient,
    );
    expect(resBearer.success).toBe(false);
    if (!resBearer.success) {
      expect(resBearer.code).toBe('UNAUTHORIZED');
    }
  });

  it('allows owner to delete project via deleteProjectAction', async () => {
    const [stages] = await Promise.all([dbClient.query.pipelineStages.findMany()]);
    const stage = stages[0];
    if (!stage) throw new Error('Expected stage');

    const projId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projId,
      clientId,
      stageId: stage.id,
      title: 'Project to Delete',
      projectTypeKey: 'commercial',
    });

    const res = await deleteProjectAction({ projectId: projId }, dbClient);
    expect(res.success).toBe(true);

    const [deleted] = await dbClient
      .select()
      .from(projects)
      .where(eq(projects.id, projId))
      .limit(1);
    expect(deleted).toBeUndefined();
  });
});

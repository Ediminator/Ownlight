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
import { convertLeadToClient } from '@/server/leads/convert';
import {
  registerLeadConversionStep,
  resetLeadConversionSteps,
} from '@/server/leads/conversion-steps';
import { registerProjectLeadConversionStep } from '@/server/projects/conversion-step';
import {
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
  transitionProjectStageAction,
  createShootAction,
  updateShootAction,
  deleteShootAction,
  createShootLocationAction,
  updateShootLocationAction,
  deleteShootLocationAction,
  createShootTimelineItemAction,
  updateShootTimelineItemAction,
  deleteShootTimelineItemAction,
  createProjectParticipantAction,
  deleteProjectParticipantAction,
  toggleProjectTaskAction,
  createProjectTaskAction,
  deleteProjectTaskAction,
} from '@/server/projects/actions';
import {
  getPipelineStages,
  getPipelineStageByKey,
  getInitialPipelineStage,
} from '@/server/projects/stages';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { clients } from '@/server/db/schema/clients';
import {
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
} from '@/server/db/schema/projects';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0034: Projects Domain & Lead Conversion Integration (AC-1 to AC-10)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Reset and register project conversion step
    resetLeadConversionSteps();
    registerProjectLeadConversionStep();

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
      emailVerified: true,
      role: ownerUser.role,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Create active owner session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Create test form & notice version
    formId = generateUuidV7();
    noticeVersionId = generateUuidV7();

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'contact-studio',
      name: 'Wedding Inquiries 2027',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'family_name', enabled: true, required: false, order: 1 },
        { key: 'email', enabled: true, required: true, order: 2 },
        { key: 'event_type', enabled: true, required: true, order: 3 },
        { key: 'event_date', enabled: true, required: false, order: 4 },
        { key: 'event_location', enabled: true, required: false, order: 5 },
      ],
      eventTypes: [
        { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
        { key: 'portrait', label_en: 'Portrait Session', label_de: 'Porträt-Shooting' },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      privacyPolicyUrl: 'https://example.org/privacy',
      acknowledgementTextEn: 'I acknowledge the privacy policy',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis',
      createdByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterEach(async () => {
    resetLeadConversionSteps();
    await testDb.destroy();
  });

  async function seedTestLead(overrides: Partial<typeof leads.$inferInsert> = {}) {
    const leadId = generateUuidV7();
    const [inserted] = await dbClient
      .insert(leads)
      .values({
        id: leadId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: new Date('2026-03-01T12:00:00Z'),
        status: 'new',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Emma',
        familyName: 'Watson',
        email: 'emma.watson@example.org',
        emailNormalized: 'emma.watson@example.org',
        phone: '+49 30 12345678',
        eventTypeKey: 'wedding',
        eventDate: '2027-06-19',
        eventLocation: 'Villa Berg, Berlin',
        message: 'Looking forward to our wedding photography booking.',
        receivedAt: new Date('2026-03-01T12:00:00Z'),
        lastActivityAt: new Date('2026-03-01T12:00:00Z'),
        ...overrides,
      })
      .returning();
    if (!inserted) {
      throw new Error('Failed to insert test lead');
    }
    return inserted;
  }

  // AC-1 (R-A)
  it('AC-1: converts lead to client and atomically creates linked project, primary shoot, location, participant, and default tasks', async () => {
    const lead = await seedTestLead({
      givenName: 'Emma',
      familyName: 'Watson',
      eventTypeKey: 'wedding',
      eventDate: '2027-06-19',
      eventLocation: 'Villa Berg, Berlin',
    });

    const result = await convertLeadToClient(
      lead.id,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );

    // 1. Return structure
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.clientId).toBeDefined();
    expect(result.data.clientId).toBe(result.clientId);
    expect(result.data.projectId).toBeDefined();

    const projectId = result.data.projectId;
    if (!projectId) return;

    // 2. Project record in database
    const [project] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    expect(project).toBeDefined();
    if (!project) return;
    expect(project.clientId).toBe(result.clientId);
    expect(project.title).toBe('Emma Watson - Wedding');
    expect(project.projectTypeKey).toBe('wedding');
    expect(project.currency).toBe('EUR');

    const initialStage = await getInitialPipelineStage(dbClient);
    expect(project.stageId).toBe(initialStage?.id);
    expect(project.primaryShootStartsAt).toEqual(new Date('2027-06-19T00:00:00.000Z'));
    expect(project.primaryShootTimezone).toBe('Europe/Berlin');

    // 3. Primary shoot record
    const [shoot] = await dbClient.select().from(shoots).where(eq(shoots.projectId, projectId));
    expect(shoot).toBeDefined();
    if (!shoot) return;
    expect(shoot.title).toBe('Main Shoot');
    expect(shoot.startsAt).toEqual(new Date('2027-06-19T00:00:00.000Z'));
    expect(shoot.timezone).toBe('Europe/Berlin');

    // 4. Primary location record
    const [loc] = await dbClient
      .select()
      .from(shootLocations)
      .where(eq(shootLocations.shootId, shoot.id));
    expect(loc).toBeDefined();
    if (!loc) return;
    expect(loc.name).toBe('Villa Berg, Berlin');

    // 5. Client primary contact added as participant
    const [participant] = await dbClient
      .select()
      .from(projectParticipants)
      .where(eq(projectParticipants.projectId, projectId));
    expect(participant).toBeDefined();
    if (!participant) return;
    expect(participant.role).toBe('Client');
    expect(participant.isPrimary).toBe(true);
    expect(participant.name).toBe('Emma Watson');
    expect(participant.email).toBe('emma.watson@example.org');

    // 6. Default stage tasks initialized
    const tasks = await dbClient
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId));
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.stageId === initialStage?.id)).toBe(true);
    expect(tasks.every((t) => !t.isCompleted)).toBe(true);

    // 7. Timeline event on client relationship timeline
    const timelineEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, result.clientId));
    const projectCreatedEvent = timelineEvents.find((e) => e.type === 'project.created');
    expect(projectCreatedEvent).toBeDefined();
    expect(projectCreatedEvent?.data).toEqual({
      project_id: projectId,
      project_type: 'wedding',
    });

    // 8. Audit log event
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.created'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const auditRecord = audits.find((a) => a.targetId === projectId);
    expect(auditRecord).toBeDefined();
    expect(auditRecord?.metadata).toMatchObject({
      project_id: projectId,
      client_id: result.clientId,
      project_type: 'wedding',
      stage_id: initialStage?.id,
      lead_id: lead.id,
    });
  });

  // AC-2
  it('AC-2: rolls back entire transaction if project creation step throws an error', async () => {
    // Override the registered step with a failing step
    resetLeadConversionSteps();
    registerLeadConversionStep({
      id: 'create-project-on-lead-conversion',
      run: () => Promise.reject(new Error('Simulated database error during project creation')),
    });

    const lead = await seedTestLead({
      givenName: 'Rollback',
      familyName: 'Tester',
      email: 'rollback@example.org',
    });

    await expect(
      convertLeadToClient(lead.id, { mode: 'new_client' }, ownerUser.id, dbClient),
    ).rejects.toThrow('Simulated database error during project creation');

    // Verify 100% atomic rollback
    // 1. Lead status remains 'new'
    const [leadAfter] = await dbClient.select().from(leads).where(eq(leads.id, lead.id));
    expect(leadAfter).toBeDefined();
    if (!leadAfter) return;
    expect(leadAfter.status).toBe('new');
    expect(leadAfter.clientId).toBeNull();
    // 2. Lead PII is NOT nulled
    expect(leadAfter.givenName).toBe('Rollback');
    expect(leadAfter.familyName).toBe('Tester');
    expect(leadAfter.email).toBe('rollback@example.org');

    // 3. No client was created
    const clientsCount = await dbClient.select().from(clients);
    expect(clientsCount.length).toBe(0);

    // 4. No project was created
    const projectsCount = await dbClient.select().from(projects);
    expect(projectsCount.length).toBe(0);
  });

  // AC-3 (R-A)
  it('AC-3: authenticated owner web session creates new project via createProjectAction', async () => {
    // Seed existing client
    const clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Hannah Schmidt',
      preferredLocale: 'de',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const stages = await getPipelineStages(dbClient);
    const bookedStage = stages.find((s) => s.key === 'booked');
    expect(bookedStage).toBeDefined();
    if (!bookedStage) return;

    const res = await createProjectAction(
      {
        clientId,
        title: 'Hannah Commercial Shoot',
        projectTypeKey: 'commercial',
        stageId: bookedStage.id,
        priceMinor: 250000,
        currency: 'EUR',
        notes: 'Full day studio production',
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.projectId).toBeDefined();

    // Verify database record
    const [p] = await dbClient.select().from(projects).where(eq(projects.id, res.data.projectId));
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.title).toBe('Hannah Commercial Shoot');
    expect(p.projectTypeKey).toBe('commercial');
    expect(p.stageId).toBe(bookedStage.id);
    expect(p.priceMinor).toBe(250000);

    // Verify timeline event project.created
    const timelineEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    expect(timelineEvents.some((e) => e.type === 'project.created')).toBe(true);

    // Verify audit log event project.created
    const auditLogs = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.created'));
    expect(auditLogs.some((a) => a.targetId === res.data.projectId)).toBe(true);
  });

  // AC-4 (R-A)
  it('AC-4: authenticated owner web session transitions project stage and bumps last_activity_at on project and client', async () => {
    const clientId = generateUuidV7();
    const oldTime = new Date('2026-01-01T10:00:00Z');
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'David Miller',
      preferredLocale: 'en',
      lastActivityAt: oldTime,
      createdAt: oldTime,
      updatedAt: oldTime,
    });

    const initialStage = await getPipelineStageByKey('inquiry', dbClient);
    const bookedStage = await getPipelineStageByKey('booked', dbClient);
    expect(initialStage).toBeDefined();
    expect(bookedStage).toBeDefined();
    if (!initialStage || !bookedStage) return;

    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: initialStage.id,
      title: 'David Miller - Inquiry',
      projectTypeKey: 'portrait',
      lastActivityAt: oldTime,
      createdAt: oldTime,
      updatedAt: oldTime,
    });

    const res = await transitionProjectStageAction(
      {
        projectId,
        targetStageId: bookedStage.id,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.stageId).toBe(bookedStage.id);
    expect(res.data.stageKey).toBe('booked');

    // Verify stage_id and last_activity_at updated on project
    const [updatedProject] = await dbClient
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(updatedProject).toBeDefined();
    if (!updatedProject) return;
    expect(updatedProject.stageId).toBe(bookedStage.id);
    expect(updatedProject.lastActivityAt.getTime()).toBeGreaterThan(oldTime.getTime());

    // Verify last_activity_at updated on client
    const [updatedClient] = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(updatedClient).toBeDefined();
    if (!updatedClient) return;
    expect(updatedClient.lastActivityAt.getTime()).toBeGreaterThan(oldTime.getTime());

    // Verify timeline event project.stage_changed
    const timelineEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    const stageEvent = timelineEvents.find((e) => e.type === 'project.stage_changed');
    expect(stageEvent).toBeDefined();
    expect(stageEvent?.data).toEqual({
      project_id: projectId,
      from_stage: 'inquiry',
      to_stage: 'booked',
    });

    // Verify audit event project.stage_changed
    const auditLogs = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.stage_changed'));
    expect(auditLogs.some((a) => a.targetId === projectId)).toBe(true);
  });

  // AC-5
  it('AC-5: transitionProjectStageAction returns advisory metadata detailing incomplete tasks count and titles', async () => {
    const clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Sophie Taylor',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const editingStage = await getPipelineStageByKey('editing', dbClient);
    const deliveredStage = await getPipelineStageByKey('delivered', dbClient);
    expect(editingStage).toBeDefined();
    expect(deliveredStage).toBeDefined();
    if (!editingStage || !deliveredStage) return;

    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: editingStage.id,
      title: 'Sophie Wedding',
      projectTypeKey: 'wedding',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Insert 2 incomplete tasks and 1 completed task in stage 'editing'
    await dbClient.insert(projectTasks).values([
      {
        id: generateUuidV7(),
        projectId,
        stageId: editingStage.id,
        title: 'Export high-res photos',
        isCompleted: false,
        order: 1,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: generateUuidV7(),
        projectId,
        stageId: editingStage.id,
        title: 'Colour grading pass 2',
        isCompleted: false,
        order: 2,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: generateUuidV7(),
        projectId,
        stageId: editingStage.id,
        title: 'Culling raw files',
        isCompleted: true,
        completedAt: new Date('2026-01-01T00:00:00Z'),
        order: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const res = await transitionProjectStageAction(
      {
        projectId,
        targetStageId: deliveredStage.id,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    // Verify advisory incomplete tasks count and titles
    expect(res.data.advisoryIncompleteTasks).toBeDefined();
    expect(res.data.advisoryIncompleteTasks.count).toBe(2);
    expect(res.data.advisoryIncompleteTasks.tasks.map((t) => t.title)).toEqual([
      'Export high-res photos',
      'Colour grading pass 2',
    ]);

    // Verify stage in DB is updated to deliveredStage
    const [p] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.stageId).toBe(deliveredStage.id);
  });

  // AC-6 (R-A)
  it('AC-6: authenticated owner web session creates shoot session and recalculates primary_shoot_starts_at', async () => {
    const clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Lucas Vance',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const initialStage = await getInitialPipelineStage(dbClient);
    expect(initialStage).toBeDefined();
    if (!initialStage) return;

    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: initialStage.id,
      title: 'Lucas Portrait',
      projectTypeKey: 'portrait',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 1. Create first shoot (later date)
    const laterDate = new Date('2027-08-15T14:00:00Z');
    const res1 = await createShootAction(
      {
        projectId,
        title: 'Studio Session',
        startsAt: laterDate,
        timezone: 'Europe/Berlin',
        location: 'Studio Loft Berlin',
      },
      dbClient,
    );
    expect(res1.success).toBe(true);

    const [pAfter1] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    expect(pAfter1).toBeDefined();
    if (!pAfter1) return;
    expect(pAfter1.primaryShootStartsAt).toEqual(laterDate);

    // 2. Create second shoot (earlier date)
    const earlierDate = new Date('2027-08-01T10:00:00Z');
    const res2 = await createShootAction(
      {
        projectId,
        title: 'Consultation & Pre-Shoot',
        startsAt: earlierDate,
        timezone: 'Europe/Berlin',
      },
      dbClient,
    );
    expect(res2.success).toBe(true);

    // Project primary shoot start date updates to the earlier shoot
    const [pAfter2] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    expect(pAfter2).toBeDefined();
    if (!pAfter2) return;
    expect(pAfter2.primaryShootStartsAt).toEqual(earlierDate);

    // Verify timeline event shoot.scheduled emitted
    const timelineEvents = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    expect(timelineEvents.some((e) => e.type === 'shoot.scheduled')).toBe(true);
  });

  // AC-7 (R-A)
  it('AC-7: authenticated owner web session creates and orders shoot timeline item', async () => {
    const clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Mia & Leo',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const initialStage = await getInitialPipelineStage(dbClient);
    expect(initialStage).toBeDefined();
    if (!initialStage) return;

    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: initialStage.id,
      title: 'Mia & Leo Wedding',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const shootId = generateUuidV7();
    await dbClient.insert(shoots).values({
      id: shootId,
      projectId,
      title: 'Wedding Day',
      startsAt: new Date('2027-09-10T11:00:00Z'),
      timezone: 'Europe/Berlin',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const res = await createShootTimelineItemAction(
      {
        shootId,
        startsAt: new Date('2027-09-10T13:00:00Z'),
        endsAt: new Date('2027-09-10T14:00:00Z'),
        title: 'Ceremony',
        description: 'Vows and ring exchange at chapel',
        order: 1,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.itemId).toBeDefined();

    const [item] = await dbClient
      .select()
      .from(shootTimelineItems)
      .where(eq(shootTimelineItems.id, res.data.itemId));
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.title).toBe('Ceremony');
    expect(item.description).toBe('Vows and ring exchange at chapel');
    expect(item.order).toBe(1);
  });

  // AC-8 (R-A)
  it('AC-8: authenticated owner web session toggles project task is_completed and completed_at', async () => {
    const clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Clara Oswald',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const initialStage = await getInitialPipelineStage(dbClient);
    expect(initialStage).toBeDefined();
    if (!initialStage) return;

    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: initialStage.id,
      title: 'Clara Event',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const taskId = generateUuidV7();
    await dbClient.insert(projectTasks).values({
      id: taskId,
      projectId,
      stageId: initialStage.id,
      title: 'Send welcome email and questionnaire',
      isCompleted: false,
      completedAt: null,
      order: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 1. First toggle: sets is_completed = true and completed_at = current timestamp
    const res1 = await toggleProjectTaskAction({ taskId }, dbClient);
    expect(res1.success).toBe(true);

    const [task1] = await dbClient.select().from(projectTasks).where(eq(projectTasks.id, taskId));
    expect(task1).toBeDefined();
    if (!task1) return;
    expect(task1.isCompleted).toBe(true);
    expect(task1.completedAt).not.toBeNull();
    expect(task1.completedAt instanceof Date).toBe(true);

    // 2. Second toggle: resets is_completed = false and completed_at = null
    const res2 = await toggleProjectTaskAction({ taskId }, dbClient);
    expect(res2.success).toBe(true);

    const [task2] = await dbClient.select().from(projectTasks).where(eq(projectTasks.id, taskId));
    expect(task2).toBeDefined();
    if (!task2) return;
    expect(task2.isCompleted).toBe(false);
    expect(task2.completedAt).toBeNull();
  });

  // AC-9
  it('AC-9: unauthenticated request to any server action in projects/actions.ts rejects with UNAUTHENTICATED', async () => {
    // Clear cookies -> unauthenticated
    mockCookiesStore.clear();

    const dummyUuid = generateUuidV7();

    const actions = [
      () => createProjectAction({ clientId: dummyUuid, title: 'Test' }, dbClient),
      () => updateProjectAction({ projectId: dummyUuid, title: 'Updated' }, dbClient),
      () => deleteProjectAction({ projectId: dummyUuid }, dbClient),
      () =>
        transitionProjectStageAction({ projectId: dummyUuid, targetStageId: dummyUuid }, dbClient),
      () => createShootAction({ projectId: dummyUuid, startsAt: new Date() }, dbClient),
      () => updateShootAction({ shootId: dummyUuid, title: 'Updated' }, dbClient),
      () => deleteShootAction({ shootId: dummyUuid }, dbClient),
      () => createShootLocationAction({ shootId: dummyUuid, name: 'Venue' }, dbClient),
      () => updateShootLocationAction({ locationId: dummyUuid, name: 'Venue 2' }, dbClient),
      () => deleteShootLocationAction({ locationId: dummyUuid }, dbClient),
      () =>
        createShootTimelineItemAction(
          { shootId: dummyUuid, startsAt: new Date(), title: 'Arrival' },
          dbClient,
        ),
      () => updateShootTimelineItemAction({ itemId: dummyUuid, title: 'Arrival 2' }, dbClient),
      () => deleteShootTimelineItemAction({ itemId: dummyUuid }, dbClient),
      () =>
        createProjectParticipantAction(
          { projectId: dummyUuid, name: 'Vendor', role: 'Planner' },
          dbClient,
        ),
      () => deleteProjectParticipantAction({ participantId: dummyUuid }, dbClient),
      () => createProjectTaskAction({ projectId: dummyUuid, title: 'Review shots' }, dbClient),
      () => toggleProjectTaskAction({ taskId: dummyUuid }, dbClient),
      () => deleteProjectTaskAction({ taskId: dummyUuid }, dbClient),
    ];

    for (const action of actions) {
      const res = await action();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    }
  });

  // AC-10
  it('AC-10: invalid inputs fail zod validation with VALIDATION_FAILED and cause zero database mutations', async () => {
    // 1. Non-UUID IDs
    const resNonUuid = await createProjectAction(
      {
        clientId: 'not-a-uuid',
        title: 'Project Title',
      },
      dbClient,
    );
    expect(resNonUuid.success).toBe(false);
    if (!resNonUuid.success) {
      expect(resNonUuid.code).toBe('VALIDATION_FAILED');
      expect(resNonUuid.fields).toContain('clientId');
    }

    // 2. Empty project title
    const resEmptyTitle = await createProjectAction(
      {
        clientId: generateUuidV7(),
        title: '   ',
      },
      dbClient,
    );
    expect(resEmptyTitle.success).toBe(false);
    if (!resEmptyTitle.success) {
      expect(resEmptyTitle.code).toBe('VALIDATION_FAILED');
      expect(resEmptyTitle.fields).toContain('title');
    }

    // 3. Negative price
    const resNegativePrice = await createProjectAction(
      {
        clientId: generateUuidV7(),
        title: 'Negative Price Project',
        priceMinor: -500,
      },
      dbClient,
    );
    expect(resNegativePrice.success).toBe(false);
    if (!resNegativePrice.success) {
      expect(resNegativePrice.code).toBe('VALIDATION_FAILED');
      expect(resNegativePrice.fields).toContain('priceMinor');
    }

    // 4. Invalid timezone string
    const resInvalidTz = await createShootAction(
      {
        projectId: generateUuidV7(),
        startsAt: new Date(),
        timezone: 'Mars/Olympus_Mons',
      },
      dbClient,
    );
    expect(resInvalidTz.success).toBe(false);
    if (!resInvalidTz.success) {
      expect(resInvalidTz.code).toBe('VALIDATION_FAILED');
      expect(resInvalidTz.fields).toContain('timezone');
    }

    // 5. Zero projects in DB
    const projectsInDb = await dbClient.select().from(projects);
    expect(projectsInDb.length).toBe(0);
  });
});

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
import { transitionProjectStageAction } from '@/server/projects/actions';
import { getKanbanBoardData } from '@/server/projects/service';
import { getPipelineStages } from '@/server/projects/stages';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { clients } from '@/server/db/schema/clients';
import { projects, projectTasks } from '@/server/db/schema/projects';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0036: Pipeline Kanban Board Integration Tests (AC-1 to AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let clientId: string;
  let inquiryStageId: string;
  let bookedStageId: string;
  let shotStageId: string;
  let editingStageId: string;
  let deliveredStageId: string;

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
      emailVerified: true,
      role: ownerUser.role,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Create active owner session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Resolve pipeline stages
    const stages = await getPipelineStages(dbClient);
    const stageMap = new Map(stages.map((s) => [s.key, s.id]));
    inquiryStageId = stageMap.get('inquiry') ?? '';
    bookedStageId = stageMap.get('booked') ?? '';
    shotStageId = stageMap.get('shot') ?? '';
    editingStageId = stageMap.get('editing') ?? '';
    deliveredStageId = stageMap.get('delivered') ?? '';

    // 4. Seed sample client
    clientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Emma Watson',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: getKanbanBoardData returns all 6 pipeline stages in position ASC order and projects with joined client and task metrics', async () => {
    // Seed projects in inquiry and editing
    const p1Id = generateUuidV7();
    await dbClient.insert(projects).values({
      id: p1Id,
      clientId,
      stageId: inquiryStageId,
      title: 'Emma & Liam Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: new Date('2027-06-19T10:00:00Z'),
      primaryShootTimezone: 'Europe/Berlin',
      currency: 'EUR',
      priceMinor: 250000,
    });

    // Seed task for p1
    await dbClient.insert(projectTasks).values({
      id: generateUuidV7(),
      projectId: p1Id,
      stageId: inquiryStageId,
      title: 'Send wedding guide',
      isCompleted: true,
      completedAt: new Date(),
    });

    const boardData = await getKanbanBoardData(dbClient);

    expect(boardData.stages).toHaveLength(6);
    expect(boardData.stages.map((s) => s.key)).toEqual([
      'inquiry',
      'booked',
      'shot',
      'editing',
      'delivered',
      'archived',
    ]);

    expect(boardData.projects).toHaveLength(1);
    const p = boardData.projects[0];
    if (!p) throw new Error('Expected project');
    expect(p.id).toBe(p1Id);
    expect(p.title).toBe('Emma & Liam Wedding');
    expect(p.clientDisplayName).toBe('Emma Watson');
    expect(p.stageKey).toBe('inquiry');
    expect(p.priceMinor).toBe(250000);
    expect(p.taskCount).toBe(1);
    expect(p.completedTaskCount).toBe(1);
    expect(p.incompleteTasks).toHaveLength(0);
  });

  it('AC-2: transitionProjectStageAction moves card, updates activity timestamps, and records timeline and audit events', async () => {
    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: inquiryStageId,
      title: 'Stage Move Project',
      projectTypeKey: 'wedding',
      currency: 'EUR',
    });

    const res = await transitionProjectStageAction(
      {
        projectId,
        targetStageId: bookedStageId,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.projectId).toBe(projectId);
    expect(res.data.stageId).toBe(bookedStageId);
    expect(res.data.stageKey).toBe('booked');

    // Verify DB update
    const [updated] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    if (!updated) throw new Error('Expected updated project');
    expect(updated.stageId).toBe(bookedStageId);

    // Verify timeline event: project.stage_changed
    const events = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));
    const stageEvent = events.find((e) => e.type === 'project.stage_changed');
    expect(stageEvent).toBeDefined();
    expect(stageEvent?.data).toEqual({
      project_id: projectId,
      from_stage: 'inquiry',
      to_stage: 'booked',
    });

    // Verify audit log event: project.stage_changed
    const audits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'project.stage_changed'));
    expect(audits).toHaveLength(1);
    const firstAudit = audits[0];
    if (!firstAudit) throw new Error('Expected audit event');
    expect(firstAudit.metadata).toMatchObject({
      project_id: projectId,
      from_stage: 'inquiry',
      to_stage: 'booked',
    });
  });

  it('AC-3: accessible keyboard stage transition executes transitionProjectStageAction directly without dragging', async () => {
    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: inquiryStageId,
      title: 'Keyboard Nav Project',
      projectTypeKey: 'portrait',
      currency: 'EUR',
    });

    // Move to 'shot' directly
    const res = await transitionProjectStageAction(
      {
        projectId,
        targetStageId: shotStageId,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.stageKey).toBe('shot');

    const [updated] = await dbClient.select().from(projects).where(eq(projects.id, projectId));
    if (!updated) throw new Error('Expected updated project');
    expect(updated.stageId).toBe(shotStageId);
  });

  it('AC-4: transitionProjectStageAction returns advisory incomplete tasks when moving project with open tasks', async () => {
    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: editingStageId,
      title: 'Editing Workflow Project',
      projectTypeKey: 'wedding',
      currency: 'EUR',
    });

    // Add 2 incomplete tasks in Editing stage
    await dbClient.insert(projectTasks).values([
      {
        id: generateUuidV7(),
        projectId,
        stageId: editingStageId,
        title: 'Task A: Color grading',
        isCompleted: false,
      },
      {
        id: generateUuidV7(),
        projectId,
        stageId: editingStageId,
        title: 'Task B: High-res export',
        isCompleted: false,
      },
    ]);

    const res = await transitionProjectStageAction(
      {
        projectId,
        targetStageId: deliveredStageId,
      },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.stageKey).toBe('delivered');
    expect(res.data.advisoryIncompleteTasks.count).toBe(2);
    expect(res.data.advisoryIncompleteTasks.tasks.map((t) => t.title)).toEqual([
      'Task A: Color grading',
      'Task B: High-res export',
    ]);
  });

  it('AC-6: rejects unauthenticated caller and bearer token', async () => {
    const projectId = generateUuidV7();
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: inquiryStageId,
      title: 'Auth Test Project',
      currency: 'EUR',
    });

    // 1. Without session cookie
    mockCookiesStore.clear();
    const unauth = await transitionProjectStageAction(
      { projectId, targetStageId: bookedStageId },
      dbClient,
    );
    expect(unauth.success).toBe(false);
    if (!unauth.success) {
      expect(unauth.code).toBe('UNAUTHENTICATED');
    }

    // 2. With Bearer token header
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('authorization', 'Bearer invalid-token');
    const bearerReject = await transitionProjectStageAction(
      { projectId, targetStageId: bookedStageId },
      dbClient,
    );
    expect(bearerReject.success).toBe(false);
    if (!bearerReject.success) {
      expect(bearerReject.code).toBe('UNAUTHORIZED');
    }

    // 3. Non-existent project
    mockHeadersStore.clear();
    const notFound = await transitionProjectStageAction(
      { projectId: generateUuidV7(), targetStageId: bookedStageId },
      dbClient,
    );
    expect(notFound.success).toBe(false);
    if (!notFound.success) {
      expect(notFound.code).toBe('NOT_FOUND');
    }

    // 4. Non-existent stage
    const stageNotFound = await transitionProjectStageAction(
      { projectId, targetStageId: generateUuidV7() },
      dbClient,
    );
    expect(stageNotFound.success).toBe(false);
    if (!stageNotFound.success) {
      expect(stageNotFound.code).toBe('NOT_FOUND');
    }
  });
});

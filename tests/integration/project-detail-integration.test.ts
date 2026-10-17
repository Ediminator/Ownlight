import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import {
  createProjectAction,
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
  createProjectTaskAction,
  toggleProjectTaskAction,
  deleteProjectTaskAction,
} from '@/server/projects/actions';
import { getProjectDetail, getProjectsForClient } from '@/server/projects/service';
import { getInitialPipelineStage } from '@/server/projects/stages';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { clients, clientContacts } from '@/server/db/schema/clients';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0038: Project Detail & Fulfillment Operations Integration', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let testClientId: string;
  let testContactId: string;
  let initialStageId: string;
  let testProjectId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // 1. Seed owner user and session
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

    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 2. Fetch initial pipeline stage
    const initStage = await getInitialPipelineStage(dbClient);
    if (!initStage) throw new Error('Initial stage not found');
    initialStageId = initStage.id;

    // 3. Seed client with contact
    testClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: testClientId,
      displayName: 'Hannah & Leon Berg',
      kind: 'person',
      preferredLocale: 'de',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    testContactId = generateUuidV7();
    await dbClient.insert(clientContacts).values({
      id: testContactId,
      clientId: testClientId,
      givenName: 'Hannah',
      familyName: 'Berg',
      email: 'hannah.berg@example.com',
      phone: '+49 30 55556666',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Create base project via createProjectAction
    const createProjectRes = await createProjectAction(
      {
        clientId: testClientId,
        title: 'Hannah & Leon Wedding',
        projectTypeKey: 'wedding',
        stageId: initialStageId,
        priceMinor: 420000,
        currency: 'EUR',
        notes: 'Full day summer wedding in Brandenburg',
      },
      dbClient,
    );

    expect(createProjectRes.success).toBe(true);
    if (!createProjectRes.success) throw new Error('Failed to create project');
    testProjectId = createProjectRes.data.projectId;
  });

  // AC-1: Detail view query assembly
  describe('AC-1: getProjectDetail Data Assembly', () => {
    it('AC-1: returns comprehensive detail object for existing project', async () => {
      const detail = await getProjectDetail(testProjectId, dbClient);
      expect(detail).not.toBeNull();
      expect(detail?.project.id).toBe(testProjectId);
      expect(detail?.project.title).toBe('Hannah & Leon Wedding');
      expect(detail?.client.id).toBe(testClientId);
      expect(detail?.client.displayName).toBe('Hannah & Leon Berg');
      expect(detail?.clientContacts).toHaveLength(1);
      expect(detail?.clientContacts[0]?.displayName).toBe('Hannah Berg');
      expect(detail?.stages.length).toBeGreaterThanOrEqual(1);
      expect(detail?.currentStage?.id).toBe(initialStageId);
    });

    it('AC-1: returns null for non-existent project ID', async () => {
      const nonExistentId = generateUuidV7();
      const detail = await getProjectDetail(nonExistentId, dbClient);
      expect(detail).toBeNull();
    });
  });

  // AC-2: Shoot and location CRUD operations
  describe('AC-2: Shoots and Locations Operations', () => {
    it('AC-2: creates, updates, and deletes shoot sessions', async () => {
      // 1. Create shoot session
      const createShootRes = await createShootAction(
        {
          projectId: testProjectId,
          title: 'Full Day Wedding Ceremony & Reception',
          startsAt: new Date('2026-08-20T12:00:00Z'),
          endsAt: new Date('2026-08-20T22:00:00Z'),
          timezone: 'Europe/Berlin',
          notes: 'Nikon Z8 bodies, 24-70, 70-200, flashes',
        },
        dbClient,
      );

      expect(createShootRes.success).toBe(true);
      if (!createShootRes.success) throw new Error('Failed to create shoot');
      const shootId = createShootRes.data.shootId;

      // 2. Update shoot session
      const updateShootRes = await updateShootAction(
        {
          shootId,
          title: 'Updated Wedding Celebration',
          notes: 'Added backup flash transmitters',
        },
        dbClient,
      );

      expect(updateShootRes.success).toBe(true);
      if (!updateShootRes.success) throw new Error('Failed to update shoot');
      expect(updateShootRes.data.shoot.title).toBe('Updated Wedding Celebration');

      // 3. Delete shoot session
      const deleteShootRes = await deleteShootAction({ shootId }, dbClient);
      expect(deleteShootRes.success).toBe(true);
    });

    it('AC-2: creates, updates, and deletes physical venues and locations', async () => {
      // Create shoot session first
      const createShootRes = await createShootAction(
        {
          projectId: testProjectId,
          title: 'Church Ceremony',
          startsAt: new Date('2026-08-20T11:00:00Z'),
          timezone: 'Europe/Berlin',
        },
        dbClient,
      );
      if (!createShootRes.success) throw new Error('Failed to create shoot');
      const shootId = createShootRes.data.shootId;

      // 1. Create shoot location
      const createLocRes = await createShootLocationAction(
        {
          shootId,
          name: 'St. Elisabeth Church',
          addressLine1: 'Invalidenstr. 3',
          addressLine2: 'Parish Hall',
          postalCode: '10115',
          city: 'Berlin',
          countryCode: 'DE',
          notes: 'Flash photography prohibited on altar area',
          order: 1,
        },
        dbClient,
      );

      expect(createLocRes.success).toBe(true);
      if (!createLocRes.success) throw new Error('Failed to create location');
      const locationId = createLocRes.data.locationId;

      // Verify in getProjectDetail
      const detail = await getProjectDetail(testProjectId, dbClient);
      expect(detail?.locations).toHaveLength(1);
      expect(detail?.locations[0]?.name).toBe('St. Elisabeth Church');
      expect(detail?.locations[0]?.shootTitle).toBe('Church Ceremony');

      // 2. Update location
      const updateLocRes = await updateShootLocationAction(
        {
          locationId,
          notes: 'Updated: flash allowed with diffuser',
        },
        dbClient,
      );
      expect(updateLocRes.success).toBe(true);

      // 3. Delete location
      const deleteLocRes = await deleteShootLocationAction({ locationId }, dbClient);
      expect(deleteLocRes.success).toBe(true);
    });

    it('AC-2: rejects shoot creation with invalid timezone', async () => {
      const res = await createShootAction(
        {
          projectId: testProjectId,
          title: 'Shoot with Invalid TZ',
          timezone: 'Mars/Curiosity_Base',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // AC-3: Day-of Timeline schedule items
  describe('AC-3: Day-of Timeline Schedule Items Operations', () => {
    it('AC-3: manages chronological timeline items linked to shoots and locations', async () => {
      // 1. Setup shoot & location
      const shootRes = await createShootAction(
        {
          projectId: testProjectId,
          title: 'Wedding Day',
          startsAt: new Date('2026-08-20T12:00:00Z'),
          timezone: 'Europe/Berlin',
        },
        dbClient,
      );
      if (!shootRes.success) throw new Error('Failed to create shoot');
      const shootId = shootRes.data.shootId;

      const locRes = await createShootLocationAction(
        {
          shootId,
          name: 'Schloss Liebenberg',
          addressLine1: 'Parkweg 1',
          postalCode: '16775',
          city: 'Liebenwalde',
          countryCode: 'DE',
        },
        dbClient,
      );
      if (!locRes.success) throw new Error('Failed to create location');
      const locationId = locRes.data.locationId;

      // 2. Create timeline item
      const itemRes = await createShootTimelineItemAction(
        {
          shootId,
          locationId,
          title: '14:00 First Look in Castle Courtyard',
          description: 'Private moment between bride and groom before guests arrive',
          startsAt: new Date('2026-08-20T14:00:00Z'),
          endsAt: new Date('2026-08-20T14:30:00Z'),
          order: 1,
        },
        dbClient,
      );

      expect(itemRes.success).toBe(true);
      if (!itemRes.success) throw new Error('Failed to create timeline item');
      const itemId = itemRes.data.itemId;

      // Verify in getProjectDetail
      const detail = await getProjectDetail(testProjectId, dbClient);
      expect(detail?.timelineItems).toHaveLength(1);
      expect(detail?.timelineItems[0]?.title).toBe('14:00 First Look in Castle Courtyard');
      expect(detail?.timelineItems[0]?.locationName).toBe('Schloss Liebenberg');

      // 3. Update timeline item
      const updateRes = await updateShootTimelineItemAction(
        {
          itemId,
          title: '14:15 First Look (Adjusted)',
        },
        dbClient,
      );
      expect(updateRes.success).toBe(true);

      // 4. Delete timeline item
      const delRes = await deleteShootTimelineItemAction({ itemId }, dbClient);
      expect(delRes.success).toBe(true);
    });
  });

  // AC-4: Participant management
  describe('AC-4: Project Participant Management Operations', () => {
    it('AC-4: adds and removes client contact and external vendor participants', async () => {
      // 1. Add client contact participant
      const clientPartRes = await createProjectParticipantAction(
        {
          projectId: testProjectId,
          contactId: testContactId,
          role: 'Bride',
          isPrimary: true,
          notes: 'Main decision maker',
        },
        dbClient,
      );

      expect(clientPartRes.success).toBe(true);
      if (!clientPartRes.success) throw new Error('Failed to add client participant');
      const clientPartId = clientPartRes.data.participantId;

      // 2. Add external vendor participant
      const vendorPartRes = await createProjectParticipantAction(
        {
          projectId: testProjectId,
          name: 'Julian Brand',
          role: 'Videographer',
          email: 'julian@cinema.example',
          phone: '+49 151 77788899',
          isPrimary: false,
          notes: 'Coordinating audio feeds during vows',
        },
        dbClient,
      );

      expect(vendorPartRes.success).toBe(true);
      if (!vendorPartRes.success) throw new Error('Failed to add vendor participant');
      const vendorPartId = vendorPartRes.data.participantId;

      // Verify in getProjectDetail
      const detail = await getProjectDetail(testProjectId, dbClient);
      expect(detail?.participants).toHaveLength(2);

      const clientPart = detail?.participants.find((p) => p.id === clientPartId);
      expect(clientPart?.contactDisplayName).toBe('Hannah Berg');
      expect(clientPart?.isPrimary).toBe(true);

      const vendorPart = detail?.participants.find((p) => p.id === vendorPartId);
      expect(vendorPart?.name).toBe('Julian Brand');
      expect(vendorPart?.role).toBe('Videographer');

      // 3. Remove participants
      const delClientRes = await deleteProjectParticipantAction(
        { participantId: clientPartId },
        dbClient,
      );
      expect(delClientRes.success).toBe(true);

      const delVendorRes = await deleteProjectParticipantAction(
        { participantId: vendorPartId },
        dbClient,
      );
      expect(delVendorRes.success).toBe(true);
    });

    it('AC-4: rejects participant creation with invalid email', async () => {
      const res = await createProjectParticipantAction(
        {
          projectId: testProjectId,
          name: 'Bad Email Vendor',
          role: 'DJ',
          email: 'not-an-email',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  // AC-5: Interactive stage tasks checklist
  describe('AC-5: Interactive Stage Tasks Operations', () => {
    it('AC-5: creates, toggles completion, and deletes project tasks', async () => {
      // 1. Create task
      const createTaskRes = await createProjectTaskAction(
        {
          projectId: testProjectId,
          stageId: initialStageId,
          title: 'Review and sign contract',
          dueDate: new Date('2026-06-15T00:00:00Z'),
          order: 1,
        },
        dbClient,
      );

      expect(createTaskRes.success).toBe(true);
      if (!createTaskRes.success) throw new Error('Failed to create task');
      const taskId = createTaskRes.data.taskId;

      // 2. Toggle task to completed
      const toggleOnRes = await toggleProjectTaskAction(
        {
          taskId,
        },
        dbClient,
      );

      expect(toggleOnRes.success).toBe(true);
      if (!toggleOnRes.success) throw new Error('Failed to toggle task');
      expect(toggleOnRes.data.task.isCompleted).toBe(true);
      expect(toggleOnRes.data.task.completedAt).not.toBeNull();

      // 3. Toggle task back to incomplete
      const toggleOffRes = await toggleProjectTaskAction(
        {
          taskId,
        },
        dbClient,
      );

      expect(toggleOffRes.success).toBe(true);
      if (!toggleOffRes.success) throw new Error('Failed to toggle task');
      expect(toggleOffRes.data.task.isCompleted).toBe(false);
      expect(toggleOffRes.data.task.completedAt).toBeNull();

      // 4. Delete task
      const delTaskRes = await deleteProjectTaskAction({ taskId }, dbClient);
      expect(delTaskRes.success).toBe(true);
    });
  });

  // AC-6: Client Profile Projects Listing
  describe('AC-6: getProjectsForClient Integration', () => {
    it('AC-6: returns projects for client with stage key and task counts', async () => {
      // Create a shoot session for shoot date summary
      await createShootAction(
        {
          projectId: testProjectId,
          title: 'Ceremony',
          startsAt: new Date('2026-08-20T14:00:00Z'),
          timezone: 'Europe/Berlin',
        },
        dbClient,
      );

      const projects = await getProjectsForClient(testClientId, dbClient);
      expect(projects).toHaveLength(1);
      expect(projects[0]?.id).toBe(testProjectId);
      expect(projects[0]?.title).toBe('Hannah & Leon Wedding');
      expect(projects[0]?.stageKey).toBe('inquiry');
      expect(projects[0]?.primaryShootStartsAt).not.toBeNull();
    });

    it('AC-6: returns empty array for client with no projects', async () => {
      const otherClientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: otherClientId,
        displayName: 'Empty Client',
        kind: 'person',
        preferredLocale: 'de',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const projects = await getProjectsForClient(otherClientId, dbClient);
      expect(projects).toEqual([]);
    });
  });
});

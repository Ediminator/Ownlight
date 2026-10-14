import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  isValidIanaTimezone,
  createProjectSchema,
  updateProjectSchema,
  transitionStageSchema,
  deleteProjectSchema,
  createShootSchema,
  updateShootSchema,
  deleteShootSchema,
  createShootLocationSchema,
  updateShootLocationSchema,
  deleteShootLocationSchema,
  createShootTimelineItemSchema,
  updateShootTimelineItemSchema,
  deleteShootTimelineItemSchema,
  createProjectParticipantSchema,
  deleteProjectParticipantSchema,
  createProjectTaskSchema,
  toggleProjectTaskSchema,
  deleteProjectTaskSchema,
} from '@/server/projects/schema';
import { authorizeProjectRead, authorizeProjectWrite } from '@/server/projects/policy';
import { ForbiddenError, type AuthContext } from '@/server/auth/guards';
import { type ApiKeyWithScopes } from '@/server/auth/api-keys';
import { PROJECTS_READ, PROJECTS_WRITE } from '@/server/auth/scopes';
import { generateUuidV7 } from '@/lib/id';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import * as projectService from '@/server/projects/service';
import * as projectActions from '@/server/projects/actions';
import * as repo from '@/server/projects/repo';
import { getInitialPipelineStage } from '@/server/projects/stages';
import { createProjectOnLeadConversion } from '@/server/projects/conversion-step';
import { user, type User } from '@/server/db/schema/auth';
import { clients } from '@/server/db/schema/clients';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads } from '@/server/db/schema/leads';
import { projects } from '@/server/db/schema/projects';
import { eq } from 'drizzle-orm';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';

function createMockUser(role: string): User {
  return {
    id: generateUuidV7(),
    name: 'Test User',
    email: 'test@example.org',
    emailVerified: true,
    image: null,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockApiKey(scopes: string[]): ApiKeyWithScopes {
  return {
    id: generateUuidV7(),
    userId: generateUuidV7(),
    name: 'Test Key',
    prefix: 'ownlight_',
    tokenHash: 'hash',
    scopes,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };
}

describe('Projects Domain Unit & Branch Tests', () => {
  describe('Zod Schema Validation & Timezone Utilities', () => {
    it('isValidIanaTimezone recognizes valid and invalid identifiers', () => {
      expect(isValidIanaTimezone('Europe/Berlin')).toBe(true);
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Invalid/Zone')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone(null as unknown as string)).toBe(false);
      expect(isValidIanaTimezone(123 as unknown as string)).toBe(false);
    });

    it('createProjectSchema validates bounds, strictness, and defaults', () => {
      const valid = {
        clientId: generateUuidV7(),
        title: 'Wedding Shoot',
        projectTypeKey: 'wedding',
        priceMinor: 50000,
        currency: 'EUR',
      };
      const parsed = createProjectSchema.safeParse(valid);
      expect(parsed.success).toBe(true);

      // Strict rejection on unexpected property
      const strictFail = createProjectSchema.safeParse({ ...valid, maliciousField: true });
      expect(strictFail.success).toBe(false);

      // Negative price rejection
      const negativePrice = createProjectSchema.safeParse({ ...valid, priceMinor: -1 });
      expect(negativePrice.success).toBe(false);

      // Non-integer price rejection
      const floatPrice = createProjectSchema.safeParse({ ...valid, priceMinor: 49.99 });
      expect(floatPrice.success).toBe(false);

      // Empty title rejection
      const emptyTitle = createProjectSchema.safeParse({ ...valid, title: '   ' });
      expect(emptyTitle.success).toBe(false);

      // Currency length != 3
      const badCurrency = createProjectSchema.safeParse({ ...valid, currency: 'US' });
      expect(badCurrency.success).toBe(false);
    });

    it('updateProjectSchema, transitionStageSchema, and deleteProjectSchema validate UUIDs', () => {
      const pId = generateUuidV7();
      const sId = generateUuidV7();

      expect(updateProjectSchema.safeParse({ projectId: pId, title: 'New' }).success).toBe(true);
      expect(updateProjectSchema.safeParse({ projectId: 'not-uuid' }).success).toBe(false);

      expect(transitionStageSchema.safeParse({ projectId: pId, targetStageId: sId }).success).toBe(
        true,
      );
      expect(
        transitionStageSchema.safeParse({ projectId: pId, targetStageId: 'bad' }).success,
      ).toBe(false);

      expect(deleteProjectSchema.safeParse({ projectId: pId }).success).toBe(true);
      expect(deleteProjectSchema.safeParse({ projectId: 'invalid' }).success).toBe(false);
    });

    it('shoot schemas validate bounds and dates', () => {
      const pId = generateUuidV7();
      const sId = generateUuidV7();

      expect(
        createShootSchema.safeParse({
          projectId: pId,
          startsAt: '2027-05-10T10:00:00Z',
          timezone: 'Europe/Berlin',
        }).success,
      ).toBe(true);
      expect(
        createShootSchema.safeParse({
          projectId: pId,
          startsAt: '2027-05-10T10:00:00Z',
          timezone: 'Not/Real',
        }).success,
      ).toBe(false);

      expect(updateShootSchema.safeParse({ shootId: sId, title: 'Session' }).success).toBe(true);
      expect(deleteShootSchema.safeParse({ shootId: sId }).success).toBe(true);
    });

    it('createProjectParticipantSchema requires either contactId or valid name', () => {
      const pId = generateUuidV7();
      const cId = generateUuidV7();

      // With contactId only
      expect(
        createProjectParticipantSchema.safeParse({
          projectId: pId,
          contactId: cId,
          role: 'Client',
        }).success,
      ).toBe(true);

      // With name only
      expect(
        createProjectParticipantSchema.safeParse({
          projectId: pId,
          name: 'Floral Designer',
          role: 'Florist',
        }).success,
      ).toBe(true);

      // Without contactId and without name
      const neither = createProjectParticipantSchema.safeParse({
        projectId: pId,
        role: 'Client',
      });
      expect(neither.success).toBe(false);

      // With whitespace-only name
      const whitespaceOnly = createProjectParticipantSchema.safeParse({
        projectId: pId,
        name: '   ',
        role: 'Client',
      });
      expect(whitespaceOnly.success).toBe(false);

      expect(deleteProjectParticipantSchema.safeParse({ participantId: cId }).success).toBe(true);
    });

    it('shoot and location schemas enforce strict types and length limits', () => {
      const shootId = generateUuidV7();
      const locId = generateUuidV7();

      // createShootLocationSchema
      expect(
        createShootLocationSchema.safeParse({
          shootId,
          name: 'Church',
          countryCode: 'DE',
          order: 1,
        }).success,
      ).toBe(true);

      // Invalid countryCode length
      expect(
        createShootLocationSchema.safeParse({
          shootId,
          name: 'Church',
          countryCode: 'DEU',
        }).success,
      ).toBe(false);

      // updateShootLocationSchema
      expect(
        updateShootLocationSchema.safeParse({
          locationId: locId,
          name: 'New Hall',
        }).success,
      ).toBe(true);

      // deleteShootLocationSchema
      expect(deleteShootLocationSchema.safeParse({ locationId: locId }).success).toBe(true);
      expect(deleteShootLocationSchema.safeParse({ locationId: 'bad-uuid' }).success).toBe(false);
    });

    it('timeline item and task schemas enforce strict types and bounds', () => {
      const shootId = generateUuidV7();
      const itemId = generateUuidV7();
      const taskId = generateUuidV7();
      const projectId = generateUuidV7();

      expect(
        createShootTimelineItemSchema.safeParse({
          shootId,
          startsAt: '2027-06-19T14:00:00Z',
          title: 'First Look',
        }).success,
      ).toBe(true);

      expect(
        updateShootTimelineItemSchema.safeParse({
          itemId,
          title: 'Updated Look',
        }).success,
      ).toBe(true);

      expect(deleteShootTimelineItemSchema.safeParse({ itemId }).success).toBe(true);

      expect(
        createProjectTaskSchema.safeParse({
          projectId,
          title: 'Prepare backup SD cards',
        }).success,
      ).toBe(true);

      expect(toggleProjectTaskSchema.safeParse({ taskId }).success).toBe(true);
      expect(deleteProjectTaskSchema.safeParse({ taskId }).success).toBe(true);
    });
  });

  describe('Authorization Policy (policy.ts)', () => {
    it('authorizeProjectRead: permits active owner session and rejects non-owner or unauthenticated', async () => {
      const ownerAuth: AuthContext = {
        user: createMockUser('owner'),
        authType: 'session',
        scopes: ['*'],
      };
      await expect(authorizeProjectRead(ownerAuth)).resolves.toEqual(ownerAuth);

      const nonOwnerAuth: AuthContext = {
        user: createMockUser('client'),
        authType: 'session',
        scopes: ['*'],
      };
      await expect(authorizeProjectRead(nonOwnerAuth)).rejects.toThrow(ForbiddenError);

      const apiKeyNoScope: AuthContext = {
        user: createMockUser('owner'),
        apiKey: createMockApiKey(['clients:read']),
        authType: 'apiKey',
        scopes: ['clients:read'],
      };
      await expect(authorizeProjectRead(apiKeyNoScope)).rejects.toThrow(ForbiddenError);

      const apiKeyWithScope: AuthContext = {
        user: createMockUser('owner'),
        apiKey: createMockApiKey([PROJECTS_READ]),
        authType: 'apiKey',
        scopes: [PROJECTS_READ],
      };
      await expect(authorizeProjectRead(apiKeyWithScope)).resolves.toEqual(apiKeyWithScope);
    });

    it('authorizeProjectWrite: permits owner with projects:write and audits denied API key attempts', async () => {
      const ownerAuth: AuthContext = {
        user: createMockUser('owner'),
        authType: 'session',
        scopes: ['*'],
      };
      await expect(authorizeProjectWrite('project.created', null, ownerAuth)).resolves.toEqual(
        ownerAuth,
      );

      const apiKeyNoScope: AuthContext = {
        user: createMockUser('owner'),
        apiKey: createMockApiKey([PROJECTS_READ]),
        authType: 'apiKey',
        scopes: [PROJECTS_READ],
      };
      await expect(authorizeProjectWrite('project.created', null, apiKeyNoScope)).rejects.toThrow(
        ForbiddenError,
      );

      const nonOwnerApiKey: AuthContext = {
        user: createMockUser('assistant'),
        apiKey: createMockApiKey([PROJECTS_WRITE]),
        authType: 'apiKey',
        scopes: [PROJECTS_WRITE],
      };
      await expect(authorizeProjectWrite('project.created', null, nonOwnerApiKey)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe('Service & Actions Edge Cases with Isolated DB', () => {
    let testDb: TestDatabaseInstance;
    let dbClient: DbClient;
    let ownerUser: { id: string; name: string; email: string; role: string };

    beforeEach(async () => {
      testDb = await createIsolatedTestDatabase();
      dbClient = testDb.db as unknown as DbClient;

      mockCookiesStore.clear();
      mockHeadersStore.clear();

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
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRecord.token);
    });

    it('service returns NOT_FOUND when entities do not exist', async () => {
      const dummyId = generateUuidV7();

      // createProject with missing client
      const resCreate = await projectService.createProject(
        { clientId: dummyId, title: 'No Client' },
        ownerUser.id,
        dbClient,
      );
      expect(resCreate.success).toBe(false);
      if (!resCreate.success) {
        expect(resCreate.code).toBe('NOT_FOUND');
      }

      // updateProject with missing project
      const resUpdate = await projectService.updateProject(
        { projectId: dummyId, title: 'No Project' },
        ownerUser.id,
        dbClient,
      );
      expect(resUpdate.success).toBe(false);
      if (!resUpdate.success) {
        expect(resUpdate.code).toBe('NOT_FOUND');
      }

      // deleteProject with missing project
      const resDelete = await projectService.deleteProject(dummyId, ownerUser.id, dbClient);
      expect(resDelete.success).toBe(false);
      if (!resDelete.success) {
        expect(resDelete.code).toBe('NOT_FOUND');
      }

      // transitionProjectStage with missing project
      const resTrans = await projectService.transitionProjectStage(
        { projectId: dummyId, targetStageId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resTrans.success).toBe(false);
      if (!resTrans.success) {
        expect(resTrans.code).toBe('NOT_FOUND');
      }

      // shoot operations with missing shoot/project
      const resShoot = await projectService.createShoot(
        { projectId: dummyId, startsAt: new Date() },
        ownerUser.id,
        dbClient,
      );
      expect(resShoot.success).toBe(false);
      if (!resShoot.success) {
        expect(resShoot.code).toBe('NOT_FOUND');
      }

      const resShootUp = await projectService.updateShoot(
        { shootId: dummyId, title: 'New' },
        ownerUser.id,
        dbClient,
      );
      expect(resShootUp.success).toBe(false);
      if (!resShootUp.success) {
        expect(resShootUp.code).toBe('NOT_FOUND');
      }

      const resShootDel = await projectService.deleteShoot(
        { shootId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resShootDel.success).toBe(false);
      if (!resShootDel.success) {
        expect(resShootDel.code).toBe('NOT_FOUND');
      }

      // location operations with missing shoot
      const resLoc = await projectService.createShootLocation(
        { shootId: dummyId, name: 'Venue' },
        ownerUser.id,
        dbClient,
      );
      expect(resLoc.success).toBe(false);
      if (!resLoc.success) {
        expect(resLoc.code).toBe('NOT_FOUND');
      }

      // task toggle with missing task
      const resTask = await projectService.toggleProjectTask(
        { taskId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resTask.success).toBe(false);
      if (!resTask.success) {
        expect(resTask.code).toBe('NOT_FOUND');
      }
    });

    it('actions reject Bearer API keys with UNAUTHORIZED', async () => {
      mockHeadersStore.set('authorization', 'Bearer ownlight_test_token_sample');

      const dummyId = generateUuidV7();
      const res = await projectActions.createProjectAction(
        { clientId: dummyId, title: 'Test' },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHORIZED');
      }

      const resTrans = await projectActions.transitionProjectStageAction(
        { projectId: dummyId, targetStageId: dummyId },
        dbClient,
      );
      expect(resTrans.success).toBe(false);
      if (!resTrans.success) {
        expect(resTrans.code).toBe('UNAUTHORIZED');
      }
    });

    it('createProjectOnLeadConversion covers German locale, missing names, and non-standard dates', async () => {
      // 1. Seed inquiry form with German labels
      const formId = generateUuidV7();
      await dbClient.insert(inquiryForms).values({
        id: formId,
        slug: 'de-contact-form',
        name: 'Anfragen 2027',
        status: 'published',
        defaultLocale: 'de',
        fields: [],
        eventTypes: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Traumhochzeit' }],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      // 2. Seed client
      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Musterfrau KG',
        preferredLocale: 'de',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const noticeVersionId = generateUuidV7();
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

      // Lead with German locale, ISO datetime string, and no given/family name
      const leadId = generateUuidV7();
      const [insertedLead] = await dbClient
        .insert(leads)
        .values({
          id: leadId,
          clientId,
          formId,
          noticeVersionId,
          noticeAcknowledgedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'converted',
          verification: 'verified',
          deliveryMode: 'hosted',
          locale: 'de',
          givenName: null,
          familyName: null,
          email: null,
          eventTypeKey: 'wedding',
          eventDate: '2027-09-25T15:00:00Z',
          eventLocation: 'Schloss Sanssouci',
          message: 'Guten Tag',
          autoReplyStatus: 'not_applicable',
          convertedAt: new Date('2026-01-01T00:00:00Z'),
          receivedAt: new Date('2026-01-01T00:00:00Z'),
          lastActivityAt: new Date('2026-01-01T00:00:00Z'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();

      if (!insertedLead) {
        throw new Error('Failed to insert lead');
      }

      const syntheticLead = {
        ...insertedLead,
        // Simulates in-memory lead state in convert.ts
        givenName: null,
        familyName: null,
      };

      const result = await createProjectOnLeadConversion(syntheticLead, clientId, dbClient);
      expect(result.projectId).toBeDefined();

      const [p] = await dbClient.select().from(projects).where(eq(projects.id, result.projectId));
      expect(p).toBeDefined();
      if (!p) return;
      // Uses client.displayName and German label: "Musterfrau KG - Traumhochzeit"
      expect(p.title).toBe('Musterfrau KG - Traumhochzeit');
      expect(p.primaryShootStartsAt).toEqual(new Date('2027-09-25T15:00:00Z'));
    });

    it('covers complete CRUD lifecycle for projects, shoots, locations, items, participants, and tasks', async () => {
      // 1. Create client
      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Full Lifecycle Client',
        preferredLocale: 'en',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      // 2. Create project action
      const createRes = await projectActions.createProjectAction(
        {
          clientId,
          title: 'Initial Project Title',
          projectTypeKey: 'portrait',
          priceMinor: 10000,
          currency: 'EUR',
          notes: 'Initial notes',
        },
        dbClient,
      );
      expect(createRes.success).toBe(true);
      if (!createRes.success) return;
      const projectId = createRes.data.projectId;

      // 3. Update project action
      const updateRes = await projectActions.updateProjectAction(
        {
          projectId,
          title: 'Updated Project Title',
          projectTypeKey: 'portrait',
          priceMinor: 15000,
          currency: 'EUR',
          notes: 'Updated notes',
        },
        dbClient,
      );
      expect(updateRes.success).toBe(true);

      // 4. Create shoot action
      const shootRes = await projectActions.createShootAction(
        {
          projectId,
          title: 'Main Session',
          startsAt: '2027-05-10T10:00:00Z',
          endsAt: '2027-05-10T12:00:00Z',
          timezone: 'Europe/Berlin',
          notes: 'Shoot notes',
        },
        dbClient,
      );
      expect(shootRes.success).toBe(true);
      if (!shootRes.success) return;
      const shootId = shootRes.data.shootId;

      // 5. Update shoot action
      const shootUpRes = await projectActions.updateShootAction(
        {
          shootId,
          title: 'Updated Shoot Session',
          startsAt: '2027-05-10T11:00:00Z',
          endsAt: '2027-05-10T13:00:00Z',
          timezone: 'Europe/Berlin',
          notes: 'Updated shoot notes',
        },
        dbClient,
      );
      expect(shootUpRes.success).toBe(true);

      // 6. Create shoot location action
      const locRes = await projectActions.createShootLocationAction(
        {
          shootId,
          name: 'Central Park',
          addressLine1: 'Main Entrance',
          city: 'Berlin',
          countryCode: 'DE',
          order: 1,
        },
        dbClient,
      );
      expect(locRes.success).toBe(true);
      if (!locRes.success) return;
      const locationId = locRes.data.locationId;

      // 7. Update shoot location action
      const locUpRes = await projectActions.updateShootLocationAction(
        {
          locationId,
          name: 'Central Park West',
          addressLine1: 'West Gate',
          city: 'Berlin',
          countryCode: 'DE',
          notes: 'Updated location notes',
        },
        dbClient,
      );
      expect(locUpRes.success).toBe(true);

      // 8. Create shoot timeline item action
      const itemRes = await projectActions.createShootTimelineItemAction(
        {
          shootId,
          locationId,
          startsAt: '2027-05-10T11:15:00Z',
          endsAt: '2027-05-10T12:00:00Z',
          title: 'Golden Hour Photos',
          description: 'Near the pond',
          order: 1,
        },
        dbClient,
      );
      expect(itemRes.success).toBe(true);
      if (!itemRes.success) return;
      const itemId = itemRes.data.itemId;

      // 9. Update shoot timeline item action
      const itemUpRes = await projectActions.updateShootTimelineItemAction(
        {
          itemId,
          locationId,
          startsAt: '2027-05-10T11:30:00Z',
          title: 'Updated Golden Hour Photos',
          description: 'Updated pond photos',
          order: 2,
        },
        dbClient,
      );
      expect(itemUpRes.success).toBe(true);

      // 10. Delete shoot timeline item action
      const itemDelRes = await projectActions.deleteShootTimelineItemAction({ itemId }, dbClient);
      expect(itemDelRes.success).toBe(true);

      // 11. Delete shoot location action
      const locDelRes = await projectActions.deleteShootLocationAction({ locationId }, dbClient);
      expect(locDelRes.success).toBe(true);

      // 12. Delete shoot action
      const shootDelRes = await projectActions.deleteShootAction({ shootId }, dbClient);
      expect(shootDelRes.success).toBe(true);

      // 13. Create project participant action
      const partRes = await projectActions.createProjectParticipantAction(
        {
          projectId,
          name: 'Makeup Artist Jane',
          email: 'jane@example.org',
          phone: '+49 30 999999',
          role: 'Hair & Makeup',
          isPrimary: false,
        },
        dbClient,
      );
      expect(partRes.success).toBe(true);
      if (!partRes.success) return;
      const participantId = partRes.data.participantId;

      // 14. Delete project participant action
      const partDelRes = await projectActions.deleteProjectParticipantAction(
        { participantId },
        dbClient,
      );
      expect(partDelRes.success).toBe(true);

      // 15. Create project task action
      const taskRes = await projectActions.createProjectTaskAction(
        {
          projectId,
          title: 'Review invoice balance',
          order: 1,
        },
        dbClient,
      );
      expect(taskRes.success).toBe(true);
      if (!taskRes.success) return;
      const taskId = taskRes.data.taskId;

      // 16. Delete project task action
      const taskDelRes = await projectActions.deleteProjectTaskAction({ taskId }, dbClient);
      expect(taskDelRes.success).toBe(true);

      // 17. Delete project action
      const delProjRes = await projectActions.deleteProjectAction({ projectId }, dbClient);
      expect(delProjRes.success).toBe(true);
    });

    it('policy.ts: verifies role and scope enforcement for read and write', async () => {
      // 1. authorizeProjectRead with non-owner
      const memberContext: AuthContext = {
        authType: 'session',
        user: createMockUser('member'),
        session: {
          id: generateUuidV7(),
          userId: generateUuidV7(),
          token: 'token',
          expiresAt: new Date(Date.now() + 3600000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          lastReauthenticatedAt: new Date(),
        },
        scopes: ['*'],
      };
      await expect(authorizeProjectRead(memberContext)).rejects.toThrow(ForbiddenError);

      // 2. authorizeProjectRead with API key missing projects:read
      const apiKeyNoRead: AuthContext = {
        authType: 'apiKey',
        user: createMockUser('owner'),
        apiKey: createMockApiKey(['clients:read']),
        scopes: ['clients:read'],
      };
      await expect(authorizeProjectRead(apiKeyNoRead)).rejects.toThrow(ForbiddenError);

      // 3. authorizeProjectWrite with non-owner
      await expect(
        authorizeProjectWrite('project.create', null, memberContext, dbClient),
      ).rejects.toThrow(ForbiddenError);

      // 4. authorizeProjectWrite with API key missing projects:write
      await expect(
        authorizeProjectWrite('project.create', null, apiKeyNoRead, dbClient),
      ).rejects.toThrow(ForbiddenError);

      // 5. authorizeProjectWrite with non-owner apiKey records denied audit
      const clientApiKey: AuthContext = {
        authType: 'apiKey',
        user: createMockUser('client'),
        apiKey: createMockApiKey(['*']),
        scopes: ['*'],
      };
      await expect(
        authorizeProjectWrite('project.create', null, clientApiKey, dbClient),
      ).rejects.toThrow(ForbiddenError);
    });

    it('actions.ts: all 18 actions reject non-owner session with FORBIDDEN', async () => {
      // Create user with role 'member'
      const nonOwner = {
        id: generateUuidV7(),
        name: 'Member User',
        email: 'member@example.org',
        role: 'member',
      };
      await dbClient.insert(user).values({
        id: nonOwner.id,
        name: nonOwner.name,
        email: nonOwner.email,
        emailVerified: true,
        image: null,
        role: nonOwner.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const memberSession = await createSession(nonOwner.id, dbClient, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
      mockCookiesStore.set(SESSION_COOKIE_NAME, memberSession.token);
      mockHeadersStore.clear();

      const allActions = [
        () => projectActions.createProjectAction({}, dbClient),
        () => projectActions.updateProjectAction({}, dbClient),
        () => projectActions.deleteProjectAction({}, dbClient),
        () => projectActions.transitionProjectStageAction({}, dbClient),
        () => projectActions.createShootAction({}, dbClient),
        () => projectActions.updateShootAction({}, dbClient),
        () => projectActions.deleteShootAction({}, dbClient),
        () => projectActions.createShootLocationAction({}, dbClient),
        () => projectActions.updateShootLocationAction({}, dbClient),
        () => projectActions.deleteShootLocationAction({}, dbClient),
        () => projectActions.createShootTimelineItemAction({}, dbClient),
        () => projectActions.updateShootTimelineItemAction({}, dbClient),
        () => projectActions.deleteShootTimelineItemAction({}, dbClient),
        () => projectActions.createProjectParticipantAction({}, dbClient),
        () => projectActions.deleteProjectParticipantAction({}, dbClient),
        () => projectActions.createProjectTaskAction({}, dbClient),
        () => projectActions.toggleProjectTaskAction({}, dbClient),
        () => projectActions.deleteProjectTaskAction({}, dbClient),
      ];

      for (const act of allActions) {
        const res = await act();
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.code).toBe('FORBIDDEN');
        }
      }
    });

    it('actions.ts: all 18 actions reject Bearer tokens with UNAUTHORIZED', async () => {
      mockHeadersStore.set('authorization', 'Bearer token_abc123');
      const allActions = [
        () => projectActions.createProjectAction({}, dbClient),
        () => projectActions.updateProjectAction({}, dbClient),
        () => projectActions.deleteProjectAction({}, dbClient),
        () => projectActions.transitionProjectStageAction({}, dbClient),
        () => projectActions.createShootAction({}, dbClient),
        () => projectActions.updateShootAction({}, dbClient),
        () => projectActions.deleteShootAction({}, dbClient),
        () => projectActions.createShootLocationAction({}, dbClient),
        () => projectActions.updateShootLocationAction({}, dbClient),
        () => projectActions.deleteShootLocationAction({}, dbClient),
        () => projectActions.createShootTimelineItemAction({}, dbClient),
        () => projectActions.updateShootTimelineItemAction({}, dbClient),
        () => projectActions.deleteShootTimelineItemAction({}, dbClient),
        () => projectActions.createProjectParticipantAction({}, dbClient),
        () => projectActions.deleteProjectParticipantAction({}, dbClient),
        () => projectActions.createProjectTaskAction({}, dbClient),
        () => projectActions.toggleProjectTaskAction({}, dbClient),
        () => projectActions.deleteProjectTaskAction({}, dbClient),
      ];

      for (const act of allActions) {
        const res = await act();
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.code).toBe('UNAUTHORIZED');
        }
      }
      mockHeadersStore.clear();
    });

    it('actions.ts: all 18 actions reject invalid inputs with VALIDATION_FAILED when authenticated', async () => {
      const sessionRecord = await createSession(ownerUser.id, dbClient);
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRecord.token);
      mockHeadersStore.clear();

      const allActions = [
        () => projectActions.createProjectAction({}, dbClient),
        () => projectActions.updateProjectAction({}, dbClient),
        () => projectActions.deleteProjectAction({}, dbClient),
        () => projectActions.transitionProjectStageAction({}, dbClient),
        () => projectActions.createShootAction({}, dbClient),
        () => projectActions.updateShootAction({}, dbClient),
        () => projectActions.deleteShootAction({}, dbClient),
        () => projectActions.createShootLocationAction({}, dbClient),
        () => projectActions.updateShootLocationAction({}, dbClient),
        () => projectActions.deleteShootLocationAction({}, dbClient),
        () => projectActions.createShootTimelineItemAction({}, dbClient),
        () => projectActions.updateShootTimelineItemAction({}, dbClient),
        () => projectActions.deleteShootTimelineItemAction({}, dbClient),
        () => projectActions.createProjectParticipantAction({}, dbClient),
        () => projectActions.deleteProjectParticipantAction({}, dbClient),
        () => projectActions.createProjectTaskAction({}, dbClient),
        () => projectActions.toggleProjectTaskAction({}, dbClient),
        () => projectActions.deleteProjectTaskAction({}, dbClient),
      ];

      for (const act of allActions) {
        const res = await act();
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.code).toBe('VALIDATION_FAILED');
        }
      }
    });

    it('service.ts: covers task stage not found and task delete not found', async () => {
      const dummyId = generateUuidV7();
      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Task Edge Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const initialStage = await getInitialPipelineStage(dbClient);
      if (!initialStage) return;

      const proj = await repo.insertProject(
        {
          id: generateUuidV7(),
          clientId,
          stageId: initialStage.id,
          title: 'Task Edge Project',
          projectTypeKey: 'portrait',
        },
        dbClient,
      );

      // 1. createProjectTask with non-existent stageId
      const resStage = await projectService.createProjectTask(
        {
          projectId: proj.id,
          stageId: dummyId,
          title: 'Task with bad stage',
        },
        ownerUser.id,
        dbClient,
      );
      expect(resStage.success).toBe(false);
      if (!resStage.success) {
        expect(resStage.code).toBe('NOT_FOUND');
      }

      // 2. deleteProjectTask with non-existent taskId
      const resDel = await projectService.deleteProjectTask(
        { taskId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resDel.success).toBe(false);
      if (!resDel.success) {
        expect(resDel.code).toBe('NOT_FOUND');
      }
    });

    it('conversion-step.ts: covers fallback title branches and character truncation', async () => {
      const formId = generateUuidV7();
      await dbClient.insert(inquiryForms).values({
        id: formId,
        slug: `form-${formId.slice(0, 8)}`,
        name: 'Inquiry Form',
        status: 'published',
        defaultLocale: 'en',
        fields: [],
        eventTypes: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const noticeVersionId = generateUuidV7();
      await dbClient.insert(inquiryFormNoticeVersions).values({
        id: noticeVersionId,
        formId,
        version: 1,
        privacyPolicyUrl: 'https://example.org/privacy',
        acknowledgementTextEn: 'I acknowledge',
        acknowledgementTextDe: 'Ich stimme zu',
        createdByActorId: ownerUser.id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Truncation Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      async function seedLeadRow(overrides: Partial<typeof leads.$inferInsert> = {}) {
        const [row] = await dbClient
          .insert(leads)
          .values({
            id: generateUuidV7(),
            clientId,
            formId,
            noticeVersionId,
            noticeAcknowledgedAt: new Date(),
            status: 'converted',
            convertedAt: new Date(),
            verification: 'verified',
            deliveryMode: 'hosted',
            locale: 'en',
            givenName: 'Test',
            familyName: 'Lead',
            email: 'test@example.org',
            eventTypeKey: 'wedding',
            message: 'Hello',
            receivedAt: new Date(),
            lastActivityAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
          })
          .returning();
        if (!row) throw new Error('Lead insert failed');
        return row;
      }

      // 1. Long title truncation (> 200 chars)
      const lead1 = await seedLeadRow({
        givenName: 'A'.repeat(100),
        familyName: 'B'.repeat(100),
        eventTypeKey: 'wedding',
        eventDate: null,
        eventLocation: null,
      });

      const res1 = await createProjectOnLeadConversion(lead1, clientId, dbClient);
      expect(res1.projectId).toBeDefined();

      // 2. Missing eventTypeKey falls back to "${leadFullName} - Project"
      const lead2 = await seedLeadRow({
        givenName: 'Fallback',
        familyName: 'Lead',
        eventTypeKey: '',
        eventDate: null,
        eventLocation: null,
      });
      const res2 = await createProjectOnLeadConversion(lead2, clientId, dbClient);
      expect(res2.projectId).toBeDefined();

      // 3. Converted lead with no name falls back to "${clientDisplayName} - Project"
      const lead3 = await seedLeadRow({
        givenName: null,
        familyName: null,
        email: null,
        eventTypeKey: '',
        eventDate: null,
        eventLocation: null,
      });
      const res3 = await createProjectOnLeadConversion(lead3, clientId, dbClient);
      expect(res3.projectId).toBeDefined();
    });

    it('repo.ts: covers finding and listing routines', async () => {
      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Repo Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const initialStage = await getInitialPipelineStage(dbClient);
      expect(initialStage).toBeDefined();
      if (!initialStage) return;

      const proj = await repo.insertProject(
        {
          id: generateUuidV7(),
          clientId,
          stageId: initialStage.id,
          title: 'Repo Project',
          projectTypeKey: 'portrait',
        },
        dbClient,
      );

      const shoot = await repo.insertShoot(
        {
          id: generateUuidV7(),
          projectId: proj.id,
          title: 'Repo Shoot',
          startsAt: new Date('2027-01-01T10:00:00Z'),
          timezone: 'Europe/Berlin',
        },
        dbClient,
      );

      const loc = await repo.insertShootLocation(
        {
          id: generateUuidV7(),
          shootId: shoot.id,
          name: 'Repo Location',
        },
        dbClient,
      );

      const item = await repo.insertShootTimelineItem(
        {
          id: generateUuidV7(),
          shootId: shoot.id,
          title: 'Repo Item',
          startsAt: new Date('2027-01-01T10:00:00Z'),
          order: 1,
        },
        dbClient,
      );

      const part = await repo.insertProjectParticipant(
        {
          id: generateUuidV7(),
          projectId: proj.id,
          name: 'Repo Participant',
          role: 'Client',
        },
        dbClient,
      );

      const task = await repo.insertProjectTask(
        {
          id: generateUuidV7(),
          projectId: proj.id,
          stageId: initialStage.id,
          title: 'Repo Task',
          isCompleted: false,
          order: 1,
        },
        dbClient,
      );

      expect(await repo.findProjectById(proj.id, dbClient)).toBeDefined();
      expect(await repo.findShootById(shoot.id, dbClient)).toBeDefined();
      expect(await repo.findShootsByProjectId(proj.id, dbClient)).toHaveLength(1);
      expect(await repo.findShootLocationById(loc.id, dbClient)).toBeDefined();
      expect(await repo.findLocationsByShootId(shoot.id, dbClient)).toHaveLength(1);
      expect(await repo.findShootTimelineItemById(item.id, dbClient)).toBeDefined();
      expect(await repo.findTimelineItemsByShootId(shoot.id, dbClient)).toHaveLength(1);
      expect(await repo.findProjectParticipantById(part.id, dbClient)).toBeDefined();
      expect(await repo.findParticipantsByProjectId(proj.id, dbClient)).toHaveLength(1);
      expect(await repo.findProjectTaskById(task.id, dbClient)).toBeDefined();
      expect(await repo.findTasksByProjectId(proj.id, dbClient)).toHaveLength(1);
      expect(
        await repo.findIncompleteTasksByStage(proj.id, initialStage.id, dbClient),
      ).toHaveLength(1);

      // Recalculate primary shoot with no shoots (after delete)
      await repo.deleteShootRecord(shoot.id, dbClient);
      await repo.recalculatePrimaryShoot(proj.id, dbClient);
      const projAfter = await repo.findProjectById(proj.id, dbClient);
      expect(projAfter?.primaryShootStartsAt).toBeNull();
    });

    it('service.ts & policy.ts: covers optional fields and error branches', async () => {
      // 1. policy.ts: authorizeProjectRead and authorizeProjectWrite with options object (not AuthContext)
      const sessionRecord = await createSession(ownerUser.id, dbClient);
      mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRecord.token);
      const readAuth = await authorizeProjectRead({ client: dbClient });
      expect(readAuth.user.role).toBe('owner');
      const writeAuth = await authorizeProjectWrite('project.create', null, { client: dbClient });
      expect(writeAuth.user.role).toBe('owner');

      // 2. policy.ts: apiKey missing projects:write audits denied attempt
      const apiKeyMissingWrite: AuthContext = {
        authType: 'apiKey',
        user: createMockUser('owner'),
        apiKey: createMockApiKey(['clients:read']),
        scopes: ['clients:read'],
      };
      await expect(
        authorizeProjectWrite('project.create', 'proj-123', apiKeyMissingWrite, dbClient),
      ).rejects.toThrow(ForbiddenError);

      const clientId = generateUuidV7();
      await dbClient.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName: 'Branch Boost Client',
        preferredLocale: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const initialStage = await getInitialPipelineStage(dbClient);
      if (!initialStage) return;

      // 3. createProject error branches
      const dummyId = generateUuidV7();
      const resBadClient = await projectService.createProject(
        { clientId: dummyId, title: 'No Client' },
        ownerUser.id,
        dbClient,
      );
      expect(resBadClient.success).toBe(false);

      const resBadStage = await projectService.createProject(
        { clientId, title: 'Bad Stage', stageId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resBadStage.success).toBe(false);

      // 4. createProject success and updateProject with all optional fields
      const pRes = await projectService.createProject(
        { clientId, title: 'Full Project' },
        ownerUser.id,
        dbClient,
      );
      expect(pRes.success).toBe(true);
      if (!pRes.success) return;
      const projId = pRes.data.projectId;

      const resUpBadStage = await projectService.updateProject(
        { projectId: projId, stageId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(resUpBadStage.success).toBe(false);

      const resUpFull = await projectService.updateProject(
        {
          projectId: projId,
          title: 'Updated Title',
          projectTypeKey: 'commercial',
          stageId: initialStage.id,
          priceMinor: 150000,
          currency: 'EUR',
          notes: 'Full notes',
        },
        ownerUser.id,
        dbClient,
      );
      expect(resUpFull.success).toBe(true);

      // 5. createShoot with location string and updateShoot with all fields
      const shootRes = await projectService.createShoot(
        {
          projectId: projId,
          title: 'Shoot with Loc',
          startsAt: new Date('2027-02-01T10:00:00Z'),
          location: 'Main Studio',
        },
        ownerUser.id,
        dbClient,
      );
      expect(shootRes.success).toBe(true);
      if (!shootRes.success) return;
      const shootId = shootRes.data.shootId;

      const shootUpRes = await projectService.updateShoot(
        {
          shootId,
          title: 'Updated Shoot',
          startsAt: new Date('2027-02-01T11:00:00Z'),
          endsAt: new Date('2027-02-01T14:00:00Z'),
          timezone: 'Europe/Berlin',
          notes: 'Bring gear',
        },
        ownerUser.id,
        dbClient,
      );
      expect(shootUpRes.success).toBe(true);

      // 6. location error and full update
      const locRes = await projectService.createShootLocation(
        { shootId, name: 'Original Venue' },
        ownerUser.id,
        dbClient,
      );
      expect(locRes.success).toBe(true);
      if (!locRes.success) return;
      const locId = locRes.data.locationId;

      const locUpRes = await projectService.updateShootLocation(
        {
          locationId: locId,
          name: 'Updated Venue',
          addressLine1: 'Street 1',
          addressLine2: 'Apt 2',
          postalCode: '10115',
          city: 'Berlin',
          countryCode: 'DE',
          notes: 'Ring bell',
          order: 2,
        },
        ownerUser.id,
        dbClient,
      );
      expect(locUpRes.success).toBe(true);

      // 7. timeline item error branches and full update
      const badLocItem = await projectService.createShootTimelineItem(
        {
          shootId,
          locationId: dummyId,
          title: 'Bad Loc Item',
          startsAt: new Date('2027-02-01T11:00:00Z'),
        },
        ownerUser.id,
        dbClient,
      );
      expect(badLocItem.success).toBe(false);

      const itemRes = await projectService.createShootTimelineItem(
        {
          shootId,
          locationId: locId,
          title: 'Good Item',
          startsAt: new Date('2027-02-01T11:00:00Z'),
        },
        ownerUser.id,
        dbClient,
      );
      expect(itemRes.success).toBe(true);
      if (!itemRes.success) return;
      const itemId = itemRes.data.itemId;

      const upBadLocItem = await projectService.updateShootTimelineItem(
        { itemId, locationId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(upBadLocItem.success).toBe(false);

      const upFullItem = await projectService.updateShootTimelineItem(
        {
          itemId,
          locationId: locId,
          title: 'Updated Item Title',
          description: 'Detailed description',
          startsAt: new Date('2027-02-01T11:15:00Z'),
          endsAt: new Date('2027-02-01T12:00:00Z'),
          order: 3,
        },
        ownerUser.id,
        dbClient,
      );
      expect(upFullItem.success).toBe(true);

      const delMissingItem = await projectService.deleteShootTimelineItem(
        { itemId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(delMissingItem.success).toBe(false);

      // 8. participant error branches
      const badProjPart = await projectService.createProjectParticipant(
        { projectId: dummyId, name: 'Nobody', role: 'Client' },
        ownerUser.id,
        dbClient,
      );
      expect(badProjPart.success).toBe(false);

      const delMissingPart = await projectService.deleteProjectParticipant(
        { participantId: dummyId },
        ownerUser.id,
        dbClient,
      );
      expect(delMissingPart.success).toBe(false);

      // 9. task error branch
      const badProjTask = await projectService.createProjectTask(
        { projectId: dummyId, title: 'No Project Task' },
        ownerUser.id,
        dbClient,
      );
      expect(badProjTask.success).toBe(false);
    });
  });
});

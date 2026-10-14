import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  pipelineStages,
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
  stageTaskTemplates,
  clients,
  clientContacts,
  type PipelineStage,
} from '@/server/db/schema';
import {
  getPipelineStages,
  getPipelineStageById,
  getPipelineStageByKey,
  getInitialPipelineStage,
  getStageTaskTemplates,
} from '@/server/projects/stages';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';

describe('TASK-0033: Projects & Pipeline Schema Foundation (AC-1 to AC-7)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  // AC-1
  it('AC-1: fresh database with migrations applied has exactly 6 system default stages ordered by position ASC with is_system=true', async () => {
    const rows = await dbClient.select().from(pipelineStages).orderBy(pipelineStages.position);

    expect(rows).toHaveLength(6);

    const expectedKeys = ['inquiry', 'booked', 'shot', 'editing', 'delivered', 'archived'];
    const expectedCategories = [
      'inquiry',
      'booked',
      'in_progress',
      'review',
      'completed',
      'archived',
    ];
    const expectedColors = ['slate', 'blue', 'amber', 'purple', 'emerald', 'zinc'];

    rows.forEach((stage: PipelineStage, index: number) => {
      expect(stage.key).toBe(expectedKeys[index]);
      expect(stage.position).toBe(index + 1);
      expect(stage.category).toBe(expectedCategories[index]);
      expect(stage.color).toBe(expectedColors[index]);
      expect(stage.isSystem).toBe(true);
      expect(stage.id).toBeDefined();
      expect(stage.name).toBeDefined();
    });
  });

  it('AC-1: default stage task templates are seeded for default stages', async () => {
    const templates = await dbClient.select().from(stageTaskTemplates);
    expect(templates.length).toBeGreaterThanOrEqual(6);

    const [inquiryStage] = await dbClient
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'inquiry'));
    if (!inquiryStage) throw new Error('Inquiry stage not found');

    const inquiryTemplates = await getStageTaskTemplates(inquiryStage.id, dbClient);
    expect(inquiryTemplates.length).toBeGreaterThanOrEqual(1);
    expect(inquiryTemplates[0]?.title).toBe('Send pricing guide');
  });

  // AC-2
  it('AC-2: creates project record with default project_type_key="general", default currency="EUR", and generated UUIDv7', async () => {
    const [client] = await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Alice Wonderland',
        preferredLocale: 'en',
      })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [stage] = await dbClient
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'inquiry'))
      .limit(1);
    if (!stage) throw new Error('Stage not found');

    const [project] = await dbClient
      .insert(projects)
      .values({
        clientId: client.id,
        stageId: stage.id,
        title: 'Alice Wonderland - Wedding 2027',
      })
      .returning();

    if (!project) throw new Error('Project creation failed');
    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(project.clientId).toBe(client.id);
    expect(project.stageId).toBe(stage.id);
    expect(project.title).toBe('Alice Wonderland - Wedding 2027');
    expect(project.projectTypeKey).toBe('general');
    expect(project.currency).toBe('EUR');
    expect(project.priceMinor).toBeNull();
    expect(project.leadId).toBeNull();
    expect(project.primaryShootStartsAt).toBeNull();
    expect(project.lastActivityAt).toBeInstanceOf(Date);
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
  });

  // AC-3
  it('AC-3: child records across shoots, shoot_locations, shoot_timeline_items, project_participants, and project_tasks persist with foreign key integrity', async () => {
    // 1. Create client and contact
    const [client] = await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Bob & Clara',
        preferredLocale: 'de',
      })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client.id,
        givenName: 'Bob',
        familyName: 'Miller',
        email: 'bob@example.com',
        isPrimary: true,
      })
      .returning();
    if (!contact) throw new Error('Contact creation failed');

    // 2. Query stage
    const [stage] = await dbClient
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'booked'))
      .limit(1);
    if (!stage) throw new Error('Stage not found');

    // 3. Insert project
    const [project] = await dbClient
      .insert(projects)
      .values({
        clientId: client.id,
        stageId: stage.id,
        title: 'Bob & Clara Wedding',
        projectTypeKey: 'wedding',
        priceMinor: 250000,
        currency: 'EUR',
      })
      .returning();
    if (!project) throw new Error('Project creation failed');

    expect(project.priceMinor).toBe(250000);

    // 4. Insert shoot
    const shootStart = new Date('2027-06-15T10:00:00Z');
    const shootEnd = new Date('2027-06-15T22:00:00Z');
    const [shoot] = await dbClient
      .insert(shoots)
      .values({
        projectId: project.id,
        title: 'Wedding Day Shoot',
        startsAt: shootStart,
        endsAt: shootEnd,
        timezone: 'Europe/Berlin',
        notes: 'Bring dual camera bodies and flash triggers.',
      })
      .returning();
    if (!shoot) throw new Error('Shoot creation failed');

    expect(shoot.projectId).toBe(project.id);
    expect(shoot.startsAt.toISOString()).toBe(shootStart.toISOString());
    expect(shoot.endsAt?.toISOString()).toBe(shootEnd.toISOString());

    // 5. Insert shoot location
    const [location] = await dbClient
      .insert(shootLocations)
      .values({
        shootId: shoot.id,
        name: 'St. Thomas Church',
        addressLine1: 'Kirchgasse 1',
        postalCode: '10115',
        city: 'Berlin',
        countryCode: 'DE',
        notes: 'No flash during vows.',
        order: 1,
      })
      .returning();
    if (!location) throw new Error('Location creation failed');

    expect(location.shootId).toBe(shoot.id);
    expect(location.city).toBe('Berlin');

    // 6. Insert shoot timeline item
    const itemStart = new Date('2027-06-15T14:00:00Z');
    const [timelineItem] = await dbClient
      .insert(shootTimelineItems)
      .values({
        shootId: shoot.id,
        locationId: location.id,
        startsAt: itemStart,
        title: 'Ceremony',
        description: 'Wedding ceremony and exchange of rings.',
        order: 1,
      })
      .returning();
    if (!timelineItem) throw new Error('Timeline item creation failed');

    expect(timelineItem.shootId).toBe(shoot.id);
    expect(timelineItem.locationId).toBe(location.id);
    expect(timelineItem.title).toBe('Ceremony');

    // 7. Insert project participant linked to contact
    const [participant1] = await dbClient
      .insert(projectParticipants)
      .values({
        projectId: project.id,
        contactId: contact.id,
        role: 'Groom',
        isPrimary: true,
      })
      .returning();
    if (!participant1) throw new Error('Participant 1 creation failed');

    expect(participant1.contactId).toBe(contact.id);
    expect(participant1.role).toBe('Groom');

    // Insert project participant with external vendor (name only)
    const [participant2] = await dbClient
      .insert(projectParticipants)
      .values({
        projectId: project.id,
        name: 'Sarah Planner',
        email: 'sarah@example.com',
        role: 'Wedding Planner',
        isPrimary: false,
      })
      .returning();
    if (!participant2) throw new Error('Participant 2 creation failed');

    expect(participant2.contactId).toBeNull();
    expect(participant2.name).toBe('Sarah Planner');

    // 8. Insert project tasks
    const [task] = await dbClient
      .insert(projectTasks)
      .values({
        projectId: project.id,
        stageId: stage.id,
        title: 'Finalize shot list with couple',
        isCompleted: false,
        order: 1,
      })
      .returning();
    if (!task) throw new Error('Task creation failed');

    expect(task.projectId).toBe(project.id);
    expect(task.stageId).toBe(stage.id);
    expect(task.isCompleted).toBe(false);
  });

  // AC-4
  it('AC-4: database check constraint rejects project participant when both contact_id is null and name is null or empty whitespace', async () => {
    const [client] = await dbClient
      .insert(clients)
      .values({ kind: 'person', displayName: 'Constraint Test', preferredLocale: 'en' })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('Stage not found');

    const [project] = await dbClient
      .insert(projects)
      .values({ clientId: client.id, stageId: stage.id, title: 'Constraint Project' })
      .returning();
    if (!project) throw new Error('Project creation failed');

    // 1. Both contact_id and name are null
    await expect(
      dbClient.insert(projectParticipants).values({
        projectId: project.id,
        contactId: null,
        name: null,
        role: 'Assistant',
      }),
    ).rejects.toThrow();

    // 2. contact_id is null and name is empty string
    await expect(
      dbClient.insert(projectParticipants).values({
        projectId: project.id,
        contactId: null,
        name: '',
        role: 'Assistant',
      }),
    ).rejects.toThrow();

    // 3. contact_id is null and name is whitespace only
    await expect(
      dbClient.insert(projectParticipants).values({
        projectId: project.id,
        contactId: null,
        name: '    ',
        role: 'Assistant',
      }),
    ).rejects.toThrow();

    // 4. Succeeds when contact_id is provided even if name is null
    const [contact] = await dbClient
      .insert(clientContacts)
      .values({ clientId: client.id, givenName: 'Valid', email: 'valid@example.com' })
      .returning();
    if (!contact) throw new Error('Contact creation failed');

    const [valid1] = await dbClient
      .insert(projectParticipants)
      .values({
        projectId: project.id,
        contactId: contact.id,
        name: null,
        role: 'Client Liaison',
      })
      .returning();
    if (!valid1) throw new Error('Valid participant 1 creation failed');

    expect(valid1.contactId).toBe(contact.id);

    // 5. Succeeds when name is provided even if contact_id is null
    const [valid2] = await dbClient
      .insert(projectParticipants)
      .values({
        projectId: project.id,
        contactId: null,
        name: 'External Videographer',
        role: 'Videographer',
      })
      .returning();
    if (!valid2) throw new Error('Valid participant 2 creation failed');

    expect(valid2.name).toBe('External Videographer');
  });

  // AC-5
  it('AC-5: when parent client record is deleted, all associated projects, shoots, locations, timeline items, participants, and tasks cascade and delete cleanly', async () => {
    // Setup full hierarchy
    const [client] = await dbClient
      .insert(clients)
      .values({ kind: 'person', displayName: 'Cascade Test Client', preferredLocale: 'en' })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({ clientId: client.id, givenName: 'Cascade', email: 'cascade@example.com' })
      .returning();
    if (!contact) throw new Error('Contact creation failed');

    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('Stage not found');

    const [project] = await dbClient
      .insert(projects)
      .values({ clientId: client.id, stageId: stage.id, title: 'Cascade Project' })
      .returning();
    if (!project) throw new Error('Project creation failed');

    const [shoot] = await dbClient
      .insert(shoots)
      .values({
        projectId: project.id,
        startsAt: new Date(),
        title: 'Cascade Shoot',
      })
      .returning();
    if (!shoot) throw new Error('Shoot creation failed');

    const [location] = await dbClient
      .insert(shootLocations)
      .values({ shootId: shoot.id, name: 'Cascade Location' })
      .returning();
    if (!location) throw new Error('Location creation failed');

    await dbClient.insert(shootTimelineItems).values({
      shootId: shoot.id,
      locationId: location.id,
      startsAt: new Date(),
      title: 'Cascade Timeline Item',
    });

    await dbClient.insert(projectParticipants).values({
      projectId: project.id,
      contactId: contact.id,
      role: 'Participant',
    });

    await dbClient.insert(projectTasks).values({
      projectId: project.id,
      stageId: stage.id,
      title: 'Cascade Task',
    });

    // Verify all exist prior to deletion
    expect(await dbClient.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(
      1,
    );
    expect(await dbClient.select().from(shoots).where(eq(shoots.id, shoot.id))).toHaveLength(1);
    expect(
      await dbClient.select().from(shootLocations).where(eq(shootLocations.id, location.id)),
    ).toHaveLength(1);
    expect(
      await dbClient
        .select()
        .from(shootTimelineItems)
        .where(eq(shootTimelineItems.shootId, shoot.id)),
    ).toHaveLength(1);
    expect(
      await dbClient
        .select()
        .from(projectParticipants)
        .where(eq(projectParticipants.projectId, project.id)),
    ).toHaveLength(1);
    expect(
      await dbClient.select().from(projectTasks).where(eq(projectTasks.projectId, project.id)),
    ).toHaveLength(1);

    // Act: Delete parent client
    await dbClient.delete(clients).where(eq(clients.id, client.id));

    // Assert: Everything cascaded cleanly
    expect(await dbClient.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(
      0,
    );
    expect(await dbClient.select().from(shoots).where(eq(shoots.id, shoot.id))).toHaveLength(0);
    expect(
      await dbClient.select().from(shootLocations).where(eq(shootLocations.id, location.id)),
    ).toHaveLength(0);
    expect(
      await dbClient
        .select()
        .from(shootTimelineItems)
        .where(eq(shootTimelineItems.shootId, shoot.id)),
    ).toHaveLength(0);
    expect(
      await dbClient
        .select()
        .from(projectParticipants)
        .where(eq(projectParticipants.projectId, project.id)),
    ).toHaveLength(0);
    expect(
      await dbClient.select().from(projectTasks).where(eq(projectTasks.projectId, project.id)),
    ).toHaveLength(0);
  });

  // AC-6
  it('AC-6: foreign key onDelete="restrict" prevents deletion of a pipeline stage when projects reference it', async () => {
    const [client] = await dbClient
      .insert(clients)
      .values({ kind: 'person', displayName: 'Stage Restrict Test', preferredLocale: 'en' })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [stage] = await dbClient
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, 'booked'))
      .limit(1);
    if (!stage) throw new Error('Stage not found');

    await dbClient.insert(projects).values({
      clientId: client.id,
      stageId: stage.id,
      title: 'Restricted Stage Project',
    });

    // Attempting to delete stage should fail due to restrict foreign key
    await expect(
      dbClient.delete(pipelineStages).where(eq(pipelineStages.id, stage.id)),
    ).rejects.toThrow();
  });

  // AC-7
  it('AC-7: getPipelineStages(tx) returns stages sorted by position ASC with category, color, and name attributes', async () => {
    const stages = await getPipelineStages(dbClient);

    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stages.map((s) => s.key)).toEqual([
      'inquiry',
      'booked',
      'shot',
      'editing',
      'delivered',
      'archived',
    ]);

    const [inquiry, booked, shot, editing, delivered, archived] = stages;
    if (!inquiry || !booked || !shot || !editing || !delivered || !archived) {
      throw new Error('Expected 6 stages');
    }

    expect(inquiry.name).toBe('Inquiry');
    expect(inquiry.category).toBe('inquiry');
    expect(inquiry.color).toBe('slate');

    expect(booked.name).toBe('Booked');
    expect(booked.category).toBe('booked');
    expect(booked.color).toBe('blue');

    expect(shot.name).toBe('Shot');
    expect(shot.category).toBe('in_progress');
    expect(shot.color).toBe('amber');

    expect(editing.name).toBe('Editing');
    expect(editing.category).toBe('review');
    expect(editing.color).toBe('purple');

    expect(delivered.name).toBe('Delivered');
    expect(delivered.category).toBe('completed');
    expect(delivered.color).toBe('emerald');

    expect(archived.name).toBe('Archived');
    expect(archived.category).toBe('archived');
    expect(archived.color).toBe('zinc');
  });

  it('AC-7: getPipelineStageById and getPipelineStageByKey look up stages correctly', async () => {
    const bookedByKey = await getPipelineStageByKey('booked', dbClient);
    if (!bookedByKey) throw new Error('Booked stage not found by key');
    expect(bookedByKey.key).toBe('booked');

    const bookedById = await getPipelineStageById(bookedByKey.id, dbClient);
    if (!bookedById) throw new Error('Booked stage not found by id');
    expect(bookedById.id).toBe(bookedByKey.id);

    const nonExistentKey = await getPipelineStageByKey('non_existent', dbClient);
    expect(nonExistentKey).toBeNull();

    const nonExistentId = await getPipelineStageById(
      '01920000-0000-7000-8000-999999999999',
      dbClient,
    );
    expect(nonExistentId).toBeNull();
  });

  it('AC-7: getInitialPipelineStage returns first stage in pipeline', async () => {
    const initial = await getInitialPipelineStage(dbClient);
    if (!initial) throw new Error('Initial stage not found');
    expect(initial.position).toBe(1);
    expect(initial.key).toBe('inquiry');
  });

  it('AC-7: seedDefaultPipelineStages is idempotent and preserves stages and templates', async () => {
    const seeded = await seedDefaultPipelineStages(dbClient);
    expect(seeded).toHaveLength(6);

    const reSeeded = await seedDefaultPipelineStages(dbClient);
    expect(reSeeded).toHaveLength(6);
    expect(reSeeded.map((s) => s.id)).toEqual(seeded.map((s) => s.id));
  });
});

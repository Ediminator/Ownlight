import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getTableConfig } from 'drizzle-orm/pg-core';
import { createTableRelationsHelpers } from 'drizzle-orm';
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import {
  getPipelineStages,
  getPipelineStageById,
  getPipelineStageByKey,
  getInitialPipelineStage,
  getStageTaskTemplates,
} from '@/server/projects/stages';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import {
  PIPELINE_STAGE_CATEGORIES,
  pipelineStages,
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  stageTaskTemplates,
  projectTasks,
  pipelineStagesRelations,
  projectsRelations,
  shootsRelations,
  shootLocationsRelations,
  shootTimelineItemsRelations,
  projectParticipantsRelations,
  stageTaskTemplatesRelations,
  projectTasksRelations,
  clients,
} from '@/server/db/schema';

describe('Projects and Stages branch coverage and relations inspection', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  it('covers PIPELINE_STAGE_CATEGORIES and schema relation definitions', () => {
    expect(PIPELINE_STAGE_CATEGORIES).toHaveLength(6);

    const rStages = (
      pipelineStagesRelations as unknown as { config: (h: unknown) => unknown }
    ).config(createTableRelationsHelpers(pipelineStages));
    expect(rStages).toBeDefined();

    const rProjects = (projectsRelations as unknown as { config: (h: unknown) => unknown }).config(
      createTableRelationsHelpers(projects),
    );
    expect(rProjects).toBeDefined();

    const rShoots = (shootsRelations as unknown as { config: (h: unknown) => unknown }).config(
      createTableRelationsHelpers(shoots),
    );
    expect(rShoots).toBeDefined();

    const rLocs = (
      shootLocationsRelations as unknown as { config: (h: unknown) => unknown }
    ).config(createTableRelationsHelpers(shootLocations));
    expect(rLocs).toBeDefined();

    const rTimeline = (
      shootTimelineItemsRelations as unknown as { config: (h: unknown) => unknown }
    ).config(createTableRelationsHelpers(shootTimelineItems));
    expect(rTimeline).toBeDefined();

    const rParts = (
      projectParticipantsRelations as unknown as { config: (h: unknown) => unknown }
    ).config(createTableRelationsHelpers(projectParticipants));
    expect(rParts).toBeDefined();

    const rTemplates = (
      stageTaskTemplatesRelations as unknown as { config: (h: unknown) => unknown }
    ).config(createTableRelationsHelpers(stageTaskTemplates));
    expect(rTemplates).toBeDefined();

    const rTasks = (projectTasksRelations as unknown as { config: (h: unknown) => unknown }).config(
      createTableRelationsHelpers(projectTasks),
    );
    expect(rTasks).toBeDefined();
  });

  it('covers table foreign key references and lazy reference callbacks', () => {
    const tables = [
      pipelineStages,
      projects,
      shoots,
      shootLocations,
      shootTimelineItems,
      projectParticipants,
      stageTaskTemplates,
      projectTasks,
    ];

    for (const tbl of tables) {
      const config = getTableConfig(tbl);
      for (const fk of config.foreignKeys) {
        const ref = fk.reference();
        expect(ref.foreignTable).toBeDefined();
        expect(ref.columns.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers getPipelineStages with dbClient', async () => {
    const stages = await getPipelineStages(dbClient);
    expect(stages).toHaveLength(6);
    expect(stages[0]?.key).toBe('inquiry');
  });

  it('covers getPipelineStageById returning stage or null', async () => {
    const stages = await getPipelineStages(dbClient);
    const first = stages[0];
    if (!first) throw new Error('Stage not found');

    const found = await getPipelineStageById(first.id, dbClient);
    expect(found?.id).toBe(first.id);

    const notFound = await getPipelineStageById('01920000-0000-7000-8000-000000000099', dbClient);
    expect(notFound).toBeNull();
  });

  it('covers getPipelineStageByKey returning stage or null', async () => {
    const found = await getPipelineStageByKey('inquiry', dbClient);
    expect(found?.key).toBe('inquiry');

    const notFound = await getPipelineStageByKey('non_existent_key', dbClient);
    expect(notFound).toBeNull();
  });

  it('covers getInitialPipelineStage returning first stage or null on empty database', async () => {
    const initial = await getInitialPipelineStage(dbClient);
    expect(initial?.position).toBe(1);

    // Delete all stage templates and stages to test empty branch
    await dbClient.delete(stageTaskTemplates);
    await dbClient.delete(pipelineStages);

    const empty = await getInitialPipelineStage(dbClient);
    expect(empty).toBeNull();
  });

  it('covers getStageTaskTemplates returning templates or empty array', async () => {
    const inquiry = await getPipelineStageByKey('inquiry', dbClient);
    if (!inquiry) throw new Error('Inquiry stage not found');

    const templates = await getStageTaskTemplates(inquiry.id, dbClient);
    expect(templates.length).toBeGreaterThanOrEqual(1);

    const emptyTemplates = await getStageTaskTemplates(
      '01920000-0000-7000-8000-000000000099',
      dbClient,
    );
    expect(emptyTemplates).toEqual([]);
  });

  it('covers seedDefaultPipelineStages on empty database and idempotency', async () => {
    // Delete all stages and templates
    await dbClient.delete(stageTaskTemplates);
    await dbClient.delete(pipelineStages);

    // Re-seed from scratch
    const seeded = await seedDefaultPipelineStages(dbClient);
    expect(seeded).toHaveLength(6);
    expect(seeded[0]?.key).toBe('inquiry');

    // Run again to test existing records branch
    const reSeeded = await seedDefaultPipelineStages(dbClient);
    expect(reSeeded).toHaveLength(6);
  });

  it('covers default UUIDv7 generation for stage task templates and project tasks', async () => {
    const [client] = await dbClient
      .insert(clients)
      .values({ kind: 'person', displayName: 'Template Test', preferredLocale: 'en' })
      .returning();
    if (!client) throw new Error('Client creation failed');

    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('Stage not found');

    // Insert stage task template without ID to test $defaultFn
    const [template] = await dbClient
      .insert(stageTaskTemplates)
      .values({
        stageId: stage.id,
        title: 'Auto ID Template',
      })
      .returning();

    expect(template).toBeDefined();
    expect(template?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const [project] = await dbClient
      .insert(projects)
      .values({ clientId: client.id, stageId: stage.id, title: 'Task Test' })
      .returning();
    if (!project) throw new Error('Project creation failed');

    // Insert project task without ID to test $defaultFn
    const [task] = await dbClient
      .insert(projectTasks)
      .values({
        projectId: project.id,
        title: 'Auto ID Project Task',
      })
      .returning();

    expect(task).toBeDefined();
    expect(task?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

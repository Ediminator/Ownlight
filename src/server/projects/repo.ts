import { eq, asc, and } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients } from '@/server/db/schema/clients';
import {
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
  type Project,
  type NewProject,
  type Shoot,
  type NewShoot,
  type ShootLocation,
  type NewShootLocation,
  type ShootTimelineItem,
  type NewShootTimelineItem,
  type ProjectParticipant,
  type NewProjectParticipant,
  type ProjectTask,
  type NewProjectTask,
} from '@/server/db/schema/projects';

// --- Projects Repo ---

export async function findProjectById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<Project | null> {
  const [row] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export async function insertProject(data: NewProject, tx: DbClient = defaultDb): Promise<Project> {
  const [row] = await tx.insert(projects).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert project');
  }
  return row;
}

export async function updateProjectRecord(
  id: string,
  data: Partial<NewProject>,
  tx: DbClient = defaultDb,
): Promise<Project | null> {
  const [row] = await tx
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return row ?? null;
}

export async function deleteProjectRecord(id: string, tx: DbClient = defaultDb): Promise<boolean> {
  const res = await tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return res.length > 0;
}

/**
 * Recalculates and updates the denormalized primary shoot starts_at and timezone
 * on the parent project row by finding the earliest scheduled shoot.
 */
export async function recalculatePrimaryShoot(
  projectId: string,
  tx: DbClient = defaultDb,
): Promise<void> {
  const [earliestShoot] = await tx
    .select()
    .from(shoots)
    .where(eq(shoots.projectId, projectId))
    .orderBy(asc(shoots.startsAt))
    .limit(1);

  const now = new Date();
  if (earliestShoot) {
    await tx
      .update(projects)
      .set({
        primaryShootStartsAt: earliestShoot.startsAt,
        primaryShootTimezone: earliestShoot.timezone,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));
  } else {
    await tx
      .update(projects)
      .set({
        primaryShootStartsAt: null,
        primaryShootTimezone: null,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));
  }
}

// --- Shoots Repo ---

export async function findShootById(id: string, tx: DbClient = defaultDb): Promise<Shoot | null> {
  const [row] = await tx.select().from(shoots).where(eq(shoots.id, id)).limit(1);
  return row ?? null;
}

export async function findShootsByProjectId(
  projectId: string,
  tx: DbClient = defaultDb,
): Promise<Shoot[]> {
  return await tx
    .select()
    .from(shoots)
    .where(eq(shoots.projectId, projectId))
    .orderBy(asc(shoots.startsAt));
}

export async function insertShoot(data: NewShoot, tx: DbClient = defaultDb): Promise<Shoot> {
  const [row] = await tx.insert(shoots).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert shoot');
  }
  return row;
}

export async function updateShootRecord(
  id: string,
  data: Partial<NewShoot>,
  tx: DbClient = defaultDb,
): Promise<Shoot | null> {
  const [row] = await tx
    .update(shoots)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(shoots.id, id))
    .returning();
  return row ?? null;
}

export async function deleteShootRecord(id: string, tx: DbClient = defaultDb): Promise<boolean> {
  const res = await tx.delete(shoots).where(eq(shoots.id, id)).returning({ id: shoots.id });
  return res.length > 0;
}

// --- Shoot Locations Repo ---

export async function findShootLocationById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<ShootLocation | null> {
  const [row] = await tx.select().from(shootLocations).where(eq(shootLocations.id, id)).limit(1);
  return row ?? null;
}

export async function findLocationsByShootId(
  shootId: string,
  tx: DbClient = defaultDb,
): Promise<ShootLocation[]> {
  return await tx
    .select()
    .from(shootLocations)
    .where(eq(shootLocations.shootId, shootId))
    .orderBy(asc(shootLocations.order));
}

export async function insertShootLocation(
  data: NewShootLocation,
  tx: DbClient = defaultDb,
): Promise<ShootLocation> {
  const [row] = await tx.insert(shootLocations).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert shoot location');
  }
  return row;
}

export async function updateShootLocationRecord(
  id: string,
  data: Partial<NewShootLocation>,
  tx: DbClient = defaultDb,
): Promise<ShootLocation | null> {
  const [row] = await tx
    .update(shootLocations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(shootLocations.id, id))
    .returning();
  return row ?? null;
}

export async function deleteShootLocationRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const res = await tx
    .delete(shootLocations)
    .where(eq(shootLocations.id, id))
    .returning({ id: shootLocations.id });
  return res.length > 0;
}

// --- Shoot Timeline Items Repo ---

export async function findShootTimelineItemById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<ShootTimelineItem | null> {
  const [row] = await tx
    .select()
    .from(shootTimelineItems)
    .where(eq(shootTimelineItems.id, id))
    .limit(1);
  return row ?? null;
}

export async function findTimelineItemsByShootId(
  shootId: string,
  tx: DbClient = defaultDb,
): Promise<ShootTimelineItem[]> {
  return await tx
    .select()
    .from(shootTimelineItems)
    .where(eq(shootTimelineItems.shootId, shootId))
    .orderBy(asc(shootTimelineItems.order), asc(shootTimelineItems.startsAt));
}

export async function insertShootTimelineItem(
  data: NewShootTimelineItem,
  tx: DbClient = defaultDb,
): Promise<ShootTimelineItem> {
  const [row] = await tx.insert(shootTimelineItems).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert shoot timeline item');
  }
  return row;
}

export async function updateShootTimelineItemRecord(
  id: string,
  data: Partial<NewShootTimelineItem>,
  tx: DbClient = defaultDb,
): Promise<ShootTimelineItem | null> {
  const [row] = await tx
    .update(shootTimelineItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(shootTimelineItems.id, id))
    .returning();
  return row ?? null;
}

export async function deleteShootTimelineItemRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const res = await tx
    .delete(shootTimelineItems)
    .where(eq(shootTimelineItems.id, id))
    .returning({ id: shootTimelineItems.id });
  return res.length > 0;
}

// --- Project Participants Repo ---

export async function findProjectParticipantById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<ProjectParticipant | null> {
  const [row] = await tx
    .select()
    .from(projectParticipants)
    .where(eq(projectParticipants.id, id))
    .limit(1);
  return row ?? null;
}

export async function findParticipantsByProjectId(
  projectId: string,
  tx: DbClient = defaultDb,
): Promise<ProjectParticipant[]> {
  return await tx
    .select()
    .from(projectParticipants)
    .where(eq(projectParticipants.projectId, projectId))
    .orderBy(asc(projectParticipants.createdAt));
}

export async function insertProjectParticipant(
  data: NewProjectParticipant,
  tx: DbClient = defaultDb,
): Promise<ProjectParticipant> {
  const [row] = await tx.insert(projectParticipants).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert project participant');
  }
  return row;
}

export async function deleteProjectParticipantRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const res = await tx
    .delete(projectParticipants)
    .where(eq(projectParticipants.id, id))
    .returning({ id: projectParticipants.id });
  return res.length > 0;
}

// --- Project Tasks Repo ---

export async function findProjectTaskById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<ProjectTask | null> {
  const [row] = await tx.select().from(projectTasks).where(eq(projectTasks.id, id)).limit(1);
  return row ?? null;
}

export async function findTasksByProjectId(
  projectId: string,
  tx: DbClient = defaultDb,
): Promise<ProjectTask[]> {
  return await tx
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.projectId, projectId))
    .orderBy(asc(projectTasks.order), asc(projectTasks.createdAt));
}

export async function findIncompleteTasksByStage(
  projectId: string,
  stageId: string,
  tx: DbClient = defaultDb,
): Promise<ProjectTask[]> {
  return await tx
    .select()
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.stageId, stageId),
        eq(projectTasks.isCompleted, false),
      ),
    )
    .orderBy(asc(projectTasks.order));
}

export async function insertProjectTask(
  data: NewProjectTask,
  tx: DbClient = defaultDb,
): Promise<ProjectTask> {
  const [row] = await tx.insert(projectTasks).values(data).returning();
  if (!row) {
    throw new Error('Failed to insert project task');
  }
  return row;
}

export async function updateProjectTaskRecord(
  id: string,
  data: Partial<NewProjectTask>,
  tx: DbClient = defaultDb,
): Promise<ProjectTask | null> {
  const [row] = await tx
    .update(projectTasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projectTasks.id, id))
    .returning();
  return row ?? null;
}

export async function deleteProjectTaskRecord(
  id: string,
  tx: DbClient = defaultDb,
): Promise<boolean> {
  const res = await tx
    .delete(projectTasks)
    .where(eq(projectTasks.id, id))
    .returning({ id: projectTasks.id });
  return res.length > 0;
}

export interface KanbanProjectRow {
  id: string;
  title: string;
  clientId: string;
  clientDisplayName: string;
  stageId: string;
  projectTypeKey: string;
  primaryShootStartsAt: Date | null;
  primaryShootTimezone: string | null;
  currency: string;
  priceMinor: number | null;
  createdAt: Date;
}

export async function findKanbanProjects(tx: DbClient = defaultDb): Promise<KanbanProjectRow[]> {
  const rows = await tx
    .select({
      id: projects.id,
      title: projects.title,
      clientId: projects.clientId,
      clientDisplayName: clients.displayName,
      stageId: projects.stageId,
      projectTypeKey: projects.projectTypeKey,
      primaryShootStartsAt: projects.primaryShootStartsAt,
      primaryShootTimezone: projects.primaryShootTimezone,
      currency: projects.currency,
      priceMinor: projects.priceMinor,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .orderBy(asc(projects.createdAt));

  return rows;
}

export async function findAllProjectTasks(tx: DbClient = defaultDb): Promise<
  {
    id: string;
    projectId: string;
    stageId: string | null;
    title: string;
    isCompleted: boolean;
    order: number;
  }[]
> {
  return await tx
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      stageId: projectTasks.stageId,
      title: projectTasks.title,
      isCompleted: projectTasks.isCompleted,
      order: projectTasks.order,
    })
    .from(projectTasks)
    .orderBy(asc(projectTasks.order));
}

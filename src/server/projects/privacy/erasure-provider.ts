import 'server-only';
import { eq, inArray, count } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  projects,
  shoots,
  shootLocations,
  shootTimelineItems,
  projectParticipants,
  projectTasks,
} from '@/server/db/schema/projects';
import type { ErasureProvider, ErasureSubject } from '@/server/privacy/erasure/types';

/**
 * Erasure provider for Epic E3 (projects, shoots, locations, timeline items, participants, tasks).
 * Enforces GDPR Art. 17 right to erasure.
 */
export const projectsErasureProvider: ErasureProvider = {
  id: 'projects',
  category: 'projects',
  coveredTables: [
    'projects',
    'shoots',
    'shoot_locations',
    'shoot_timeline_items',
    'project_participants',
    'project_tasks',
  ] as const,
  subjectKinds: ['client', 'contact'] as const,

  plan: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind === 'lead') {
      return 0;
    }

    if (subject.kind === 'contact') {
      const [res] = await tx
        .select({ count: count() })
        .from(projectParticipants)
        .where(eq(projectParticipants.contactId, subject.contactId));
      return res?.count ?? 0;
    }

    // Client subject: count projects
    const [res] = await tx
      .select({ count: count() })
      .from(projects)
      .where(eq(projects.clientId, subject.clientId));

    return res?.count ?? 0;
  },

  erase: async (subject: ErasureSubject, tx: DbClient): Promise<number> => {
    if (subject.kind === 'lead') {
      return 0;
    }

    if (subject.kind === 'contact') {
      // Fetch all project participants associated with this contact
      const participants = await tx
        .select({
          id: projectParticipants.id,
          name: projectParticipants.name,
        })
        .from(projectParticipants)
        .where(eq(projectParticipants.contactId, subject.contactId));

      let modifiedCount = 0;

      for (const p of participants) {
        const hasRetainedName = typeof p.name === 'string' && p.name.trim().length > 0;
        if (hasRetainedName) {
          // Nullify contact reference while retaining non-personal vendor/participant name
          await tx
            .update(projectParticipants)
            .set({ contactId: null, updatedAt: new Date() })
            .where(eq(projectParticipants.id, p.id));
          modifiedCount++;
        } else {
          // Check constraint requires contact_id or name; delete participant if no name retained
          await tx.delete(projectParticipants).where(eq(projectParticipants.id, p.id));
          modifiedCount++;
        }
      }

      return modifiedCount;
    }

    // Client subject: cascading erasure of all client's projects and child entities
    const clientProjects = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.clientId, subject.clientId));

    if (clientProjects.length === 0) {
      return 0;
    }

    const projectIds = clientProjects.map((p) => p.id);

    // 1. Delete project tasks
    await tx.delete(projectTasks).where(inArray(projectTasks.projectId, projectIds));

    // 2. Delete shoot timeline items and locations for all shoots in these projects
    const clientShoots = await tx
      .select({ id: shoots.id })
      .from(shoots)
      .where(inArray(shoots.projectId, projectIds));

    if (clientShoots.length > 0) {
      const shootIds = clientShoots.map((s) => s.id);

      await tx.delete(shootTimelineItems).where(inArray(shootTimelineItems.shootId, shootIds));

      await tx.delete(shootLocations).where(inArray(shootLocations.shootId, shootIds));

      await tx.delete(shoots).where(inArray(shoots.projectId, projectIds));
    }

    // 3. Delete project participants
    await tx.delete(projectParticipants).where(inArray(projectParticipants.projectId, projectIds));

    // 4. Delete projects
    const deletedProjects = await tx
      .delete(projects)
      .where(eq(projects.clientId, subject.clientId))
      .returning({ id: projects.id });

    return deletedProjects.length;
  },
};

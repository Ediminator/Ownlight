import 'server-only';
import { eq, inArray, gte, desc, and } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import type {
  ErasureHoldProvider,
  ErasureSubject,
  ErasureHold,
} from '@/server/privacy/erasure/types';

/**
 * Erasure hold provider for active projects and upcoming shoots (ADR-0016 §5.4).
 * Enforces GDPR Art. 17(3)(b) retention exception:
 * - Active projects (inquiry, booked, in_progress, review) represent active contract performance
 * - Upcoming scheduled shoots represent unfulfilled contractual commitments
 */
export const projectsHoldProvider: ErasureHoldProvider = {
  id: 'projects',

  holds: async (subject: ErasureSubject, tx: DbClient): Promise<ErasureHold[]> => {
    if (subject.kind !== 'client') {
      return [];
    }

    const clientId = subject.clientId;
    const now = new Date();

    // 1. Fetch all projects and their stage categories for this client
    const clientProjects = await tx
      .select({
        projectId: projects.id,
        stageCategory: pipelineStages.category,
      })
      .from(projects)
      .innerJoin(pipelineStages, eq(projects.stageId, pipelineStages.id))
      .where(eq(projects.clientId, clientId));

    if (clientProjects.length === 0) {
      return [];
    }

    const holds: ErasureHold[] = [];

    // 2. Active project hold: any project with stage category NOT IN ('archived', 'completed')
    const hasActiveProject = clientProjects.some(
      (cp) => cp.stageCategory !== 'archived' && cp.stageCategory !== 'completed',
    );

    if (hasActiveProject) {
      holds.push({
        reason: 'active_project',
        retainUntil: null,
      });
    }

    // 3. Upcoming shoot hold: any shoot scheduled in the future (starts_at >= now)
    const projectIds = clientProjects.map((p) => p.projectId);
    const upcomingShoots = await tx
      .select({
        startsAt: shoots.startsAt,
      })
      .from(shoots)
      .where(and(inArray(shoots.projectId, projectIds), gte(shoots.startsAt, now)))
      .orderBy(desc(shoots.startsAt));

    const firstUpcomingShoot = upcomingShoots[0];
    if (firstUpcomingShoot) {
      const latestUpcomingShootStartsAt = firstUpcomingShoot.startsAt;
      holds.push({
        reason: 'upcoming_shoot',
        retainUntil: latestUpcomingShootStartsAt.toISOString(),
      });
    }

    return holds;
  },
};

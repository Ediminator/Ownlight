import { inArray, gte, or, and, eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { projects, shoots, pipelineStages } from '@/server/db/schema/projects';
import type { ActivityProvider } from '@/server/clients/activity';

/**
 * Retention sweep activity provider for projects and shoots (AC-5 / ADR-0016 §5.4).
 * Identifies clients that have ongoing contracts, recent project updates, or future shoots,
 * preventing automated retention sweeps from marking them inactive or purging them.
 */
export const projectsActivityProvider: ActivityProvider = {
  id: 'projects',

  activeClientIds: async (
    tx: DbClient,
    since: Date,
    candidateIds: readonly string[],
  ): Promise<string[]> => {
    if (candidateIds.length === 0) {
      return [];
    }

    const activeIds = new Set<string>();
    const now = new Date();
    const candidateList = [...candidateIds];

    // 1. Projects in active stage categories ('inquiry', 'booked', 'in_progress', 'review')
    const activeStageRows = await tx
      .selectDistinct({ clientId: projects.clientId })
      .from(projects)
      .innerJoin(pipelineStages, eq(projects.stageId, pipelineStages.id))
      .where(
        and(
          inArray(projects.clientId, candidateList),
          inArray(pipelineStages.category, ['inquiry', 'booked', 'in_progress', 'review']),
        ),
      );

    for (const row of activeStageRows) {
      activeIds.add(row.clientId);
    }

    // 2. Projects with recent activity (last_activity_at >= since)
    const recentProjectRows = await tx
      .selectDistinct({ clientId: projects.clientId })
      .from(projects)
      .where(and(inArray(projects.clientId, candidateList), gte(projects.lastActivityAt, since)));

    for (const row of recentProjectRows) {
      activeIds.add(row.clientId);
    }

    // 3. Shoots that are recent or upcoming (starts_at >= since OR starts_at >= now)
    const shootRows = await tx
      .selectDistinct({ clientId: projects.clientId })
      .from(shoots)
      .innerJoin(projects, eq(shoots.projectId, projects.id))
      .where(
        and(
          inArray(projects.clientId, candidateList),
          or(gte(shoots.startsAt, since), gte(shoots.startsAt, now)),
        ),
      );

    for (const row of shootRows) {
      activeIds.add(row.clientId);
    }

    return [...activeIds];
  },
};

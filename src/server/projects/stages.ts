import { eq, asc } from 'drizzle-orm';
import { type DbClient, db as defaultDb } from '@/server/db/client';
import {
  pipelineStages,
  stageTaskTemplates,
  type PipelineStage,
  type StageTaskTemplate,
} from '@/server/db/schema/projects';

/**
 * Stage state machine and query helpers (TASK-0033 / ADR-0016 §2).
 */

/**
 * Retrieves all pipeline stages in deterministic order (position ASC).
 */
export async function getPipelineStages(tx: DbClient = defaultDb): Promise<PipelineStage[]> {
  return await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
}

/**
 * Retrieves a single pipeline stage by its unique UUID.
 */
export async function getPipelineStageById(
  id: string,
  tx: DbClient = defaultDb,
): Promise<PipelineStage | null> {
  const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);

  return stage ?? null;
}

/**
 * Retrieves a single pipeline stage by its unique key (e.g. 'inquiry', 'booked').
 */
export async function getPipelineStageByKey(
  key: string,
  tx: DbClient = defaultDb,
): Promise<PipelineStage | null> {
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.key, key))
    .limit(1);

  return stage ?? null;
}

/**
 * Retrieves the initial pipeline stage (position 1, typically 'inquiry').
 */
export async function getInitialPipelineStage(
  tx: DbClient = defaultDb,
): Promise<PipelineStage | null> {
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .orderBy(asc(pipelineStages.position))
    .limit(1);

  return stage ?? null;
}

/**
 * Retrieves default checklist task templates for a stage ordered by order ASC.
 */
export async function getStageTaskTemplates(
  stageId: string,
  tx: DbClient = defaultDb,
): Promise<StageTaskTemplate[]> {
  return await tx
    .select()
    .from(stageTaskTemplates)
    .where(eq(stageTaskTemplates.stageId, stageId))
    .orderBy(asc(stageTaskTemplates.order));
}

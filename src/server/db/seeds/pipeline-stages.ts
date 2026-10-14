import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import {
  pipelineStages,
  stageTaskTemplates,
  type PipelineStage,
  type PipelineStageCategory,
} from '@/server/db/schema/projects';

export interface DefaultStageSeedDefinition {
  id: string;
  key: string;
  name: string;
  position: number;
  category: PipelineStageCategory;
  color: string;
  isSystem: boolean;
}

export const DEFAULT_PIPELINE_STAGES: readonly DefaultStageSeedDefinition[] = [
  {
    id: '01920000-0000-7000-8000-000000000001',
    key: 'inquiry',
    name: 'Inquiry',
    position: 1,
    category: 'inquiry',
    color: 'slate',
    isSystem: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000002',
    key: 'booked',
    name: 'Booked',
    position: 2,
    category: 'booked',
    color: 'blue',
    isSystem: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000003',
    key: 'shot',
    name: 'Shot',
    position: 3,
    category: 'in_progress',
    color: 'amber',
    isSystem: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000004',
    key: 'editing',
    name: 'Editing',
    position: 4,
    category: 'review',
    color: 'purple',
    isSystem: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000005',
    key: 'delivered',
    name: 'Delivered',
    position: 5,
    category: 'completed',
    color: 'emerald',
    isSystem: true,
  },
  {
    id: '01920000-0000-7000-8000-000000000006',
    key: 'archived',
    name: 'Archived',
    position: 6,
    category: 'archived',
    color: 'zinc',
    isSystem: true,
  },
] as const;

export interface DefaultStageTaskTemplateDefinition {
  id: string;
  stageKey: string;
  title: string;
  order: number;
}

export const DEFAULT_STAGE_TASK_TEMPLATES: readonly DefaultStageTaskTemplateDefinition[] = [
  {
    id: '01920000-0000-7000-8000-000000000011',
    stageKey: 'inquiry',
    title: 'Send pricing guide',
    order: 1,
  },
  {
    id: '01920000-0000-7000-8000-000000000012',
    stageKey: 'booked',
    title: 'Countersign contract',
    order: 1,
  },
  {
    id: '01920000-0000-7000-8000-000000000013',
    stageKey: 'shot',
    title: 'Ingest RAW cards & create 3-2-1 backup',
    order: 1,
  },
  {
    id: '01920000-0000-7000-8000-000000000014',
    stageKey: 'editing',
    title: 'Cull photos',
    order: 1,
  },
  {
    id: '01920000-0000-7000-8000-000000000015',
    stageKey: 'delivered',
    title: 'Deliver online gallery',
    order: 1,
  },
  {
    id: '01920000-0000-7000-8000-000000000016',
    stageKey: 'archived',
    title: 'Archive raw files to cold storage',
    order: 1,
  },
] as const;

/**
 * Seeds or verifies the 6 system default pipeline stages and their default task templates.
 * Safe to execute multiple times (idempotent).
 */
export async function seedDefaultPipelineStages(db: DbClient): Promise<PipelineStage[]> {
  const seededStages: PipelineStage[] = [];

  for (const def of DEFAULT_PIPELINE_STAGES) {
    const existing = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, def.key))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      seededStages.push(existing[0]);
    } else {
      const [inserted] = await db
        .insert(pipelineStages)
        .values({
          id: def.id,
          key: def.key,
          name: def.name,
          position: def.position,
          category: def.category,
          color: def.color,
          isSystem: def.isSystem,
        })
        .returning();

      if (inserted) {
        seededStages.push(inserted);
      }
    }
  }

  // Seed default stage task templates
  const stageMap = new Map<string, string>();
  for (const s of seededStages) {
    stageMap.set(s.key, s.id);
  }

  for (const tmpl of DEFAULT_STAGE_TASK_TEMPLATES) {
    const stageId = stageMap.get(tmpl.stageKey);
    if (!stageId) continue;

    await db
      .insert(stageTaskTemplates)
      .values({
        id: tmpl.id,
        stageId,
        title: tmpl.title,
        order: tmpl.order,
      })
      .onConflictDoNothing({ target: stageTaskTemplates.id });
  }

  // Return deterministically sorted by position ASC
  return seededStages.sort((a, b) => a.position - b.position);
}

import { db as defaultDb, type DbClient } from '@/server/db/client';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedPackagesAndCatalogue, type SeedResult } from '@/server/db/seeds/packages';

export { seedPackagesAndCatalogue, seedDefaultPipelineStages, seedDefaultCalendarData };

/**
 * Master synthetic seed script (TASK-0056).
 * Seeds pipeline stages, calendar defaults, photography packages, and catalogue add-ons.
 */
export async function seedAll(tx: DbClient = defaultDb): Promise<{
  packagesResult: SeedResult;
}> {
  await seedDefaultPipelineStages(tx);
  await seedDefaultCalendarData(tx);
  const packagesResult = await seedPackagesAndCatalogue(tx);
  return { packagesResult };
}

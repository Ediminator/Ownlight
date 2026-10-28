import { db as defaultDb, type DbClient } from '@/server/db/client';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedPackagesAndCatalogue, type SeedResult } from '@/server/db/seeds/packages';
import { seedProposals, type SeedProposalsResult } from '@/server/db/seeds/proposals';

export {
  seedPackagesAndCatalogue,
  seedDefaultPipelineStages,
  seedDefaultCalendarData,
  seedProposals,
};

/**
 * Master synthetic seed script (TASK-0056 / TASK-0058).
 * Seeds pipeline stages, calendar defaults, photography packages, catalogue add-ons, and sample proposals.
 */
export async function seedAll(tx: DbClient = defaultDb): Promise<{
  packagesResult: SeedResult;
  proposalsResult: SeedProposalsResult;
}> {
  await seedDefaultPipelineStages(tx);
  await seedDefaultCalendarData(tx);
  const packagesResult = await seedPackagesAndCatalogue(tx);
  const proposalsResult = await seedProposals(tx);
  return { packagesResult, proposalsResult };
}

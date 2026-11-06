import { db as defaultDb, type DbClient } from '@/server/db/client';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { seedDefaultCalendarData } from '@/server/db/seeds/calendar';
import { seedPackagesAndCatalogue, type SeedResult } from '@/server/db/seeds/packages';
import { seedProposals, type SeedProposalsResult } from '@/server/db/seeds/proposals';
import { seedContracts, type SeedContractTemplatesResult } from '@/server/db/seeds/contracts';

export {
  seedPackagesAndCatalogue,
  seedDefaultPipelineStages,
  seedDefaultCalendarData,
  seedProposals,
  seedContracts,
};

/**
 * Master synthetic seed script (TASK-0056 / TASK-0058 / TASK-0064).
 * Seeds pipeline stages, calendar defaults, photography packages, catalogue add-ons, sample proposals, and contract templates.
 */
export async function seedAll(tx: DbClient = defaultDb): Promise<{
  packagesResult: SeedResult;
  proposalsResult: SeedProposalsResult;
  contractsResult: SeedContractTemplatesResult;
}> {
  await seedDefaultPipelineStages(tx);
  await seedDefaultCalendarData(tx);
  const packagesResult = await seedPackagesAndCatalogue(tx);
  const proposalsResult = await seedProposals(tx);
  const contractsResult = await seedContracts(tx);
  return { packagesResult, proposalsResult, contractsResult };
}

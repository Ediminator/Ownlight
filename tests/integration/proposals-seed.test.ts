import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { seedProposals } from '@/server/db/seeds/proposals';
import { seedAll } from '@/server/db/seed';

describe('TASK-0058: Proposals Synthetic Seed Integration', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: seedProposals idempotently seeds draft, sent, and accepted proposals', async () => {
    const result = await seedProposals(dbClient);

    expect(result.seededProposals).toBe(3);
    expect(result.seededLineItems).toBeGreaterThanOrEqual(5);

    const allProposals = await dbClient.select().from(proposals);
    expect(allProposals).toHaveLength(3);

    const draft = allProposals.find((p) => p.status === 'draft');
    expect(draft).toBeDefined();
    expect(draft?.title).toContain('Draft');

    const sent = allProposals.find((p) => p.status === 'sent');
    expect(sent).toBeDefined();
    expect(sent?.sentAt).toBeInstanceOf(Date);

    const accepted = allProposals.find((p) => p.status === 'accepted');
    expect(accepted).toBeDefined();
    expect(accepted?.acceptedAt).toBeInstanceOf(Date);
    expect(accepted?.acceptedByName).toBe('Emma Watson');
    expect(accepted?.acceptedOptionsSnapshot).toBeDefined();
    expect(accepted?.acceptedOptionsSnapshot?.items).toHaveLength(1);

    const allLineItems = await dbClient.select().from(proposalLineItems);
    expect(allLineItems.length).toBeGreaterThanOrEqual(5);

    // Idempotency check: running a second time should not duplicate or throw
    const secondResult = await seedProposals(dbClient);
    expect(secondResult.seededProposals).toBe(3);

    const proposalsAfterSecond = await dbClient.select().from(proposals);
    expect(proposalsAfterSecond).toHaveLength(3);
  });

  it('AC-1: seedAll executes complete seed suite including proposals', async () => {
    const { packagesResult, proposalsResult } = await seedAll(dbClient);

    expect(packagesResult.seededPackages).toBeGreaterThanOrEqual(3);
    expect(proposalsResult.seededProposals).toBe(3);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { contractTemplates } from '@/server/db/schema/contracts';
import {
  seedContracts,
  SEED_TEMPLATE_WEDDING_ID,
  SEED_TEMPLATE_PORTRAIT_ID,
  SEED_TEMPLATE_COMMERCIAL_ID,
} from '@/server/db/seeds/contracts';
import { seedAll } from '@/server/db/seed';
import { eq } from 'drizzle-orm';

describe('Contracts Seed Integration Tests (TASK-0064)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('seedContracts inserts the 3 representative contract templates into database', async () => {
    const result = await seedContracts(dbClient);
    expect(result.seededTemplates).toBe(3);

    const rows = await dbClient.select().from(contractTemplates);
    expect(rows).toHaveLength(3);

    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain('wedding-photography-agreement');
    expect(slugs).toContain('portrait-session-terms');
    expect(slugs).toContain('commercial-licensing-agreement');

    // Verify wedding template details
    const [wedding] = await dbClient
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, SEED_TEMPLATE_WEDDING_ID))
      .limit(1);

    expect(wedding).toBeDefined();
    expect(wedding?.name).toBe('Wedding Photography Agreement');
    expect(wedding?.projectTypeKey).toBe('wedding');
    expect(wedding?.isDefault).toBe(true);
    expect(wedding?.contentEn).toContain('{{client.name}}');
    expect(wedding?.contentEn).toContain('{{studio.name}}');
    expect(wedding?.contentDe).toContain('{{client.name}}');
    expect(wedding?.contentDe).toContain('{{studio.name}}');

    // Verify portrait template details
    const [portrait] = await dbClient
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, SEED_TEMPLATE_PORTRAIT_ID))
      .limit(1);

    expect(portrait).toBeDefined();
    expect(portrait?.projectTypeKey).toBe('portrait');

    // Verify commercial template details
    const [commercial] = await dbClient
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, SEED_TEMPLATE_COMMERCIAL_ID))
      .limit(1);

    expect(commercial).toBeDefined();
    expect(commercial?.projectTypeKey).toBe('commercial');
  });

  it('seedContracts is completely idempotent and safe to execute multiple times', async () => {
    const firstRun = await seedContracts(dbClient);
    expect(firstRun.seededTemplates).toBe(3);

    const secondRun = await seedContracts(dbClient);
    expect(secondRun.seededTemplates).toBe(0);

    const rows = await dbClient.select().from(contractTemplates);
    expect(rows).toHaveLength(3);
  });

  it('seedAll executes master seed script and includes contract templates result', async () => {
    const { packagesResult, proposalsResult, contractsResult } = await seedAll(dbClient);

    expect(contractsResult).toBeDefined();
    expect(contractsResult.seededTemplates).toBe(3);
    expect(packagesResult.seededPackages).toBeGreaterThan(0);
    expect(proposalsResult.seededProposals).toBeGreaterThan(0);

    const count = await dbClient.select().from(contractTemplates);
    expect(count).toHaveLength(3);
  });
});

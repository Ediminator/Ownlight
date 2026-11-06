import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { type AuthContext } from '@/server/auth/guards';
import { UnauthenticatedError } from '@/server/auth/repo-auth';
import { contracts, contractTemplates } from '@/server/db/schema/contracts';
import { clients } from '@/server/db/schema/clients';
import { pipelineStages, projects } from '@/server/db/schema/projects';
import { auditEvents } from '@/server/db/schema/audit';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import {
  listContractsForProject,
  getContractById,
  getContractByTokenHash,
  createContractDraft,
  updateContractDraft,
  voidContract,
  ContractNotFoundError,
  ContractForbiddenError,
  ContractImmutableError,
} from '@/server/contracts/repo';
import { seedDefaultPipelineStages } from '@/server/db/seeds/pipeline-stages';
import { eq, desc } from 'drizzle-orm';

describe('Contracts Repository Integration Tests (AC-5, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  const ownerAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.org',
      emailVerified: true,
      image: null,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  const clientAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000002',
      name: 'Client User',
      email: 'client@example.org',
      emailVerified: true,
      image: null,
      role: 'client',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  let testClientId: string;
  let otherClientId: string;
  let testProjectId: string;
  let testTemplateId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    await seedDefaultPipelineStages(dbClient);

    const now = new Date();

    // 1. Seed clients
    const [c1] = (await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Emma Watson',
        preferredLocale: 'en',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof clients.$inferSelect];
    testClientId = c1.id;

    const [c2] = (await dbClient
      .insert(clients)
      .values({
        kind: 'person',
        displayName: 'Other Client',
        preferredLocale: 'en',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof clients.$inferSelect];
    otherClientId = c2.id;

    // 2. Seed project
    const [stage] = await dbClient.select().from(pipelineStages).limit(1);
    if (!stage) throw new Error('Stage missing');

    const [p1] = (await dbClient
      .insert(projects)
      .values({
        clientId: testClientId,
        stageId: stage.id,
        title: 'Emma & Liam Wedding',
        projectTypeKey: 'wedding',
        currency: 'EUR',
        createdAt: now,
        updatedAt: now,
      })
      .returning()) as [typeof projects.$inferSelect];
    testProjectId = p1.id;

    // 3. Seed template
    const [tpl] = (await dbClient
      .insert(contractTemplates)
      .values({
        name: 'Wedding Template',
        slug: 'wedding-test-tpl',
        contentEn: '# Wedding Agreement\nClient: {{client.name}}',
        contentDe: '# Hochzeitsvertrag\nKunde: {{client.name}}',
        isDefault: true,
        isActive: true,
      })
      .returning()) as [typeof contractTemplates.$inferSelect];
    testTemplateId = tpl.id;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-5: createContractDraft creates a draft contract with sequential CTR-YYYY-NNNN number and emits contract.created audit event', async () => {
    const currentYear = new Date().getFullYear();
    const result = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        templateId: testTemplateId,
        title: 'Wedding Photography Agreement — Emma & Liam',
        locale: 'en',
        mergeValuesSnapshot: { 'client.name': 'Emma Watson' },
      },
      ownerAuth,
      dbClient,
    );

    expect(result.id).toBeDefined();
    expect(result.status).toBe('draft');
    expect(result.title).toBe('Wedding Photography Agreement — Emma & Liam');
    expect(result.contractNumber).toBe(`CTR-${String(currentYear)}-0001`);
    expect(result.locale).toBe('en');
    expect(result.renderedBody).toBe('# Wedding Agreement\nClient: {{client.name}}');
    expect(result.canonicalBodySha256).toMatch(/^[a-f0-9]{64}$/);

    // Raw signing token is returned
    expect(result.rawToken).toHaveLength(64);
    expect(result.tokenHash).toHaveLength(64);

    // Verify persisted in database
    const [persisted] = await dbClient
      .select()
      .from(contracts)
      .where(eq(contracts.id, result.id))
      .limit(1);

    expect(persisted).toBeDefined();
    expect(persisted?.contractNumber).toBe(`CTR-${String(currentYear)}-0001`);

    // Verify contract.created audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract.created'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('contract');
    expect(auditLog?.targetId).toBe(result.id);
    expect(auditLog?.metadata).toMatchObject({
      contract_id: result.id,
      project_id: testProjectId,
      client_id: testClientId,
      contract_number: `CTR-${String(currentYear)}-0001`,
      status: 'draft',
      template_id: testTemplateId,
    });
  });

  it('AC-5: sequentially increments contract numbers for consecutive contracts', async () => {
    const currentYear = new Date().getFullYear();

    const c1 = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Contract 1',
      },
      ownerAuth,
      dbClient,
    );

    const c2 = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Contract 2',
      },
      ownerAuth,
      dbClient,
    );

    expect(c1.contractNumber).toBe(`CTR-${String(currentYear)}-0001`);
    expect(c2.contractNumber).toBe(`CTR-${String(currentYear)}-0002`);
  });

  it('AC-5: getContractByTokenHash retrieves contract via public token hash', async () => {
    const draft = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Public Viewable Contract',
      },
      ownerAuth,
      dbClient,
    );

    const fetched = await getContractByTokenHash(draft.tokenHash, dbClient);
    expect(fetched.id).toBe(draft.id);
    expect(fetched.title).toBe('Public Viewable Contract');
  });

  it('AC-5: updateContractDraft updates title and body while in draft and records contract.updated audit event', async () => {
    const draft = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Original Title',
        renderedBody: 'Original Body',
      },
      ownerAuth,
      dbClient,
    );

    const updated = await updateContractDraft(
      draft.id,
      {
        title: 'Updated Contract Title',
        renderedBody: 'Amended Contract Terms',
      },
      ownerAuth,
      dbClient,
    );

    expect(updated.title).toBe('Updated Contract Title');
    expect(updated.renderedBody).toBe('Amended Contract Terms');
    expect(updated.canonicalBodySha256).not.toBe(draft.canonicalBodySha256);

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract.updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(draft.id);
    const meta = auditLog?.metadata as { contract_id?: string; changed_fields?: string[] } | null;
    expect(meta?.contract_id).toBe(draft.id);
    expect(meta?.changed_fields).toContain('title');
    expect(meta?.changed_fields).toContain('renderedBody');
    expect(meta?.changed_fields).toContain('canonicalBodySha256');
  });

  it('AC-5: updateContractDraft throws ContractImmutableError when contract is not in draft status', async () => {
    const draft = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Will Be Voided',
      },
      ownerAuth,
      dbClient,
    );

    // Transition to voided
    await voidContract(draft.id, 'Cancelled by studio', ownerAuth, dbClient);

    // Attempting to edit must fail with ContractImmutableError
    await expect(
      updateContractDraft(
        draft.id,
        {
          title: 'Illegal Amendment',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractImmutableError);
  });

  it('AC-5: voidContract transitions status to voided, revokes signing token, records audit and timeline events', async () => {
    const draft = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Contract To Void',
      },
      ownerAuth,
      dbClient,
    );

    const voided = await voidContract(
      draft.id,
      'Client postponed indefinitely',
      ownerAuth,
      dbClient,
    );

    expect(voided.status).toBe('voided');
    expect(voided.tokenRevokedAt).toBeDefined();

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract.voided'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.metadata).toMatchObject({
      contract_id: draft.id,
      reason: 'Client postponed indefinitely',
    });

    // Verify timeline event
    const [timelineEvent] = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.type, 'contract.voided'))
      .orderBy(desc(clientTimelineEvents.occurredAt))
      .limit(1);

    expect(timelineEvent).toBeDefined();
    expect(timelineEvent?.clientId).toBe(testClientId);
    expect(timelineEvent?.data).toMatchObject({
      contract_id: draft.id,
      contract_number: draft.contractNumber,
    });
  });

  it('AC-5: listContractsForProject returns all contracts for a project ordered by createdAt desc', async () => {
    await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Project Contract A',
      },
      ownerAuth,
      dbClient,
    );

    await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Project Contract B',
      },
      ownerAuth,
      dbClient,
    );

    const list = await listContractsForProject(testProjectId, ownerAuth, dbClient);
    expect(list).toHaveLength(2);
    expect(list[0]?.title).toBe('Project Contract B');
  });

  it('AC-7: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    await expect(
      createContractDraft(
        {
          projectId: testProjectId,
          clientId: testClientId,
          title: 'Unauth Contract',
        },
        clientAuth,
        dbClient,
      ),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
      updateContractDraft(
        '01920000-0000-7000-8000-000000000099',
        { title: 'X' },
        clientAuth,
        dbClient,
      ),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
      voidContract('01920000-0000-7000-8000-000000000099', null, clientAuth, dbClient),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(listContractsForProject(testProjectId, clientAuth, dbClient)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('AC-8: rejects contract creation when project does not belong to specified clientId (FORBIDDEN)', async () => {
    await expect(
      createContractDraft(
        {
          projectId: testProjectId,
          clientId: otherClientId, // mismatched client ID
          title: 'Mismatched Ownership Contract',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractForbiddenError);
  });

  it('AC-8: throws ContractNotFoundError for non-existent project or contract IDs', async () => {
    await expect(
      createContractDraft(
        {
          projectId: '01920000-0000-7000-8000-000000000099',
          clientId: testClientId,
          title: 'Non-existent Project Contract',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractForbiddenError);

    await expect(
      getContractById('01920000-0000-7000-8000-000000000099', ownerAuth, dbClient),
    ).rejects.toThrow(ContractNotFoundError);

    await expect(
      getContractByTokenHash(
        'non-existent-token-hash-64-characters-long-000000000000000000000000',
        dbClient,
      ),
    ).rejects.toThrow(ContractNotFoundError);
  });

  it('AC-5: creates contract draft in German locale using German template content and populates proposalId', async () => {
    // 1. Create a proposal to link
    const { createProposal } = await import('@/server/proposals/repo');
    const prop = await createProposal(
      {
        projectId: testProjectId,
        clientId: testClientId,
        title: 'Wedding Package Proposal',
      },
      ownerAuth,
      dbClient,
    );

    // 2. Create German contract draft referencing template and proposal
    const germanDraft = await createContractDraft(
      {
        projectId: testProjectId,
        clientId: testClientId,
        templateId: testTemplateId,
        proposalId: prop.id,
        title: 'Hochzeitsfotografie Vertrag',
        locale: 'de',
        validUntil: new Date('2026-12-31T23:59:59Z'),
        internalNotes: 'VIP Client',
      },
      ownerAuth,
      dbClient,
    );

    expect(germanDraft.locale).toBe('de');
    expect(germanDraft.renderedBody).toBe('# Hochzeitsvertrag\nKunde: {{client.name}}');
    expect(germanDraft.proposalId).toBe(prop.id);
    expect(germanDraft.internalNotes).toBe('VIP Client');

    // 3. Update contract draft with various fields
    const updated = await updateContractDraft(
      germanDraft.id,
      {
        locale: 'en',
        templateId: null,
        proposalId: null,
        validUntil: null,
        internalNotes: 'Updated notes',
        mergeValuesSnapshot: { 'client.name': 'Emma Watson' },
      },
      ownerAuth,
      dbClient,
    );

    expect(updated.locale).toBe('en');
    expect(updated.internalNotes).toBe('Updated notes');
    expect(updated.proposalId).toBeNull();

    // 4. Test error paths for invalid templateId or proposalId
    await expect(
      createContractDraft(
        {
          projectId: testProjectId,
          clientId: testClientId,
          templateId: '01920000-0000-7000-8000-000000000099',
          title: 'Invalid Template Contract',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractNotFoundError);

    await expect(
      createContractDraft(
        {
          projectId: testProjectId,
          clientId: testClientId,
          proposalId: '01920000-0000-7000-8000-000000000099',
          title: 'Invalid Proposal Contract',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractNotFoundError);

    // 5. Update non-existent contract throws
    await expect(
      updateContractDraft(
        '01920000-0000-7000-8000-000000000099',
        { title: 'X' },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractNotFoundError);

    // 6. Calling voidContract on an already voided contract returns existing contract
    const voided1 = await voidContract(germanDraft.id, 'First void', ownerAuth, dbClient);
    const voided2 = await voidContract(germanDraft.id, 'Second void', ownerAuth, dbClient);
    expect(voided2.id).toBe(voided1.id);
    expect(voided2.status).toBe('voided');
  });
});

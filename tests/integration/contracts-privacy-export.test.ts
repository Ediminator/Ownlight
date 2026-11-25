import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { exportClientDataAction } from '@/server/privacy/export/actions';
import { eraseClientDataAction } from '@/server/privacy/erasure/actions';
import { checkErasureHolds } from '@/server/privacy/erasure/service';
import { runRetentionSweep } from '@/server/retention/sweep';
import { resetExportProviders } from '@/server/privacy/export/registry';
import {
  resetErasureHoldProviders,
  resetErasureProviders,
} from '@/server/privacy/erasure/registry';
import { resetActivityProviders } from '@/server/clients/activity';
import { resetPolicies } from '@/server/retention/policy';
import { dsarExportSchema } from '@/server/privacy/export/schema';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { contracts } from '@/server/db/schema/contracts';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';

describe('TASK-0066: Contracts DSAR Export, GDPR Erasure, Statutory Hold & Retention Integration (AC-1 to AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  const ownerUserId = '01910000-0000-7000-8000-000000000001';
  let sessionToken: string;
  let inquiryStageId: string;
  let archivedStageId: string;

  beforeEach(async () => {
    resetExportProviders();
    resetErasureProviders();
    resetErasureHoldProviders();
    resetActivityProviders();
    resetPolicies();

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Studio Owner',
      email: 'owner@example.org',
      emailVerified: true,
      role: 'owner',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    const sessionRes = await createSession(ownerUserId, dbClient);
    sessionToken = sessionRes.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    await dbClient.insert(studioSettings).values({
      studio_name: 'Ownlight Contracts Studio',
      currency: 'EUR',
      default_locale: 'en',
      timezone: 'UTC',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    const stages = await dbClient.select().from(pipelineStages);
    inquiryStageId = stages.find((s) => s.category === 'inquiry')?.id ?? stages[0]?.id ?? '';
    archivedStageId =
      stages.find((s) => s.category === 'archived')?.id ?? stages[0]?.id ?? inquiryStageId;
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetExportProviders();
    resetErasureProviders();
    resetErasureHoldProviders();
    resetActivityProviders();
    resetPolicies();
    await testDb.destroy();
  });

  it('AC-1, AC-2, AC-7: exportClientDataAction exports contracts in ownlight.dsar.v1 JSON and localized en/de HTML without token_hash', async () => {
    const clientId = '01910000-0000-7000-8000-000000000101';
    const contactId = '01910000-0000-7000-8000-000000000102';
    const projectId = '01910000-0000-7000-8000-000000000103';
    const contractId = '01910000-0000-7000-8000-000000000104';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Clara & Jonas',
      kind: 'person',
      preferredLocale: 'de',
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Clara',
      familyName: 'Meyer',
      email: 'clara@example.com',
      emailNormalized: 'clara@example.com',
      isPrimary: true,
    });
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: inquiryStageId,
      title: 'Wedding Clara & Jonas',
      projectTypeKey: 'wedding',
    });

    const canonicalSha = '1'.repeat(64);
    const pdfSha = '2'.repeat(64);
    const secretTokenHash = '9'.repeat(64);

    await dbClient.insert(contracts).values({
      id: contractId,
      projectId,
      clientId,
      contractNumber: 'CTR-2026-0042',
      title: 'Hochzeitsvertrag Clara & Jonas',
      locale: 'de',
      status: 'signed',
      renderedBody: 'Vertragstext',
      mergeValuesSnapshot: { client_name: 'Clara Meyer' },
      canonicalBodySha256: canonicalSha,
      validUntil: new Date('2026-07-01T23:59:59.000Z'),
      tokenHash: secretTokenHash,
      sentAt: new Date('2026-05-01T10:00:00.000Z'),
      clientSignedAt: new Date('2026-05-03T14:20:00.000Z'),
      clientSignerName: 'Clara Meyer',
      clientSignerEmail: 'clara@example.com',
      clientSignatureType: 'typed',
      clientSignatureData: 'Clara Meyer',
      clientIpAnonymized: '198.51.100.0/24',
      clientUserAgent: 'Mozilla/5.0',
      studioSignedAt: new Date('2026-05-03T14:20:00.000Z'),
      studioSignerName: 'Studio Owner',
      studioSignerTitle: 'Photographer',
      pdfStorageKey: 'contracts/2026/CTR-2026-0042.pdf',
      pdfSha256: pdfSha,
      internalNotes: 'Confidential studio discount note',
      createdAt: new Date('2026-04-28T09:00:00.000Z'),
    });

    // 1. JSON export for client subject
    const jsonRes = await exportClientDataAction(
      { clientId, format: 'json', locale: 'en' },
      dbClient,
    );
    expect(jsonRes.success).toBe(true);
    if (!jsonRes.success) throw new Error('Expected JSON export to succeed');

    expect(dsarExportSchema.safeParse(jsonRes.exportData).success).toBe(true);
    const contractItems = jsonRes.exportData.categories.contracts as Record<string, unknown>[];
    expect(contractItems).toHaveLength(1);

    const exported = contractItems[0];
    expect(exported).toBeDefined();
    expect(exported?.contract_number).toBe('CTR-2026-0042');
    expect(exported?.status).toBe('signed');
    expect(exported?.sent_at).toBe('2026-05-01T10:00:00.000Z');
    expect(exported?.signed_at).toBe('2026-05-03T14:20:00.000Z');
    expect(exported?.signer_name).toBe('Clara Meyer');
    expect(exported?.signer_email).toBe('clara@example.com');
    expect(exported?.signature_type).toBe('typed');
    expect(exported?.canonical_body_sha256).toBe(canonicalSha);
    expect(exported?.pdf_sha256).toBe(pdfSha);

    // AC-7: omit token_hash and private studio notes
    expect(exported?.token_hash).toBeUndefined();
    expect(exported?.tokenHash).toBeUndefined();
    expect(jsonRes.content).not.toContain(secretTokenHash);
    expect(jsonRes.content).not.toContain('Confidential studio discount note');

    // 2. HTML export in English & German
    const htmlEnRes = await exportClientDataAction(
      { clientId, format: 'html', locale: 'en' },
      dbClient,
    );
    expect(htmlEnRes.success).toBe(true);
    if (!htmlEnRes.success) throw new Error('Expected EN HTML export to succeed');
    expect(htmlEnRes.content).toContain('Contracts &amp; Signatures');
    expect(htmlEnRes.content).toContain('<th scope="col">Contract Number</th>');
    expect(htmlEnRes.content).toContain('CTR-2026-0042');

    const htmlDeRes = await exportClientDataAction(
      { clientId, format: 'html', locale: 'de' },
      dbClient,
    );
    expect(htmlDeRes.success).toBe(true);
    if (!htmlDeRes.success) throw new Error('Expected DE HTML export to succeed');
    expect(htmlDeRes.content).toContain('Verträge &amp; Signaturen');
    expect(htmlDeRes.content).toContain('<th scope="col">Vertragsnummer</th>');
    expect(htmlDeRes.content).toContain('<th scope="col">Unterzeichnet am</th>');
    expect(htmlDeRes.content).toContain('CTR-2026-0042');
    expect(htmlDeRes.content).not.toContain(secretTokenHash);
  });

  it('AC-3: eraseClientDataAction hard-deletes draft, declined, and voided contracts and reports count', async () => {
    const clientId = '01910000-0000-7000-8000-000000000201';
    const contactId = '01910000-0000-7000-8000-000000000202';
    const projectId = '01910000-0000-7000-8000-000000000203';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Unexecuted Contracts Client',
      kind: 'person',
      preferredLocale: 'en',
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Max',
      familyName: 'Muster',
      isPrimary: true,
    });
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: archivedStageId,
      title: 'Archived Shoot',
      projectTypeKey: 'portrait',
    });

    await dbClient.insert(contracts).values([
      {
        id: '01910000-0000-7000-8000-000000000211',
        projectId,
        clientId,
        contractNumber: 'CTR-2026-0101',
        title: 'Draft Contract',
        locale: 'en',
        status: 'draft',
        renderedBody: 'Draft body',
        mergeValuesSnapshot: {},
        canonicalBodySha256: 'd'.repeat(64),
        tokenHash: 'hash_draft_1',
      },
      {
        id: '01910000-0000-7000-8000-000000000212',
        projectId,
        clientId,
        contractNumber: 'CTR-2026-0102',
        title: 'Declined Contract',
        locale: 'en',
        status: 'declined',
        renderedBody: 'Declined body',
        mergeValuesSnapshot: {},
        canonicalBodySha256: 'e'.repeat(64),
        tokenHash: 'hash_declined_2',
      },
      {
        id: '01910000-0000-7000-8000-000000000213',
        projectId,
        clientId,
        contractNumber: 'CTR-2026-0103',
        title: 'Voided Contract',
        locale: 'en',
        status: 'voided',
        renderedBody: 'Voided body',
        mergeValuesSnapshot: {},
        canonicalBodySha256: 'f'.repeat(64),
        tokenHash: 'hash_voided_3',
      },
    ]);

    const res = await eraseClientDataAction(
      { clientId, confirmation: 'Unexecuted Contracts Client' },
      dbClient,
    );

    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected erasure to succeed');
    expect(res.categoryCounts.contracts).toBe(3);

    const remainingContracts = await dbClient
      .select()
      .from(contracts)
      .where(eq(contracts.clientId, clientId));
    expect(remainingContracts).toHaveLength(0);

    const remainingClients = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(remainingClients).toHaveLength(0);
  });

  it('AC-4: blocks erasure with statutory.commercial_contract hold when client has an active signed contract', async () => {
    const clientId = '01910000-0000-7000-8000-000000000301';
    const contactId = '01910000-0000-7000-8000-000000000302';
    const projectId = '01910000-0000-7000-8000-000000000303';
    const contractId = '01910000-0000-7000-8000-000000000304';

    const signedAt = new Date();
    const expectedRetainUntil = `${String(signedAt.getUTCFullYear() + 10)}-12-31T23:59:59.999Z`;

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Signed Contract Client',
      kind: 'person',
      preferredLocale: 'en',
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Elena',
      familyName: 'Vance',
      isPrimary: true,
    });
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: archivedStageId,
      title: 'Completed Wedding',
      projectTypeKey: 'wedding',
    });
    await dbClient.insert(contracts).values({
      id: contractId,
      projectId,
      clientId,
      contractNumber: 'CTR-2026-0201',
      title: 'Executed Agreement',
      locale: 'en',
      status: 'signed',
      renderedBody: 'Signed contract body',
      mergeValuesSnapshot: {},
      canonicalBodySha256: 'a'.repeat(64),
      tokenHash: 'hash_signed_active',
      clientSignedAt: signedAt,
      clientSignerName: 'Elena Vance',
      clientSignerEmail: 'elena@example.com',
      clientSignatureType: 'drawn',
    });

    const holds = await checkErasureHolds({ kind: 'client', clientId }, dbClient);
    const contractHold = holds.find((h) => h.reason === 'statutory.commercial_contract');
    expect(contractHold).toBeDefined();
    expect(contractHold?.retainUntil).toBe(expectedRetainUntil);

    const res = await eraseClientDataAction(
      { clientId, confirmation: 'Signed Contract Client' },
      dbClient,
    );

    expect(res.success).toBe(false);
    if (res.success || res.code !== 'ERASURE_BLOCKED') {
      throw new Error('Expected ERASURE_BLOCKED');
    }
    expect(res.holds.some((h) => h.reason === 'statutory.commercial_contract')).toBe(true);

    // Contract and client remain intact
    expect(
      await dbClient.select().from(contracts).where(eq(contracts.id, contractId)),
    ).toHaveLength(1);
    expect(await dbClient.select().from(clients).where(eq(clients.id, clientId))).toHaveLength(1);

    const blockedAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.blocked'));
    expect(blockedAudits.length).toBeGreaterThan(0);
  });

  it('AC-5: reports statutory hold as expired when signed contract is > 10 calendar years old and permits erasure', async () => {
    const clientId = '01910000-0000-7000-8000-000000000401';
    const contactId = '01910000-0000-7000-8000-000000000402';
    const projectId = '01910000-0000-7000-8000-000000000403';
    const contractId = '01910000-0000-7000-8000-000000000404';

    const oldSignedAt = new Date('2012-08-10T12:00:00.000Z'); // Locked until 2022-12-31 -> expired

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Expired Contract Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: oldSignedAt,
      lastActivityAt: oldSignedAt,
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Old',
      familyName: 'Client',
      isPrimary: true,
    });
    await dbClient.insert(projects).values({
      id: projectId,
      clientId,
      stageId: archivedStageId,
      title: '2012 Shoot',
      projectTypeKey: 'wedding',
    });
    await dbClient.insert(contracts).values({
      id: contractId,
      projectId,
      clientId,
      contractNumber: 'CTR-2012-0001',
      title: '2012 Executed Contract',
      locale: 'en',
      status: 'signed',
      renderedBody: 'Old body',
      mergeValuesSnapshot: {},
      canonicalBodySha256: 'b'.repeat(64),
      tokenHash: 'hash_signed_expired',
      clientSignedAt: oldSignedAt,
      clientSignerName: 'Old Client',
      clientSignerEmail: 'old@example.com',
      clientSignatureType: 'typed',
      createdAt: oldSignedAt,
      updatedAt: oldSignedAt,
    });

    const holds = await checkErasureHolds({ kind: 'client', clientId }, dbClient);
    expect(holds.filter((h) => h.reason === 'statutory.commercial_contract')).toHaveLength(0);

    const res = await eraseClientDataAction(
      { clientId, confirmation: 'Expired Contract Client' },
      dbClient,
    );
    expect(res.success).toBe(true);
    if (!res.success) throw new Error('Expected erasure of expired contract client to succeed');
    expect(res.categoryCounts.contracts).toBe(1);

    expect(
      await dbClient.select().from(contracts).where(eq(contracts.id, contractId)),
    ).toHaveLength(0);
    expect(await dbClient.select().from(clients).where(eq(clients.id, clientId))).toHaveLength(0);
  });

  it('AC-6: retention sweep preserves clients with contracts issued or signed within retention window', async () => {
    const activeClientId = '01910000-0000-7000-8000-000000000501';
    const staleClientId = '01910000-0000-7000-8000-000000000502';
    const activeProjId = '01910000-0000-7000-8000-000000000503';
    const staleProjId = '01910000-0000-7000-8000-000000000504';

    const now = new Date('2026-11-25T12:00:00.000Z');
    const fourYearsAgo = new Date('2022-10-01T12:00:00.000Z');
    const twoMonthsAgo = new Date('2026-09-25T12:00:00.000Z');

    await dbClient.insert(clients).values([
      {
        id: activeClientId,
        displayName: 'Active Contract Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: fourYearsAgo,
        lastActivityAt: fourYearsAgo,
      },
      {
        id: staleClientId,
        displayName: 'Stale Voided Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: fourYearsAgo,
        lastActivityAt: fourYearsAgo,
      },
    ]);

    await dbClient.insert(projects).values([
      {
        id: activeProjId,
        clientId: activeClientId,
        stageId: archivedStageId,
        title: 'Old Project Recent Contract',
        projectTypeKey: 'portrait',
        createdAt: fourYearsAgo,
        lastActivityAt: fourYearsAgo,
      },
      {
        id: staleProjId,
        clientId: staleClientId,
        stageId: archivedStageId,
        title: 'Old Project Old Voided Contract',
        projectTypeKey: 'portrait',
        createdAt: fourYearsAgo,
        lastActivityAt: fourYearsAgo,
      },
    ]);

    await dbClient.insert(contracts).values([
      {
        id: '01910000-0000-7000-8000-000000000511',
        projectId: activeProjId,
        clientId: activeClientId,
        contractNumber: 'CTR-2026-0501',
        title: 'Recent Signed Contract',
        locale: 'en',
        status: 'signed',
        renderedBody: 'Body',
        mergeValuesSnapshot: {},
        canonicalBodySha256: 'c'.repeat(64),
        tokenHash: 'hash_ret_active',
        sentAt: twoMonthsAgo,
        clientSignedAt: twoMonthsAgo,
        createdAt: twoMonthsAgo,
        updatedAt: twoMonthsAgo,
      },
      {
        id: '01910000-0000-7000-8000-000000000512',
        projectId: staleProjId,
        clientId: staleClientId,
        contractNumber: 'CTR-2022-0502',
        title: 'Old Voided Contract',
        locale: 'en',
        status: 'voided',
        renderedBody: 'Body',
        mergeValuesSnapshot: {},
        canonicalBodySha256: 'd'.repeat(64),
        tokenHash: 'hash_ret_stale',
        createdAt: fourYearsAgo,
        updatedAt: fourYearsAgo,
      },
    ]);

    const sweepRes = await runRetentionSweep({
      policyIds: ['inactive-clients'],
      client: dbClient,
      dryRun: false,
      now,
    });

    const policyRes = sweepRes.policies.find((p) => p.policyId === 'inactive-clients');
    expect(policyRes).toBeDefined();
    expect(policyRes?.erasableIds).not.toContain(activeClientId);
    expect(policyRes?.erasableIds).toContain(staleClientId);
    expect(policyRes?.deletedCount).toBe(1);

    // Active client remains, stale client deleted
    expect(
      await dbClient.select().from(clients).where(eq(clients.id, activeClientId)),
    ).toHaveLength(1);
    expect(await dbClient.select().from(clients).where(eq(clients.id, staleClientId))).toHaveLength(
      0,
    );
  });

  it('AC-8: rejects unauthenticated and non-owner callers with UNAUTHENTICATED or FORBIDDEN', async () => {
    // 1. Unauthenticated (no cookie)
    mockCookiesStore.clear();
    const unauthExport = await exportClientDataAction(
      { clientId: '01910000-0000-7000-8000-000000000900' },
      dbClient,
    );
    expect(unauthExport.success).toBe(false);
    expect((unauthExport as { code: string }).code).toBe('UNAUTHENTICATED');

    const unauthErase = await eraseClientDataAction(
      { clientId: '01910000-0000-7000-8000-000000000900', confirmation: 'Name' },
      dbClient,
    );
    expect(unauthErase.success).toBe(false);
    expect((unauthErase as { code: string }).code).toBe('UNAUTHENTICATED');

    // 2. Non-owner user -> FORBIDDEN
    const nonOwnerId = '01910000-0000-7000-8000-000000000999';
    await dbClient.insert(user).values({
      id: nonOwnerId,
      name: 'Client User',
      email: 'client-role@example.org',
      emailVerified: true,
      role: 'client',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const nonOwnerSession = await createSession(nonOwnerId, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, nonOwnerSession.token);

    const forbiddenExport = await exportClientDataAction(
      { clientId: '01910000-0000-7000-8000-000000000900' },
      dbClient,
    );
    expect(forbiddenExport.success).toBe(false);
    expect((forbiddenExport as { code: string }).code).toBe('FORBIDDEN');

    const forbiddenErase = await eraseClientDataAction(
      { clientId: '01910000-0000-7000-8000-000000000900', confirmation: 'Name' },
      dbClient,
    );
    expect(forbiddenErase.success).toBe(false);
    expect((forbiddenErase as { code: string }).code).toBe('FORBIDDEN');
  });
});

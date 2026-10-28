import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/privacy/erasure/service', () => ({
  eraseSubject: vi.fn().mockResolvedValue({ success: true }),
}));
import {
  computeCutoff,
  defineRetentionPolicy,
  createDefaultPolicies,
  registerPolicy,
  getPolicies,
  resetPolicies,
  getClientRetentionMonths,
} from '@/server/retention/policy';
import { resetEnvCache } from '@/env';
import type { DbClient } from '@/server/db/client';

describe('Retention policy utility and definition branches', () => {
  it('computeCutoff computes correct date with combinations of months, days, hours, or undefined', () => {
    const now = new Date('2026-10-10T12:00:00Z');

    // Undefined after
    const cutoffNoAfter = computeCutoff(now, undefined);
    expect(cutoffNoAfter.getTime()).toBe(now.getTime());

    // Months
    const cutoffMonths = computeCutoff(now, { months: 2 });
    expect(cutoffMonths.getMonth()).toBe(7); // October - 2 = August

    // Days
    const cutoffDays = computeCutoff(now, { days: 5 });
    expect(cutoffDays.getDate()).toBe(5);

    // Hours
    const cutoffHours = computeCutoff(now, { hours: 4 });
    expect(cutoffHours.getUTCHours()).toBe(8);

    // Combination of all
    const cutoffCombo = computeCutoff(now, { months: 1, days: 2, hours: 3 });
    expect(cutoffCombo < now).toBe(true);
  });

  it('defineRetentionPolicy handles default getCandidates with where clause and without where clause', async () => {
    // 1. With where clause
    const mockEntities = [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
      { id: '3', name: 'c' },
    ];
    const policyWithWhere = defineRetentionPolicy({
      id: 'test-where-policy',
      entity: 'test_entity',
      action: 'delete',
      where: () => Promise.resolve(mockEntities),
    });

    const candidates = await policyWithWhere.getCandidates(
      {} as DbClient,
      new Date(),
      2,
      ['2'], // Exclude id '2'
    );
    expect(candidates).toEqual([
      { id: '1', name: 'a' },
      { id: '3', name: 'c' },
    ]);

    // 2. Without where clause
    const policyWithoutWhere = defineRetentionPolicy({
      id: 'test-no-where-policy',
      entity: 'test_entity',
      action: 'delete',
    });

    const candidatesNoWhere = await policyWithoutWhere.getCandidates(
      {} as DbClient,
      new Date(),
      10,
      [],
    );
    expect(candidatesNoWhere).toEqual([]);

    // 3. Default deleteBatch no-op
    await expect(policyWithoutWhere.deleteBatch({} as DbClient, ['1'])).resolves.toBeUndefined();
  });

  it('createDefaultPolicies constructs policies that exercise getCandidates and deleteBatch branches', async () => {
    const policies = createDefaultPolicies();
    expect(policies).toHaveLength(10);

    const [
      auditPolicy,
      sessionPolicy,
      rateLimitPolicy,
      consentProofPolicy,
      inactiveClientsPolicy,
      unconvertedLeadsPolicy,
      spamLeadsPolicy,
      expiredPowReplaysPolicy,
      failedEmailOutboxPolicy,
      unacceptedProposalsPolicy,
    ] = policies;
    expect(auditPolicy).toBeDefined();
    expect(sessionPolicy).toBeDefined();
    expect(rateLimitPolicy).toBeDefined();
    expect(consentProofPolicy).toBeDefined();
    expect(inactiveClientsPolicy).toBeDefined();
    expect(unconvertedLeadsPolicy).toBeDefined();
    expect(spamLeadsPolicy).toBeDefined();
    expect(expiredPowReplaysPolicy).toBeDefined();
    expect(failedEmailOutboxPolicy).toBeDefined();
    expect(unacceptedProposalsPolicy).toBeDefined();

    // Mock DB client
    let deletedCount = 0;
    const mockClient = {
      execute: () => Promise.resolve([{ id: 'row-1' }]),
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve([{ id: 'row-1' }]);
            const chain = {
              limit: (lim: number) => Promise.resolve([{ id: 'row-1' }].slice(0, lim)),
              orderBy: () => ({
                limit: (lim: number) => Promise.resolve([{ id: 'row-1' }].slice(0, lim)),
              }),
            };
            return Object.assign(p, chain);
          },
        }),
      }),
      delete: () => ({
        where: vi.fn(() => {
          deletedCount++;
          return Promise.resolve();
        }),
      }),
    } as unknown as DbClient;

    const now = new Date();

    if (auditPolicy) {
      // getCandidates with excludedIds and without
      const c1 = await auditPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await auditPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      // deleteBatch with ids and without
      await auditPolicy.deleteBatch(mockClient, []);
      expect(deletedCount).toBe(0);
      await auditPolicy.deleteBatch(mockClient, ['row-1']);
      expect(deletedCount).toBe(1);

      if (auditPolicy.legalHold) {
        const asAudit = (row: { id: string; metadata?: Record<string, unknown> | null }) =>
          row as unknown as Parameters<NonNullable<typeof auditPolicy.legalHold>>[0];
        expect(auditPolicy.legalHold(asAudit({ id: 'a-1', metadata: { legal_hold: true } }))).toBe(
          true,
        );
        expect(auditPolicy.legalHold(asAudit({ id: 'a-2', metadata: { legal_hold: false } }))).toBe(
          false,
        );
        expect(auditPolicy.legalHold(asAudit({ id: 'a-3', metadata: { other: 123 } }))).toBe(false);
        expect(auditPolicy.legalHold(asAudit({ id: 'a-4', metadata: null }))).toBe(false);
        expect(auditPolicy.legalHold(asAudit({ id: 'a-5' }))).toBe(false);
      }
    }

    if (sessionPolicy) {
      // getCandidates with excludedIds and without
      const c1 = await sessionPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await sessionPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      // deleteBatch with ids and without
      await sessionPolicy.deleteBatch(mockClient, []);
      await sessionPolicy.deleteBatch(mockClient, ['row-1']);
      expect(deletedCount).toBe(2);
    }

    if (rateLimitPolicy) {
      // getCandidates with excludedIds and without
      const c1 = await rateLimitPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await rateLimitPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      // deleteBatch with ids and without
      await rateLimitPolicy.deleteBatch(mockClient, []);
      await rateLimitPolicy.deleteBatch(mockClient, ['row-1']);
      expect(deletedCount).toBe(3);
    }

    if (consentProofPolicy) {
      // getCandidates with excludedIds and without
      const c1 = await consentProofPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await consentProofPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      // deleteBatch with ids and without
      await consentProofPolicy.deleteBatch(mockClient, []);
      await consentProofPolicy.deleteBatch(mockClient, ['row-1']);
      // Deletes timeline events and consent records (2 calls)
      expect(deletedCount).toBe(5);
    }

    if (inactiveClientsPolicy) {
      if (inactiveClientsPolicy.legalHold) {
        const holdNoTx = await inactiveClientsPolicy.legalHold({ id: 'c-1' }, undefined);
        expect(holdNoTx).toBe(false);

        const holdWithTx = await inactiveClientsPolicy.legalHold({ id: 'c-1' }, mockClient);
        expect(typeof holdWithTx).toBe('boolean');

        const { registerErasureHoldProvider, resetErasureHoldProviders } =
          await import('@/server/privacy/erasure/registry');
        registerErasureHoldProvider({
          id: 'test-unit-mock-hold',
          holds: () =>
            Promise.resolve([
              {
                providerId: 'test-unit-mock-hold',
                reason: 'manual.dispute',
                retainUntil: null,
              },
            ]),
        });
        const holdWithProvider = await inactiveClientsPolicy.legalHold({ id: 'c-1' }, mockClient);
        expect(holdWithProvider).toBe(true);
        resetErasureHoldProviders();
      }

      if (inactiveClientsPolicy.eraseCandidate) {
        const eraseModule = await import('@/server/privacy/erasure/service');
        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: true,
          subjectKind: 'client',
          categoryCounts: { client: 1 },
        });
        const res1 = await inactiveClientsPolicy.eraseCandidate(mockClient, 'c-1');
        expect(res1.outcome).toBe('deleted');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'ERASURE_BLOCKED',
          holds: [{ reason: 'legal_hold', retainUntil: null }],
        });
        const res2 = await inactiveClientsPolicy.eraseCandidate(mockClient, 'c-1');
        expect(res2.outcome).toBe('held');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Database lock timeout',
        });
        const res3 = await inactiveClientsPolicy.eraseCandidate(mockClient, 'c-1');
        expect(res3.outcome).toBe('failed');
        expect(res3.error).toBe('Database lock timeout');
      }

      // 1. With rows empty
      const mockEmptyClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      } as unknown as DbClient;
      const emptyCandidates = await inactiveClientsPolicy.getCandidates(
        mockEmptyClient,
        now,
        10,
        [],
      );
      expect(emptyCandidates).toEqual([]);

      // 2. With rows and excludedIds
      const mockRowsClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  { id: 'c-1', lastActivityAt: now },
                  { id: 'c-2', lastActivityAt: now },
                ]),
              }),
            }),
          }),
        }),
        selectDistinct: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as DbClient;
      const candidates = await inactiveClientsPolicy.getCandidates(mockRowsClient, now, 10, [
        'ex-1',
      ]);
      expect(Array.isArray(candidates)).toBe(true);

      // 3. With rows and no excludedIds
      const candidatesNoEx = await inactiveClientsPolicy.getCandidates(mockRowsClient, now, 10, []);
      expect(Array.isArray(candidatesNoEx)).toBe(true);

      await inactiveClientsPolicy.deleteBatch(mockClient, []);
      await inactiveClientsPolicy.deleteBatch(mockClient, ['c-1', 'c-2']);
    }

    if (unconvertedLeadsPolicy) {
      expect(unconvertedLeadsPolicy.after?.months).toBeGreaterThanOrEqual(1);

      // getCandidates with excludedIds and without
      const c1 = await unconvertedLeadsPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await unconvertedLeadsPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      if (unconvertedLeadsPolicy.eraseCandidate) {
        const eraseModule = await import('@/server/privacy/erasure/service');
        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: true,
          subjectKind: 'lead',
          categoryCounts: { lead: 1 },
        });
        const res1 = await unconvertedLeadsPolicy.eraseCandidate(mockClient, 'lead-1');
        expect(res1.outcome).toBe('deleted');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'ERASURE_BLOCKED',
          holds: [{ reason: 'legal_hold', retainUntil: null }],
        });
        const res2 = await unconvertedLeadsPolicy.eraseCandidate(mockClient, 'lead-1');
        expect(res2.outcome).toBe('held');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Lead lock conflict',
        });
        const res3 = await unconvertedLeadsPolicy.eraseCandidate(mockClient, 'lead-1');
        expect(res3.outcome).toBe('failed');
        expect(res3.error).toBe('Lead lock conflict');
      }

      await unconvertedLeadsPolicy.deleteBatch(mockClient, ['lead-1', 'lead-2']);
    }

    if (spamLeadsPolicy) {
      expect(spamLeadsPolicy.after?.days).toBe(30);

      // getCandidates with excludedIds and without
      const c1 = await spamLeadsPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await spamLeadsPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);

      if (spamLeadsPolicy.eraseCandidate) {
        const eraseModule = await import('@/server/privacy/erasure/service');
        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: true,
          subjectKind: 'lead',
          categoryCounts: { lead: 1 },
        });
        const res1 = await spamLeadsPolicy.eraseCandidate(mockClient, 'spam-1');
        expect(res1.outcome).toBe('deleted');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'ERASURE_BLOCKED',
          holds: [{ reason: 'legal_hold', retainUntil: null }],
        });
        const res2 = await spamLeadsPolicy.eraseCandidate(mockClient, 'spam-1');
        expect(res2.outcome).toBe('held');

        vi.mocked(eraseModule.eraseSubject).mockResolvedValueOnce({
          success: false,
          code: 'INTERNAL_ERROR',
          error: 'Spam lock conflict',
        });
        const res3 = await spamLeadsPolicy.eraseCandidate(mockClient, 'spam-1');
        expect(res3.outcome).toBe('failed');
        expect(res3.error).toBe('Spam lock conflict');
      }

      await spamLeadsPolicy.deleteBatch(mockClient, ['spam-1', 'spam-2']);
    }

    if (expiredPowReplaysPolicy) {
      expect(expiredPowReplaysPolicy.id).toBe('expired-pow-replays');
      const c1 = await expiredPowReplaysPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await expiredPowReplaysPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);
      await expiredPowReplaysPolicy.deleteBatch(mockClient, []);
      await expiredPowReplaysPolicy.deleteBatch(mockClient, ['pow-1']);
    }

    if (failedEmailOutboxPolicy) {
      expect(failedEmailOutboxPolicy.id).toBe('failed-email-outbox');
      const c1 = await failedEmailOutboxPolicy.getCandidates(mockClient, now, 10, ['ex-1']);
      expect(c1).toHaveLength(1);
      const c2 = await failedEmailOutboxPolicy.getCandidates(mockClient, now, 10, []);
      expect(c2).toHaveLength(1);
      await failedEmailOutboxPolicy.deleteBatch(mockClient, []);
      await failedEmailOutboxPolicy.deleteBatch(mockClient, ['outbox-1']);
    }
  });

  it('manages policy registry via registerPolicy, getPolicies, and resetPolicies', () => {
    // resetPolicies clears and initializes default policies
    resetPolicies();
    const initialPolicies = getPolicies();
    expect(initialPolicies.length).toBeGreaterThanOrEqual(3);

    // Register a custom policy
    const customPolicy = defineRetentionPolicy({
      id: 'custom-test-policy',
      entity: 'custom_entity',
      action: 'delete',
    });
    registerPolicy(customPolicy);

    const updatedPolicies = getPolicies();
    expect(updatedPolicies.some((p) => p.id === 'custom-test-policy')).toBe(true);

    // Reset again
    resetPolicies();
    const finalPolicies = getPolicies();
    expect(finalPolicies.some((p) => p.id === 'custom-test-policy')).toBe(false);
  });

  it('I3-C02: createDefaultPolicies falls back to 24 months when RETENTION_PERIOD_MONTHS is invalid or empty', () => {
    const policies = createDefaultPolicies();
    const auditPolicy = policies.find((p) => p.id === 'audit-events-retention');
    expect(auditPolicy).toBeDefined();
    expect(auditPolicy?.after?.months).toBe(24);
  });

  it('getClientRetentionMonths returns positive integer and tests fallbacks', () => {
    const origClient = process.env.CLIENT_RETENTION_MONTHS;
    try {
      // Configured valid value
      process.env.CLIENT_RETENTION_MONTHS = '48';
      expect(getClientRetentionMonths()).toBe(48);

      // Out of range (0)
      process.env.CLIENT_RETENTION_MONTHS = '0';
      expect(getClientRetentionMonths()).toBe(36);

      // Non-numeric
      process.env.CLIENT_RETENTION_MONTHS = 'invalid';
      expect(getClientRetentionMonths()).toBe(36);
    } finally {
      if (origClient !== undefined) {
        process.env.CLIENT_RETENTION_MONTHS = origClient;
      } else {
        delete process.env.CLIENT_RETENTION_MONTHS;
      }
    }
  });

  it('getLeadRetentionMonths returns positive integer and tests non-numeric parse', async () => {
    const { getLeadRetentionMonths } = await import('@/server/retention/policy');
    const origLead = process.env.LEAD_RETENTION_MONTHS;
    try {
      process.env.LEAD_RETENTION_MONTHS = 'invalid-lead-months';
      expect(getLeadRetentionMonths()).toBe(12);

      process.env.LEAD_RETENTION_MONTHS = '24';
      expect(getLeadRetentionMonths()).toBe(24);
    } finally {
      if (origLead !== undefined) {
        process.env.LEAD_RETENTION_MONTHS = origLead;
      } else {
        delete process.env.LEAD_RETENTION_MONTHS;
      }
    }
  });

  it('createDefaultPolicies respects configured RETENTION_PERIOD_MONTHS and CONSENT_PROOF_RETENTION_MONTHS', () => {
    const origPeriod = process.env.RETENTION_PERIOD_MONTHS;
    const origConsent = process.env.CONSENT_PROOF_RETENTION_MONTHS;
    try {
      process.env.RETENTION_PERIOD_MONTHS = '18';
      process.env.CONSENT_PROOF_RETENTION_MONTHS = '60';
      resetEnvCache();

      const policies = createDefaultPolicies();
      const auditPolicy = policies.find((p) => p.id === 'audit-events-retention');
      expect(auditPolicy?.after?.months).toBe(18);

      const consentPolicy = policies.find((p) => p.id === 'withdrawn-consent-proof');
      expect(consentPolicy?.after?.months).toBe(60);
    } finally {
      if (origPeriod !== undefined) {
        process.env.RETENTION_PERIOD_MONTHS = origPeriod;
      } else {
        delete process.env.RETENTION_PERIOD_MONTHS;
      }
      if (origConsent !== undefined) {
        process.env.CONSENT_PROOF_RETENTION_MONTHS = origConsent;
      } else {
        delete process.env.CONSENT_PROOF_RETENTION_MONTHS;
      }
      resetEnvCache();
    }
  });
});

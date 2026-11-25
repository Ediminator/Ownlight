import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  contractsHoldProvider,
  calculateStatutoryRetentionLockDate,
  evaluateContractStatutoryHold,
  STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON,
} from '@/server/contracts/privacy/hold-provider';
import type { DbClient } from '@/server/db/client';

describe('TASK-0066: Contracts Statutory Commercial Hold Provider Unit Tests (AC-4, AC-5)', () => {
  describe('calculateStatutoryRetentionLockDate (§147 AO / §257 HGB)', () => {
    it('AC-4: computes UTC December 31 23:59:59.999 of the 10th year following signature', () => {
      const signedJan1 = new Date('2026-01-01T00:00:00.000Z');
      expect(calculateStatutoryRetentionLockDate(signedJan1).toISOString()).toBe(
        '2036-12-31T23:59:59.999Z',
      );

      const signedMidYear = new Date('2026-06-15T14:30:00.000Z');
      expect(calculateStatutoryRetentionLockDate(signedMidYear).toISOString()).toBe(
        '2036-12-31T23:59:59.999Z',
      );

      const signedDec31 = new Date('2026-12-31T23:59:59.999Z');
      expect(calculateStatutoryRetentionLockDate(signedDec31).toISOString()).toBe(
        '2036-12-31T23:59:59.999Z',
      );
    });

    it('AC-4: handles leap-year February 29 signature dates cleanly without date drift', () => {
      const signedLeapDay = new Date('2024-02-29T12:00:00.000Z');
      expect(calculateStatutoryRetentionLockDate(signedLeapDay).toISOString()).toBe(
        '2034-12-31T23:59:59.999Z',
      );
    });
  });

  describe('evaluateContractStatutoryHold', () => {
    it('AC-4: returns active hold with statutory.commercial_contract when lock date is in the future', () => {
      const now = new Date('2026-11-25T10:00:00.000Z');
      const result = evaluateContractStatutoryHold(
        [
          {
            id: 'ctr-1',
            clientSignedAt: new Date('2026-05-10T10:00:00.000Z'),
            studioSignedAt: new Date('2026-05-10T10:05:00.000Z'),
            updatedAt: new Date('2026-05-10T10:05:00.000Z'),
            createdAt: new Date('2026-05-01T10:00:00.000Z'),
          },
        ],
        now,
      );

      expect(result.active).toBe(true);
      expect(result.reason).toBe(STATUTORY_COMMERCIAL_CONTRACT_HOLD_REASON);
      expect(result.reason).toBe('statutory.commercial_contract');
      expect(result.retainUntil).toBe('2036-12-31T23:59:59.999Z');
      expect(result.legalExplanation).toContain('§147');
      expect(result.legalExplanation).toContain('§257');
    });

    it('AC-5: reports active: false when 10-year December 31 lock date has elapsed', () => {
      // Signed in 2015 -> lock date 2025-12-31T23:59:59.999Z -> expired in 2026
      const now = new Date('2026-01-01T00:00:00.000Z');
      const result = evaluateContractStatutoryHold(
        [
          {
            id: 'ctr-old',
            clientSignedAt: new Date('2015-03-20T12:00:00.000Z'),
            studioSignedAt: new Date('2015-03-20T12:00:00.000Z'),
            updatedAt: new Date('2015-03-20T12:00:00.000Z'),
            createdAt: new Date('2015-03-15T12:00:00.000Z'),
          },
        ],
        now,
      );

      expect(result.active).toBe(false);
      expect(result.retainUntil).toBe('2025-12-31T23:59:59.999Z');
    });

    it('AC-4: remains active up to exact millisecond before expiry and expires at/after lockDate', () => {
      const signed = new Date('2015-12-31T10:00:00.000Z');
      const contractsList = [
        {
          id: 'ctr-boundary',
          clientSignedAt: signed,
          studioSignedAt: signed,
          updatedAt: signed,
          createdAt: signed,
        },
      ];

      const oneMsBefore = new Date('2025-12-31T23:59:59.998Z');
      expect(evaluateContractStatutoryHold(contractsList, oneMsBefore).active).toBe(true);

      const exactLock = new Date('2025-12-31T23:59:59.999Z');
      expect(evaluateContractStatutoryHold(contractsList, exactLock).active).toBe(false);
    });

    it('AC-4: picks the latest lock date across multiple signed contracts and handles fallback dates', () => {
      const now = new Date('2026-11-25T00:00:00.000Z');
      const result = evaluateContractStatutoryHold(
        [
          {
            id: 'ctr-older',
            clientSignedAt: new Date('2022-04-01T00:00:00.000Z'),
            studioSignedAt: null,
            updatedAt: new Date('2022-04-01T00:00:00.000Z'),
            createdAt: new Date('2022-03-25T00:00:00.000Z'),
          },
          {
            id: 'ctr-newer',
            clientSignedAt: null,
            studioSignedAt: new Date('2025-08-15T00:00:00.000Z'),
            updatedAt: new Date('2025-08-15T00:00:00.000Z'),
            createdAt: new Date('2025-08-01T00:00:00.000Z'),
          },
          {
            id: 'ctr-fallback-updated',
            clientSignedAt: null,
            studioSignedAt: null,
            updatedAt: new Date('2021-01-15T00:00:00.000Z'),
            createdAt: new Date('2021-01-01T00:00:00.000Z'),
          },
        ],
        now,
      );

      expect(result.active).toBe(true);
      expect(result.retainUntil).toBe('2035-12-31T23:59:59.999Z');
    });

    it('AC-4: returns inactive when signed contracts array is empty', () => {
      const result = evaluateContractStatutoryHold([], new Date('2026-11-25T00:00:00.000Z'));
      expect(result.active).toBe(false);
      expect(result.retainUntil).toBeNull();
    });
  });

  describe('contractsHoldProvider.holds', () => {
    it('AC-4: returns statutory.commercial_contract hold when client has an active signed contract', async () => {
      const signedAt = new Date();
      const expectedYear = signedAt.getUTCFullYear() + 10;

      const mockTx = {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  id: 'ctr-1',
                  clientSignedAt: signedAt,
                  studioSignedAt: signedAt,
                  updatedAt: signedAt,
                  createdAt: signedAt,
                },
              ]),
          }),
        }),
      } as unknown as DbClient;

      const holds = await contractsHoldProvider.holds(
        { kind: 'client', clientId: 'client-1' },
        mockTx,
      );

      expect(holds).toHaveLength(1);
      expect(holds[0]?.reason).toBe('statutory.commercial_contract');
      expect(holds[0]?.retainUntil).toBe(`${String(expectedYear)}-12-31T23:59:59.999Z`);
    });

    it('AC-5: returns empty holds array when signed contract lock date has already elapsed', async () => {
      const oldSignedAt = new Date('2010-06-15T12:00:00.000Z');

      const mockTx = {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                {
                  id: 'ctr-expired',
                  clientSignedAt: oldSignedAt,
                  studioSignedAt: oldSignedAt,
                  updatedAt: oldSignedAt,
                  createdAt: oldSignedAt,
                },
              ]),
          }),
        }),
      } as unknown as DbClient;

      const holds = await contractsHoldProvider.holds(
        { kind: 'client', clientId: 'client-expired' },
        mockTx,
      );

      expect(holds).toEqual([]);
    });

    it('AC-4: ignores non-client subjects (lead, contact) and returns empty array', async () => {
      const mockTx = {} as DbClient;

      expect(await contractsHoldProvider.holds({ kind: 'lead', leadId: 'lead-1' }, mockTx)).toEqual(
        [],
      );
      expect(
        await contractsHoldProvider.holds(
          { kind: 'contact', contactId: 'contact-1', clientId: 'client-1' },
          mockTx,
        ),
      ).toEqual([]);
    });
  });
});

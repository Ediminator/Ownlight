import { describe, it, expect } from 'vitest';
import { LEAD_STATUSES, isAllowedLeadStatusTransition } from '@/server/leads/transitions';

describe('AC-2: Lead status transitions (25 status pairs)', () => {
  const allowedTransitions = new Set<string>([
    'new->contacted',
    'new->archived',
    'new->spam',
    'contacted->archived',
    'contacted->spam',
    'archived->new',
    'spam->new',
  ]);

  it('AC-2: enumerates all 25 pairs and validates against ADR-0015 §6 transition table', () => {
    let testedCount = 0;

    for (const fromStatus of LEAD_STATUSES) {
      for (const toStatus of LEAD_STATUSES) {
        testedCount++;
        const pairKey = `${fromStatus}->${toStatus}`;
        const isExpectedAllowed = allowedTransitions.has(pairKey);
        const result = isAllowedLeadStatusTransition(fromStatus, toStatus);

        expect(
          result,
          `Transition ${pairKey} should be ${isExpectedAllowed ? 'ALLOWED' : 'DISALLOWED'}`,
        ).toBe(isExpectedAllowed);
      }
    }

    expect(testedCount).toBe(25);
  });

  it('AC-2: rejects any transition to converted through changeLeadStatus transition logic', () => {
    for (const fromStatus of LEAD_STATUSES) {
      expect(isAllowedLeadStatusTransition(fromStatus, 'converted')).toBe(false);
    }
  });

  it('AC-2: rejects any transition from converted through changeLeadStatus transition logic', () => {
    for (const toStatus of LEAD_STATUSES) {
      expect(isAllowedLeadStatusTransition('converted', toStatus)).toBe(false);
    }
  });

  it('AC-2: rejects identical from and to status transitions', () => {
    for (const status of LEAD_STATUSES) {
      expect(isAllowedLeadStatusTransition(status, status)).toBe(false);
    }
  });
});

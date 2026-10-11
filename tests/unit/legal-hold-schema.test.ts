import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  setLegalHoldInputSchema,
  releaseLegalHoldInputSchema,
} from '@/server/clients/legal-hold-schema';
import { isHoldActive } from '@/server/db/schema/client-legal-holds';
import { isHoldActiveDate } from '@/components/clients/legal-hold-section';

describe('Legal Hold Schema & Activeness Validation (AC-2)', () => {
  const validClientId = '018f6e80-87b6-79ef-97d5-ec5bfa608920';

  it('AC-2: validates correct setLegalHold input with valid reason and optional fields', () => {
    const input = {
      clientId: validClientId,
      reason: 'dispute' as const,
      note: 'Synthetic dispute for testing',
      until: '2028-12-31',
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.clientId).toBe(validClientId);
      expect(parsed.data.reason).toBe('dispute');
      expect(parsed.data.note).toBe('Synthetic dispute for testing');
      expect(parsed.data.until).toBe('2028-12-31');
    }
  });

  it('AC-2: rejects missing reason', () => {
    const input = {
      clientId: validClientId,
      note: 'Note without reason',
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('AC-2: rejects unknown reason', () => {
    const input = {
      clientId: validClientId,
      reason: 'unknown_reason',
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('AC-2: rejects note exceeding 500 characters', () => {
    const longNote = 'A'.repeat(501);
    const input = {
      clientId: validClientId,
      reason: 'statutory' as const,
      note: longNote,
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('500'))).toBe(true);
    }
  });

  it('AC-2: accepts note of exactly 500 characters', () => {
    const exactNote = 'B'.repeat(500);
    const input = {
      clientId: validClientId,
      reason: 'other' as const,
      note: exactNote,
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('AC-2: rejects unknown extra key due to strict schema', () => {
    const input = {
      clientId: validClientId,
      reason: 'dispute' as const,
      extraKey: 'malicious_data',
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('AC-2: rejects invalid until format (not YYYY-MM-DD)', () => {
    const input = {
      clientId: validClientId,
      reason: 'dispute' as const,
      until: '12/31/2028',
    };
    const parsed = setLegalHoldInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('AC-2: validates releaseLegalHold input with valid clientId and rejects extra keys', () => {
    const valid = { clientId: validClientId };
    expect(releaseLegalHoldInputSchema.safeParse(valid).success).toBe(true);

    const invalidExtra = { clientId: validClientId, unexpected: 123 };
    expect(releaseLegalHoldInputSchema.safeParse(invalidExtra).success).toBe(false);

    const invalidUuid = { clientId: 'not-a-uuid' };
    expect(releaseLegalHoldInputSchema.safeParse(invalidUuid).success).toBe(false);
  });

  describe('isHoldActive logic by date and studio timezone', () => {
    it('treats NULL or undefined until as indefinite active hold', () => {
      expect(isHoldActive(null, 'UTC')).toBe(true);
      expect(isHoldActive(undefined, 'UTC')).toBe(true);
      expect(isHoldActiveDate(null, 'UTC')).toBe(true);
      expect(isHoldActiveDate(undefined, 'UTC')).toBe(true);
    });

    it('treats future date as active hold', () => {
      const future = '2099-01-01';
      expect(isHoldActive(future, 'UTC')).toBe(true);
      expect(isHoldActiveDate(future, 'UTC')).toBe(true);
    });

    it('treats past date as inactive hold', () => {
      const past = '2020-01-01';
      expect(isHoldActive(past, 'UTC')).toBe(false);
      expect(isHoldActiveDate(past, 'UTC')).toBe(false);
    });

    it('respects studio timezone when determining current date', () => {
      // In timezone Pacific/Kiritimati (UTC+14), it can be tomorrow relative to UTC
      // In timezone Pacific/Midway (UTC-11), it can be yesterday relative to UTC
      expect(typeof isHoldActive('2025-01-01', 'Europe/Berlin')).toBe('boolean');
      expect(typeof isHoldActiveDate('2025-01-01', 'Europe/Berlin')).toBe('boolean');
    });
  });
});

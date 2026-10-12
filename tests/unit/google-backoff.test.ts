import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateBackoffDelayMs,
  calculateNextAttemptDate,
  isTerminalRetry,
  MAX_RETRY_ATTEMPTS,
} from '@/server/jobs/backoff';

describe('TASK-0021: Exponential Backoff with Jitter (AC-5)', () => {
  it('AC-5: increases delay exponentially with attempt number', () => {
    // Zero jitter function for deterministic assertion
    const noJitter = () => 0;

    const delay1 = calculateBackoffDelayMs(1, { baseDelayMs: 1000, randomFn: noJitter });
    const delay2 = calculateBackoffDelayMs(2, { baseDelayMs: 1000, randomFn: noJitter });
    const delay3 = calculateBackoffDelayMs(3, { baseDelayMs: 1000, randomFn: noJitter });
    const delay4 = calculateBackoffDelayMs(4, { baseDelayMs: 1000, randomFn: noJitter });

    expect(delay1).toBe(1000);
    expect(delay2).toBe(2000);
    expect(delay3).toBe(4000);
    expect(delay4).toBe(8000);
  });

  it('AC-5: adds non-negative jitter within the expected variance bound', () => {
    const minJitter = () => 0;
    const maxJitter = () => 1;

    const baseDelay = calculateBackoffDelayMs(2, { baseDelayMs: 2000, randomFn: minJitter });
    const delayWithMaxJitter = calculateBackoffDelayMs(2, {
      baseDelayMs: 2000,
      randomFn: maxJitter,
    });

    // With attempt 2 and base 2000, exponential delay is 4000
    // Jitter is 4000 * 0.25 * 1 = 1000
    expect(baseDelay).toBe(4000);
    expect(delayWithMaxJitter).toBe(5000);
  });

  it('AC-5: enforces maximum delay cap', () => {
    const noJitter = () => 0;
    const delayHighAttempt = calculateBackoffDelayMs(10, {
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      randomFn: noJitter,
    });

    expect(delayHighAttempt).toBe(10000);
  });

  it('AC-5: calculates future Date for next_attempt_at accurately', () => {
    const fixedNow = new Date('2026-10-12T10:00:00.000Z');
    const noJitter = () => 0;

    const nextAttempt = calculateNextAttemptDate(1, {
      baseDelayMs: 5000,
      randomFn: noJitter,
      now: fixedNow,
    });

    expect(nextAttempt.toISOString()).toBe('2026-10-12T10:00:05.000Z');
  });

  it('AC-5: correctly flags terminal retry threshold at 5 attempts', () => {
    expect(isTerminalRetry(1)).toBe(false);
    expect(isTerminalRetry(2)).toBe(false);
    expect(isTerminalRetry(3)).toBe(false);
    expect(isTerminalRetry(4)).toBe(false);
    expect(isTerminalRetry(5)).toBe(true);
    expect(isTerminalRetry(6)).toBe(true);
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
  });

  it('AC-9: shared backoff module moved to @/server/jobs/backoff and old location does not exist', () => {
    const oldPath = path.resolve(__dirname, '../../src/server/integrations/google/backoff.ts');
    expect(fs.existsSync(oldPath)).toBe(false);
  });
});

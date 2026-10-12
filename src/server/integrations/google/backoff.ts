/**
 * Exponential Backoff with Jitter for Google People API Retries (TASK-0021, AC-5).
 *
 * Implements exponential backoff: base * 2^(attempt - 1) + jitter,
 * capped at maxDelayMs, with a maximum cap of 5 retry attempts.
 */

export const DEFAULT_BASE_DELAY_MS = 1000; // 1 second
export const DEFAULT_MAX_DELAY_MS = 60 * 60 * 1000; // 1 hour
export const MAX_RETRY_ATTEMPTS = 5;

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  randomFn?: () => number;
  now?: Date;
}

/**
 * Calculates delay in milliseconds for a given attempt number (1-based).
 */
export function calculateBackoffDelayMs(
  attempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    randomFn?: () => number;
  } = {},
): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.randomFn ?? Math.random;

  // For attempt <= 1, delay = base. For attempt > 1, base * 2^(attempt - 1)
  const exponent = Math.max(0, attempt - 1);
  const exponentialDelay = Math.min(max, base * Math.pow(2, exponent));

  // Jitter: up to 25% of the exponential delay added as random variance
  const jitter = exponentialDelay * 0.25 * random();

  return Math.min(max, Math.floor(exponentialDelay + jitter));
}

/**
 * Calculates next attempt timestamp for a failed outbox task.
 */
export function calculateNextAttemptDate(attempt: number, options: BackoffOptions = {}): Date {
  const delayMs = calculateBackoffDelayMs(attempt, options);
  const now = options.now ? options.now.getTime() : Date.now();
  return new Date(now + delayMs);
}

/**
 * Checks whether an attempt count has reached the terminal retry threshold.
 */
export function isTerminalRetry(
  attempt: number,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
): boolean {
  return attempt >= maxAttempts;
}

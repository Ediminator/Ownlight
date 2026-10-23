import 'server-only';
import crypto from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema/auth';

/**
 * Typed error thrown when the rate limit service or database is unavailable.
 * Used by callers to fail-closed without leaking PII or credentials.
 */
export class RateLimitUnavailableError extends Error {
  constructor(message = 'Rate limit service unavailable') {
    super(message);
    this.name = 'RateLimitUnavailableError';
  }
}

export const ACCOUNT_MAX_ATTEMPTS = 10;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const IP_MAX_ATTEMPTS = 50;
export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Rate limit thresholds for bootstrap setup
export const SETUP_IP_MAX_ATTEMPTS = 10;
export const SETUP_IP_WINDOW_MS = 15 * 60 * 1000;

// Rate limit thresholds for password reset requests (dispatches email)
export const RESET_REQ_ACCOUNT_MAX_ATTEMPTS = 5;
export const RESET_REQ_IP_MAX_ATTEMPTS = 10;
export const RESET_REQ_WINDOW_MS = 15 * 60 * 1000;

// Rate limit thresholds for password reset execution (verifies token)
export const RESET_EXEC_ACCOUNT_MAX_ATTEMPTS = 10;
export const RESET_EXEC_IP_MAX_ATTEMPTS = 15;
export const RESET_EXEC_WINDOW_MS = 15 * 60 * 1000;

// Rate limit thresholds for Multi-Factor Authentication (TASK-0008 / AC-4)
export const MFA_MAX_ATTEMPTS = 5;
export const MFA_IP_MAX_ATTEMPTS = 25;
export const MFA_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: 'account' | 'ip';
}

/**
 * Truncates an IP address adhering to GDPR Art. 5(1)(c) data minimisation:
 * - IPv4: zeroes out host octet (/24 subnet, e.g. 192.168.1.0)
 * - IPv6: zeroes out interface/host bits (/48 subnet, e.g. 2001:db8:85a3::/48)
 */
export function anonymizeIp(ip: string): string {
  const clean = ip.trim();
  if (!clean) return '0.0.0.0';

  // IPv4
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (
      parts.length === 4 &&
      parts[0] !== undefined &&
      parts[1] !== undefined &&
      parts[2] !== undefined
    ) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6
  if (clean.includes(':')) {
    const parts = clean.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::/48`;
  }

  return clean;
}

/**
 * Derives a hashed key for an account identifier to avoid persisting plaintext PII.
 */
export function getAccountKey(identifier: string): string {
  const normalized = identifier.toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `account:${hash}`;
}

/**
 * Derives an anonymised key for an IP address.
 */
export function getIpKey(ip: string): string {
  return `ip:${anonymizeIp(ip)}`;
}

/**
 * Cleans up expired rate-limit records (retention <= 24h).
 */
export async function cleanupExpiredRateLimits(client: DbClient = defaultDb): Promise<number> {
  try {
    const now = new Date();
    await client.delete(rateLimits).where(lt(rateLimits.expiresAt, now));
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Consumes one rate limit attempt atomically using a single upsert statement.
 * Resets window if expired.
 * Fail-closed: throws RateLimitUnavailableError on database error.
 */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowMs: number,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowMs);

  try {
    const rows = await client
      .insert(rateLimits)
      .values({
        key,
        count: 1,
        lastAttemptAt: now,
        expiresAt: windowEnd,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
          expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN ${windowEnd} ELSE ${rateLimits.expiresAt} END`,
          lastAttemptAt: sql`now()`,
        },
      })
      .returning({
        count: rateLimits.count,
        expiresAt: rateLimits.expiresAt,
      });

    const record = rows[0];
    if (!record) {
      throw new RateLimitUnavailableError('Failed to execute rate limit upsert');
    }

    const count = record.count;
    const allowed = count <= max;
    const remaining = Math.max(0, max - count);

    return {
      allowed,
      remaining,
      resetAt: record.expiresAt,
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      throw err;
    }
    throw new RateLimitUnavailableError(
      err instanceof Error ? err.message : 'Database error during rate limit consumption',
    );
  }
}

/**
 * Checks whether a key is currently throttled (read-only).
 * Fail-closed: throws RateLimitUnavailableError on database error.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMsOrClient?: number | DbClient,
  client?: DbClient,
): Promise<RateLimitCheckResult> {
  let windowMs = 15 * 60 * 1000;
  let dbClient = defaultDb;

  if (typeof windowMsOrClient === 'number') {
    windowMs = windowMsOrClient;
    if (client) dbClient = client;
  } else if (windowMsOrClient) {
    dbClient = windowMsOrClient;
  }

  const now = new Date();
  try {
    // Prune expired records during check (non-fatal if background cleanup fails)
    void cleanupExpiredRateLimits(dbClient).catch(() => 0);

    const rows = await dbClient.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (rows.length === 0 || !rows[0]) {
      return {
        allowed: true,
        remaining: maxAttempts,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }

    const record = rows[0];

    // If expired, the window has reset
    if (record.expiresAt.getTime() <= now.getTime()) {
      return {
        allowed: true,
        remaining: maxAttempts,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }

    if (record.count >= maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: record.expiresAt,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - record.count),
      resetAt: record.expiresAt,
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      throw err;
    }
    throw new RateLimitUnavailableError(
      err instanceof Error ? err.message : 'Database error during rate limit check',
    );
  }
}

/**
 * Increments the failure counter for a key using an atomic upsert statement.
 * Fail-closed: throws RateLimitUnavailableError on database error.
 */
export async function recordFailedAttempt(
  key: string,
  windowMs: number,
  client: DbClient = defaultDb,
): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowMs);

  try {
    await client
      .insert(rateLimits)
      .values({
        key,
        count: 1,
        lastAttemptAt: now,
        expiresAt: windowEnd,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
          expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} <= now() THEN ${windowEnd} ELSE ${rateLimits.expiresAt} END`,
          lastAttemptAt: sql`now()`,
        },
      });
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      throw err;
    }
    throw new RateLimitUnavailableError(
      err instanceof Error ? err.message : 'Database error during recordFailedAttempt',
    );
  }
}

/**
 * Resets the rate limit counter for a key (e.g. after successful authentication).
 * Fail-closed: throws RateLimitUnavailableError on database error.
 */
export async function resetRateLimit(key: string, client: DbClient = defaultDb): Promise<void> {
  try {
    await client.delete(rateLimits).where(eq(rateLimits.key, key));
  } catch (err) {
    throw new RateLimitUnavailableError(
      err instanceof Error ? err.message : 'Database error during rate limit reset',
    );
  }
}

/**
 * Checks both IP and Account limits before processing a sign-in attempt.
 */
export async function checkSignInRateLimit(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipCheck = await checkRateLimit(getIpKey(ip), IP_MAX_ATTEMPTS, IP_WINDOW_MS, client);
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const accountCheck = await checkRateLimit(
    getAccountKey(identifier),
    ACCOUNT_MAX_ATTEMPTS,
    ACCOUNT_WINDOW_MS,
    client,
  );
  if (!accountCheck.allowed) {
    return { ...accountCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, accountCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), accountCheck.resetAt.getTime())),
  };
}

/**
 * Records a sign-in failure against both the account and the IP.
 */
export async function recordSignInFailure(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await Promise.all([
    recordFailedAttempt(getIpKey(ip), IP_WINDOW_MS, client),
    recordFailedAttempt(getAccountKey(identifier), ACCOUNT_WINDOW_MS, client),
  ]);
}

/**
 * Clears the account rate limit on successful sign-in.
 */
export async function recordSignInSuccess(
  identifier: string,
  client: DbClient = defaultDb,
): Promise<void> {
  await resetRateLimit(getAccountKey(identifier), client);
}

/**
 * Consumes a setup attempt atomically (counts every request).
 */
export async function consumeSetupRateLimit(
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const key = `setup:${anonymizeIp(ip)}`;
  return await consumeRateLimit(key, SETUP_IP_MAX_ATTEMPTS, SETUP_IP_WINDOW_MS, client);
}

/**
 * Checks rate limits for studio owner bootstrap ceremony.
 */
export async function checkSetupRateLimit(
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const key = `setup:${anonymizeIp(ip)}`;
  return await checkRateLimit(key, SETUP_IP_MAX_ATTEMPTS, SETUP_IP_WINDOW_MS, client);
}

/**
 * Records a failed setup attempt.
 */
export async function recordSetupFailure(ip: string, client: DbClient = defaultDb): Promise<void> {
  const key = `setup:${anonymizeIp(ip)}`;
  await recordFailedAttempt(key, SETUP_IP_WINDOW_MS, client);
}

/**
 * Consumes a password reset request attempt atomically across both IP and account (counts every request).
 */
export async function consumePasswordResetRequestRateLimit(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = `reset_req_ip:${anonymizeIp(ip)}`;
  const acctKey = `reset_req_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;

  // Consume IP limit
  const ipCheck = await consumeRateLimit(
    ipKey,
    RESET_REQ_IP_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  // Consume Account limit
  const acctCheck = await consumeRateLimit(
    acctKey,
    RESET_REQ_ACCOUNT_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Checks rate limits for password reset requests (dispatching email).
 */
export async function checkPasswordResetRequestRateLimit(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = `reset_req_ip:${anonymizeIp(ip)}`;
  const ipCheck = await checkRateLimit(
    ipKey,
    RESET_REQ_IP_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const acctKey = `reset_req_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  const acctCheck = await checkRateLimit(
    acctKey,
    RESET_REQ_ACCOUNT_MAX_ATTEMPTS,
    RESET_REQ_WINDOW_MS,
    client,
  );
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Records a password reset request attempt.
 */
export async function recordPasswordResetRequest(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const ipKey = `reset_req_ip:${anonymizeIp(ip)}`;
  const acctKey = `reset_req_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  await Promise.all([
    recordFailedAttempt(ipKey, RESET_REQ_WINDOW_MS, client),
    recordFailedAttempt(acctKey, RESET_REQ_WINDOW_MS, client),
  ]);
}

/**
 * Checks rate limits for password reset execution (verifying and consuming token).
 */
export async function checkPasswordResetActionRateLimit(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = `reset_exec_ip:${anonymizeIp(ip)}`;
  const ipCheck = await checkRateLimit(
    ipKey,
    RESET_EXEC_IP_MAX_ATTEMPTS,
    RESET_EXEC_WINDOW_MS,
    client,
  );
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const acctKey = `reset_exec_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  const acctCheck = await checkRateLimit(
    acctKey,
    RESET_EXEC_ACCOUNT_MAX_ATTEMPTS,
    RESET_EXEC_WINDOW_MS,
    client,
  );
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Records a failed password reset execution attempt.
 */
export async function recordPasswordResetActionFailure(
  email: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const ipKey = `reset_exec_ip:${anonymizeIp(ip)}`;
  const acctKey = `reset_exec_acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  await Promise.all([
    recordFailedAttempt(ipKey, RESET_EXEC_WINDOW_MS, client),
    recordFailedAttempt(acctKey, RESET_EXEC_WINDOW_MS, client),
  ]);
}

/**
 * Derives a hashed key for an MFA verification target to prevent persisting raw identifiers.
 */
export function getMfaAccountKey(identifier: string): string {
  const normalized = identifier.toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `mfa_acct:${hash}`;
}

/**
 * Derives an anonymised key for an MFA verification request IP.
 */
export function getMfaIpKey(ip: string): string {
  return `mfa_ip:${anonymizeIp(ip)}`;
}

/**
 * Checks both IP and Account limits before processing an MFA verification attempt (TASK-0008 / AC-4).
 * Throttles when > 5 failed attempts occur in 15 minutes.
 */
export async function checkMfaRateLimit(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const ipKey = getMfaIpKey(ip);
  const ipCheck = await checkRateLimit(ipKey, MFA_IP_MAX_ATTEMPTS, MFA_WINDOW_MS, client);
  if (!ipCheck.allowed) {
    return { ...ipCheck, reason: 'ip' };
  }

  const acctKey = getMfaAccountKey(identifier);
  const acctCheck = await checkRateLimit(acctKey, MFA_MAX_ATTEMPTS, MFA_WINDOW_MS, client);
  if (!acctCheck.allowed) {
    return { ...acctCheck, reason: 'account' };
  }

  return {
    allowed: true,
    remaining: Math.min(ipCheck.remaining, acctCheck.remaining),
    resetAt: new Date(Math.max(ipCheck.resetAt.getTime(), acctCheck.resetAt.getTime())),
  };
}

/**
 * Records a failed MFA verification attempt against both account and IP.
 */
export async function recordMfaFailure(
  identifier: string,
  ip: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const ipKey = getMfaIpKey(ip);
  const acctKey = getMfaAccountKey(identifier);
  await Promise.all([
    recordFailedAttempt(ipKey, MFA_WINDOW_MS, client),
    recordFailedAttempt(acctKey, MFA_WINDOW_MS, client),
  ]);
}

/**
 * Clears the MFA account rate limit upon successful verification.
 */
export async function recordMfaSuccess(
  identifier: string,
  client: DbClient = defaultDb,
): Promise<void> {
  const acctKey = getMfaAccountKey(identifier);
  await resetRateLimit(acctKey, client);
}

// ==========================================
// Public Booking Scheduler Rate Limiting (TASK-0044 / AC-8)
// ==========================================

export const BOOKING_IP_MAX_ATTEMPTS = 5;
export const BOOKING_IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Consumes one booking submission attempt atomically per client IP.
 * Enforces fail-closed max 5 attempts per 15 minutes window (AC-8).
 */
export async function consumeBookingRateLimit(
  ip: string,
  client: DbClient = defaultDb,
): Promise<RateLimitCheckResult> {
  const key = `booking:${anonymizeIp(ip)}`;
  return await consumeRateLimit(key, BOOKING_IP_MAX_ATTEMPTS, BOOKING_IP_WINDOW_MS, client);
}

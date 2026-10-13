import 'server-only';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createChallenge as altchaCreateChallenge,
  verifySolution as altchaVerifySolution,
  extractParams,
} from 'altcha-lib/v1';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { studioSettings, inquiryPowReplays } from '@/server/db/schema';
import { getStudioSettings } from '@/server/settings/repo';

export const POW_MAX_NUMBER = 50000;
export const POW_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const POW_MIN_DURATION_MS = 3000; // 3 seconds (AC-6)

export interface FormChallenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export type PowVerificationReason = 'missing' | 'expired' | 'too_fast' | 'invalid' | 'pow_replay';

export interface PowVerificationResult {
  verified: boolean;
  reason?: PowVerificationReason;
}

/**
 * Retrieves the singleton studio HMAC secret for ALTCHA PoW challenges (AC-13).
 * If absent, generates 32 cryptographically secure random bytes, stores it base64url-encoded,
 * and returns it.
 * The secret is never exposed in API responses or written to logs.
 */
export async function getOrCreatePowSecret(client: DbClient = defaultDb): Promise<string> {
  const current = await getStudioSettings(client);
  if (current.forms_pow_hmac_key && current.forms_pow_hmac_key.trim().length > 0) {
    return current.forms_pow_hmac_key;
  }

  const generatedSecret = crypto.randomBytes(32).toString('base64url');

  await client
    .update(studioSettings)
    .set({
      forms_pow_hmac_key: generatedSecret,
      updated_at: new Date(),
    })
    .where(eq(studioSettings.id, current.id));

  return generatedSecret;
}

/**
 * Creates an ALTCHA proof-of-work challenge using SHA-256 (AC-1).
 * Embeds issue timestamp and expiration in salt query parameters for stateless validation.
 */
export async function createFormChallenge(
  secret: string,
  options?: {
    maxnumber?: number;
    expires?: Date;
    params?: Record<string, string>;
  },
): Promise<FormChallenge> {
  const expires = options?.expires ?? new Date(Date.now() + POW_EXPIRY_MS);
  const maxnumber = options?.maxnumber ?? POW_MAX_NUMBER;
  const issued = String(Date.now());

  const challenge = await altchaCreateChallenge({
    algorithm: 'SHA-256',
    hmacKey: secret,
    maxnumber,
    expires,
    params: {
      issued,
      ...options?.params,
    },
  });

  return {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    maxnumber: challenge.maxnumber ?? maxnumber,
    salt: challenge.salt,
    signature: challenge.signature,
  };
}

/**
 * Records challenge signature usage to prevent replays (AC-5).
 * Performs atomic INSERT ... ON CONFLICT DO NOTHING.
 * Returns { replayed: true } if the signature hash was already recorded.
 */
export async function recordChallengeUsage(
  signatureHash: string,
  expiresAt: Date,
  client: DbClient = defaultDb,
): Promise<{ replayed: boolean }> {
  const inserted = await client
    .insert(inquiryPowReplays)
    .values({
      signatureHash,
      expiresAt,
    })
    .onConflictDoNothing({ target: inquiryPowReplays.signatureHash })
    .returning({ signatureHash: inquiryPowReplays.signatureHash });

  if (inserted.length === 0) {
    return { replayed: true };
  }

  return { replayed: false };
}

/**
 * Verifies an ALTCHA proof-of-work payload (AC-5, AC-6, AC-7, AC-8).
 * Checks:
 * 1. Payload presence and valid JSON structure.
 * 2. Cryptographic signature and SHA-256 solution matching.
 * 3. Expiration (expires_at > now).
 * 4. Timing threshold (now - issued >= 3,000 ms).
 * 5. Replay guard (signature not recorded in inquiry_pow_replays).
 */
export async function verifyPowPayload(
  rawPayload: unknown,
  secret: string,
  client: DbClient = defaultDb,
  now: number = Date.now(),
): Promise<PowVerificationResult> {
  if (!rawPayload || typeof rawPayload !== 'string' || rawPayload.trim().length === 0) {
    return { verified: false, reason: 'missing' };
  }

  let parsed: {
    algorithm?: string;
    challenge?: string;
    number?: number;
    salt?: string;
    signature?: string;
  };

  try {
    const jsonStr = Buffer.from(rawPayload, 'base64').toString('utf8');
    parsed = JSON.parse(jsonStr) as typeof parsed;
  } catch {
    return { verified: false, reason: 'invalid' };
  }

  const signature = parsed.signature;
  const challengeStr = parsed.challenge;
  const numberVal = parsed.number;
  const saltStr = parsed.salt;

  if (
    typeof signature !== 'string' ||
    typeof challengeStr !== 'string' ||
    typeof numberVal !== 'number' ||
    typeof saltStr !== 'string'
  ) {
    return { verified: false, reason: 'invalid' };
  }

  // 1. Verify solution and HMAC signature with altcha-lib (without auto expiration check so we can differentiate)
  const isValid = await altchaVerifySolution(rawPayload, secret, false);
  if (!isValid) {
    return { verified: false, reason: 'invalid' };
  }

  // 2. Extract salt parameters
  const params = extractParams(rawPayload);

  // 3. Expiry check (AC-7)
  const expiresParam = params.expires ?? params.expire ?? '0';
  const expiresSec = parseInt(expiresParam, 10);
  if (expiresSec > 0 && expiresSec * 1000 <= now) {
    return { verified: false, reason: 'expired' };
  }

  // 4. Timing check (AC-6): at least 3 seconds elapsed between challenge issue and submission
  const issuedParam = params.issued ?? '0';
  const issuedMs = parseInt(issuedParam, 10);
  if (issuedMs > 0 && now - issuedMs < POW_MIN_DURATION_MS) {
    return { verified: false, reason: 'too_fast' };
  }

  // 5. Replay check (AC-5): compute SHA-256 of signature
  const signatureHash = crypto.createHash('sha256').update(signature).digest('hex');
  const expiresAt = expiresSec > 0 ? new Date(expiresSec * 1000) : new Date(now + POW_EXPIRY_MS);

  const { replayed } = await recordChallengeUsage(signatureHash, expiresAt, client);
  if (replayed) {
    return { verified: false, reason: 'pow_replay' };
  }

  return { verified: true };
}

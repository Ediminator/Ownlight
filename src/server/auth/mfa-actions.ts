'use server';

import 'server-only';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { eq, and, isNull, count } from 'drizzle-orm';
import { db, type DbClient } from '@/server/db/client';
import {
  user,
  account,
  session,
  verification,
  totpCredential,
  recoveryCode,
  passkeyCredential,
} from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { getStudioSettings } from '@/server/settings/repo';
import { requireOwner } from './guards';
import { assertFreshReauthentication } from './reauth';
import {
  rotateSession,
  revokeSession,
  getSessionCookieAttributes,
  shouldUseSecureCookies,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from './session';
import {
  checkMfaRateLimit,
  recordMfaFailure,
  recordMfaSuccess,
  anonymizeIp,
  RateLimitUnavailableError,
} from './rate-limiter';
import { resolveClientIp } from '@/server/http/client-ip';
import { logger } from '@/server/log';
import {
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  getOtpauthUri,
  generateTotpQrSvg,
  verifyTotpCode,
  generateRecoveryCodes,
  verifyRecoveryCode,
} from './totp';
import {
  getWebAuthnConfig,
  generateWebAuthnChallenge,
  createRegistrationOptions,
  createAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from './webauthn';
import { verifyPasswordArgon2id } from './passwords/policy';
import { audit } from '@/server/audit';

export type ActionResult<T = unknown> =
  | { success: true; data?: T; error?: never; code?: never }
  | { success: false; error: string; code?: string; data?: never };

// Strict Zod input validation schemas (I1-S08)
const reauthenticateSchema = z
  .object({
    password: z.string().min(1, 'INVALID_INPUT').max(1024, 'INVALID_INPUT'),
  })
  .strict();

const verifyTotpSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'INVALID_CODE'),
  })
  .strict();

const verifyMfaTotpSchema = z
  .object({
    mfaTicket: z.string().min(1, 'INVALID_INPUT'),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'INVALID_CODE'),
  })
  .strict();

const verifyMfaRecoveryCodeSchema = z
  .object({
    mfaTicket: z.string().min(1, 'INVALID_INPUT'),
    recoveryCode: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{4}-[0-9a-f]{4}$/i, 'INVALID_RECOVERY_CODE'),
  })
  .strict();

const completePasskeyRegistrationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Passkey name must be between 1 and 255 characters.')
      .max(255, 'Passkey name must be between 1 and 255 characters.'),
    response: z.custom<RegistrationResponseJSON>(
      (val) => typeof val === 'object' && val !== null && 'id' in (val as Record<string, unknown>),
      'INVALID_INPUT',
    ),
  })
  .strict();

const deletePasskeySchema = z
  .object({
    passkeyId: z.string().min(1, 'INVALID_INPUT').max(255, 'INVALID_INPUT'),
  })
  .strict();

const completePasskeyAuthenticationSchema = z
  .object({
    challenge: z.string().min(1, 'INVALID_INPUT'),
    response: z.custom<AuthenticationResponseJSON>(
      (val) => typeof val === 'object' && val !== null && 'id' in (val as Record<string, unknown>),
      'INVALID_INPUT',
    ),
  })
  .strict();

const revokeSessionSchema = z
  .object({
    sessionId: z.string().min(1, 'INVALID_INPUT').max(255, 'INVALID_INPUT'),
  })
  .strict();

/**
 * Helper to determine client IP address from Next.js request headers via trusted proxy resolver.
 */
async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    return resolveClientIp(h) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Helper to set session cookie on the response.
 */
async function setSessionCookie(token: string): Promise<void> {
  const isProd = shouldUseSecureCookies();
  const attrs = getSessionCookieAttributes(isProd);
  const cookieStore = await cookies();
  cookieStore.set(attrs.name, token, {
    httpOnly: attrs.httpOnly,
    sameSite: attrs.sameSite,
    secure: attrs.secure,
    path: attrs.path,
    maxAge: attrs.maxAge,
  });
}

/**
 * Re-authentication action (Sensitive operation step-up).
 * Confirms owner's password and refreshes session.lastReauthenticatedAt.
 */
export async function reauthenticateAction(
  formData: { password: string },
  client: DbClient = db,
): Promise<ActionResult> {
  const parsed = reauthenticateSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: 'Invalid password format.', code: 'INVALID_INPUT' };
  }

  const context = await requireOwner({ client });

  const accountRows = await client
    .select()
    .from(account)
    .where(eq(account.userId, context.user.id))
    .limit(1);

  const acc = accountRows[0];
  if (!acc?.password) {
    return { success: false, error: 'No password credential found.', code: 'INVALID_PASSWORD' };
  }

  const passwordMatch = await verifyPasswordArgon2id(acc.password, parsed.data.password);
  if (!passwordMatch) {
    return { success: false, error: 'Invalid password.', code: 'INVALID_PASSWORD' };
  }

  // Refresh lastReauthenticatedAt on the active session
  if (context.session?.id) {
    await client
      .update(session)
      .set({
        lastReauthenticatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(session.id, context.session.id));
  }

  return { success: true };
}

/**
 * Initiates TOTP enrolment.
 * Generates an unverified secret, stores it encrypted, and returns otpauth URI + local SVG QR code.
 */
export async function startTotpEnrolmentAction(
  client: DbClient = db,
): Promise<ActionResult<{ secret: string; qrSvg: string; otpauthUri: string }>> {
  const context = await requireOwner({ client });

  // Check if TOTP is already verified
  const existingTotp = await client
    .select()
    .from(totpCredential)
    .where(eq(totpCredential.userId, context.user.id))
    .limit(1);

  if (existingTotp[0]?.verified) {
    return { success: false, error: 'TOTP is already enabled on this account.' };
  }

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const now = new Date();

  if (existingTotp[0]) {
    await client
      .update(totpCredential)
      .set({
        secretEncrypted: encrypted,
        verified: false,
        lastUsedStep: 0,
        updatedAt: now,
      })
      .where(eq(totpCredential.id, existingTotp[0].id));
  } else {
    await client.insert(totpCredential).values({
      userId: context.user.id,
      secretEncrypted: encrypted,
      verified: false,
      lastUsedStep: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  const otpauthUri = getOtpauthUri(secret, context.user.email, 'Ownlight');
  const qrSvg = generateTotpQrSvg(otpauthUri);

  return {
    success: true,
    data: {
      secret,
      qrSvg,
      otpauthUri,
    },
  };
}

/**
 * Verifies the first code before activating TOTP (AC-1).
 * On success, marks verified, generates 10 recovery codes, and enables studio MFA requirement.
 */
export async function verifyAndEnableTotpAction(
  formData: { code: string },
  client: DbClient = db,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const parsed = verifyTotpSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: 'Invalid verification code.', code: 'INVALID_CODE' };
  }

  try {
    const context = await requireOwner({ client });
    const ip = await getClientIp();

    // Rate limiting check (AC-4)
    const rateLimitStatus = await checkMfaRateLimit(context.user.email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }

    const totpRows = await client
      .select()
      .from(totpCredential)
      .where(eq(totpCredential.userId, context.user.id))
      .limit(1);

    const cred = totpRows[0];
    if (!cred) {
      return {
        success: false,
        error: 'No TOTP enrolment in progress.',
        code: 'ENROLMENT_NOT_FOUND',
      };
    }

    let plainSecret: string;
    try {
      plainSecret = decryptTotpSecret(cred.secretEncrypted);
    } catch {
      return { success: false, error: 'Failed to decrypt TOTP secret.', code: 'DECRYPT_FAILED' };
    }

    const verificationResult = verifyTotpCode(plainSecret, parsed.data.code, cred.lastUsedStep);
    if (!verificationResult.valid || verificationResult.step === undefined) {
      await recordMfaFailure(context.user.email, ip, client);
      return {
        success: false,
        error: 'Invalid verification code. Please check your authenticator app and try again.',
        code: 'INVALID_CODE',
      };
    }

    // Clear rate limits upon successful verification
    await recordMfaSuccess(context.user.email, client);

    const now = new Date();

    // 1. Mark TOTP credential active and verified
    await client
      .update(totpCredential)
      .set({
        verified: true,
        lastUsedStep: verificationResult.step,
        updatedAt: now,
      })
      .where(eq(totpCredential.id, cred.id));

    // 2. Generate 10 single-use recovery codes
    // Remove any obsolete recovery codes first
    await client.delete(recoveryCode).where(eq(recoveryCode.userId, context.user.id));

    const { plaintext, records } = generateRecoveryCodes(10);
    for (const r of records) {
      await client.insert(recoveryCode).values({
        userId: context.user.id,
        codeHash: r.codeHash,
        salt: r.salt,
        usedAt: null,
        createdAt: now,
      });
    }

    // 3. Update studio settings: default MFA requirement on
    try {
      const currentSettings = await getStudioSettings(client);
      await client
        .update(studioSettings)
        .set({
          mfa_required: true,
          updated_at: now,
        })
        .where(eq(studioSettings.id, currentSettings.id));
    } catch {
      // Non-fatal if studioSettings record is not yet present
    }

    // 4. Audit logging
    try {
      await audit(
        {
          actorType: 'owner',
          actorId: context.user.id,
          action: 'auth.mfa.totp_enabled',
          targetType: 'user',
          targetId: context.user.id,
          outcome: 'success',
          metadata: {
            user_id: context.user.id,
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      data: {
        recoveryCodes: plaintext,
      },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }
    throw err;
  }
}

/**
 * Disables TOTP and cleans up recovery codes.
 * Requires fresh re-authentication (≤ 5 minutes) (AC-6).
 */
export async function disableTotpAction(client: DbClient = db): Promise<ActionResult> {
  const context = await requireOwner({ client });
  const ip = await getClientIp();

  try {
    await assertFreshReauthentication(context.user.id, client);
  } catch {
    return {
      success: false,
      error: 'Re-authentication required. Please enter your password to proceed.',
      code: 'REAUTH_REQUIRED',
    };
  }

  await client.delete(totpCredential).where(eq(totpCredential.userId, context.user.id));
  await client.delete(recoveryCode).where(eq(recoveryCode.userId, context.user.id));

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.mfa.totp_disabled',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          user_id: context.user.id,
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }

  return { success: true };
}

/**
 * Regenerates recovery codes.
 * Invalidates all previous codes and returns 10 new codes shown once (AC-3).
 * Requires fresh re-authentication (≤ 5 minutes) (AC-6).
 */
export async function regenerateRecoveryCodesAction(
  client: DbClient = db,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const context = await requireOwner({ client });
  const ip = await getClientIp();

  try {
    await assertFreshReauthentication(context.user.id, client);
  } catch {
    return {
      success: false,
      error: 'Re-authentication required. Please enter your password to proceed.',
      code: 'REAUTH_REQUIRED',
    };
  }

  // Delete all existing codes
  await client.delete(recoveryCode).where(eq(recoveryCode.userId, context.user.id));

  const { plaintext, records } = generateRecoveryCodes(10);
  const now = new Date();

  for (const r of records) {
    await client.insert(recoveryCode).values({
      userId: context.user.id,
      codeHash: r.codeHash,
      salt: r.salt,
      usedAt: null,
      createdAt: now,
    });
  }

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.mfa.recovery_codes_regenerated',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          user_id: context.user.id,
          count: 10,
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    data: {
      recoveryCodes: plaintext,
    },
  };
}

/**
 * Verifies TOTP during second-factor sign-in challenge (AC-2).
 */
export async function verifyMfaTotpAction(
  formData: { mfaTicket: string; code: string },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  const parsed = verifyMfaTotpSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid verification code.',
      code: 'INVALID_CODE',
    };
  }
  try {
    const ip = await getClientIp();

    // 1. Look up mfaTicket in verification table
    const ticketRows = await client
      .select()
      .from(verification)
      .where(eq(verification.identifier, `mfa_ticket:${parsed.data.mfaTicket}`))
      .limit(1);

    const ticket = ticketRows[0];
    if (!ticket || ticket.expiresAt.getTime() <= Date.now()) {
      return {
        success: false,
        error: 'MFA verification session has expired. Please sign in again.',
        code: 'MFA_EXPIRED',
      };
    }

    const userId = ticket.value;
    const userRows = await client.select().from(user).where(eq(user.id, userId)).limit(1);
    const existingUser = userRows[0];
    if (!existingUser) {
      return { success: false, error: 'User not found.', code: 'INVALID_INPUT' };
    }

    // 2. Check MFA rate limits (AC-4)
    const rateLimitStatus = await checkMfaRateLimit(existingUser.email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }

    // 3. Look up active TOTP credential
    const credRows = await client
      .select()
      .from(totpCredential)
      .where(and(eq(totpCredential.userId, existingUser.id), eq(totpCredential.verified, true)))
      .limit(1);

    const cred = credRows[0];
    if (!cred) {
      return {
        success: false,
        error: 'No active TOTP credential found.',
        code: 'INVALID_CREDENTIAL',
      };
    }

    let plainSecret: string;
    try {
      plainSecret = decryptTotpSecret(cred.secretEncrypted);
    } catch {
      return { success: false, error: 'Failed to decrypt TOTP secret.', code: 'DECRYPT_FAILED' };
    }

    // 4. Verify code with ±1 tolerance window and replay check (AC-2)
    const result = verifyTotpCode(plainSecret, parsed.data.code, cred.lastUsedStep);
    if (!result.valid || result.step === undefined) {
      await recordMfaFailure(existingUser.email, ip, client);
      return {
        success: false,
        error: 'Invalid or replayed verification code.',
        code: 'INVALID_CODE',
      };
    }

    // 5. Success: update lastUsedStep to prevent replay (AC-2)
    await recordMfaSuccess(existingUser.email, client);
    await client
      .update(totpCredential)
      .set({
        lastUsedStep: result.step,
        updatedAt: new Date(),
      })
      .where(eq(totpCredential.id, cred.id));

    // 6. Consume ticket
    await client.delete(verification).where(eq(verification.id, ticket.id));

    // 7. Establish authenticated session
    let oldToken: string | undefined;
    try {
      const cookieStore = await cookies();
      oldToken =
        cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
        cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      oldToken = undefined;
    }

    const newSession = await rotateSession(oldToken, existingUser.id, client, {
      ipAddress: anonymizeIp(ip),
    });
    await setSessionCookie(newSession.token);

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: existingUser.id,
          action: 'auth.sign_in.success',
          targetType: 'session',
          targetId: newSession.id,
          outcome: 'success',
          metadata: {
            session_id: newSession.id,
            auth_method: 'totp',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      data: {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
      },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }
    throw err;
  }
}

/**
 * Verifies a single-use recovery code during second-factor sign-in (AC-3).
 */
export async function verifyMfaRecoveryCodeAction(
  formData: { mfaTicket: string; recoveryCode: string },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  const parsed = verifyMfaRecoveryCodeSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid recovery code format.',
      code: 'INVALID_RECOVERY_CODE',
    };
  }
  try {
    const ip = await getClientIp();

    const ticketRows = await client
      .select()
      .from(verification)
      .where(eq(verification.identifier, `mfa_ticket:${parsed.data.mfaTicket}`))
      .limit(1);

    const ticket = ticketRows[0];
    if (!ticket || ticket.expiresAt.getTime() <= Date.now()) {
      return {
        success: false,
        error: 'MFA verification session has expired. Please sign in again.',
        code: 'MFA_EXPIRED',
      };
    }

    const userId = ticket.value;
    const userRows = await client.select().from(user).where(eq(user.id, userId)).limit(1);
    const existingUser = userRows[0];
    if (!existingUser) {
      return { success: false, error: 'User not found.', code: 'INVALID_INPUT' };
    }

    const rateLimitStatus = await checkMfaRateLimit(existingUser.email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }

    // Look up unused recovery codes
    const unusedCodes = await client
      .select()
      .from(recoveryCode)
      .where(and(eq(recoveryCode.userId, existingUser.id), isNull(recoveryCode.usedAt)));

    const result = verifyRecoveryCode(parsed.data.recoveryCode, unusedCodes);
    if (!result.valid || !result.matchedId) {
      await recordMfaFailure(existingUser.email, ip, client);
      return {
        success: false,
        error: 'Invalid recovery code. Each recovery code can only be used once.',
        code: 'INVALID_RECOVERY_CODE',
      };
    }

    // Consume code
    const now = new Date();
    await client
      .update(recoveryCode)
      .set({ usedAt: now })
      .where(eq(recoveryCode.id, result.matchedId));

    await recordMfaSuccess(existingUser.email, client);
    await client.delete(verification).where(eq(verification.id, ticket.id));

    // Establish session
    let oldToken: string | undefined;
    try {
      const cookieStore = await cookies();
      oldToken =
        cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
        cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      oldToken = undefined;
    }

    const newSession = await rotateSession(oldToken, existingUser.id, client, {
      ipAddress: anonymizeIp(ip),
    });
    await setSessionCookie(newSession.token);

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: existingUser.id,
          action: 'auth.mfa.recovery_code_used',
          targetType: 'user',
          targetId: existingUser.id,
          outcome: 'success',
          metadata: {
            user_id: existingUser.id,
            code_id: result.matchedId,
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );

      await audit(
        {
          actorType: 'owner',
          actorId: existingUser.id,
          action: 'auth.sign_in.success',
          targetType: 'session',
          targetId: newSession.id,
          outcome: 'success',
          metadata: {
            session_id: newSession.id,
            auth_method: 'recovery_code',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      data: {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
      },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Too many failed MFA verification attempts. Please try again later.',
        code: 'RATE_LIMITED',
      };
    }
    throw err;
  }
}

/**
 * Initiates WebAuthn passkey registration.
 */
export async function startPasskeyRegistrationAction(
  client: DbClient = db,
): Promise<ActionResult<{ options: ReturnType<typeof createRegistrationOptions> }>> {
  const context = await requireOwner({ client });
  const challenge = generateWebAuthnChallenge();
  const config = getWebAuthnConfig();

  // Save challenge in verification table with 5 min TTL
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  await client.insert(verification).values({
    identifier: `passkey_reg:${context.user.id}`,
    value: challenge,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const options = createRegistrationOptions(
    { id: context.user.id, email: context.user.email, name: context.user.name },
    challenge,
    config.rpId,
    config.rpName,
  );

  return {
    success: true,
    data: { options },
  };
}

/**
 * Completes WebAuthn passkey registration.
 */
export async function completePasskeyRegistrationAction(
  formData: { name: string; response: RegistrationResponseJSON },
  client: DbClient = db,
): Promise<ActionResult<{ passkey: { id: string; name: string; createdAt: Date } }>> {
  const parsed = completePasskeyRegistrationSchema.safeParse(formData);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message;
    return { success: false, error: firstIssue ?? 'Invalid input.', code: 'INVALID_INPUT' };
  }

  const context = await requireOwner({ client });
  const ip = await getClientIp();

  const trimmedName = parsed.data.name.trim();

  // Look up challenge
  const challengeRows = await client
    .select()
    .from(verification)
    .where(eq(verification.identifier, `passkey_reg:${context.user.id}`))
    .limit(1);

  const challengeRecord = challengeRows[0];
  if (!challengeRecord || challengeRecord.expiresAt.getTime() <= Date.now()) {
    return {
      success: false,
      error: 'Passkey registration session expired. Please try again.',
      code: 'CHALLENGE_EXPIRED',
    };
  }

  try {
    const config = getWebAuthnConfig();
    const result = await verifyRegistrationResponse({
      response: parsed.data.response,
      expectedChallenge: challengeRecord.value,
      expectedOrigin: config.origin,
      expectedRpId: config.rpId,
    });

    const now = new Date();
    const [inserted] = await client
      .insert(passkeyCredential)
      .values({
        userId: context.user.id,
        name: trimmedName,
        credentialId: result.credentialId,
        publicKey: result.publicKeyPem,
        counter: result.counter,
        transports: parsed.data.response.response.transports?.join(',') ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!inserted) {
      return { success: false, error: 'Failed to store passkey credential.' };
    }

    // Clean up challenge
    await client.delete(verification).where(eq(verification.id, challengeRecord.id));

    // Update studioSettings: MFA required default on
    try {
      const currentSettings = await getStudioSettings(client);
      await client
        .update(studioSettings)
        .set({
          mfa_required: true,
          updated_at: now,
        })
        .where(eq(studioSettings.id, currentSettings.id));
    } catch {
      // Non-fatal
    }

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: context.user.id,
          action: 'auth.mfa.passkey_registered',
          targetType: 'user',
          targetId: context.user.id,
          outcome: 'success',
          metadata: {
            user_id: context.user.id,
            passkey_id: inserted.id,
            passkey_name: inserted.name,
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      data: {
        passkey: {
          id: inserted.id,
          name: inserted.name,
          createdAt: inserted.createdAt,
        },
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Passkey registration failed.',
    };
  }
}

/**
 * Deletes a registered passkey.
 * If deleting the user's last passkey, requires fresh re-authentication (≤ 5 min) (AC-6).
 */
export async function deletePasskeyAction(
  formData: { passkeyId: string },
  client: DbClient = db,
): Promise<ActionResult> {
  const parsed = deletePasskeySchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input.', code: 'INVALID_INPUT' };
  }

  const context = await requireOwner({ client });
  const ip = await getClientIp();

  const foundRows = await client
    .select()
    .from(passkeyCredential)
    .where(
      and(
        eq(passkeyCredential.id, parsed.data.passkeyId),
        eq(passkeyCredential.userId, context.user.id),
      ),
    )
    .limit(1);

  const passkey = foundRows[0];
  if (!passkey) {
    return { success: false, error: 'Passkey not found.', code: 'NOT_FOUND' };
  }

  // Count total passkeys for this user
  const allPasskeys = await client
    .select()
    .from(passkeyCredential)
    .where(eq(passkeyCredential.userId, context.user.id));

  // If this is the last passkey, require fresh re-authentication (AC-6)
  if (allPasskeys.length <= 1) {
    try {
      await assertFreshReauthentication(context.user.id, client);
    } catch {
      return {
        success: false,
        error:
          'Re-authentication required. Please enter your password to delete your last passkey.',
        code: 'REAUTH_REQUIRED',
      };
    }
  }

  await client.delete(passkeyCredential).where(eq(passkeyCredential.id, passkey.id));

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.mfa.passkey_deleted',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          user_id: context.user.id,
          passkey_id: passkey.id,
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }

  return { success: true };
}

/**
 * Lists all passkeys registered for the current owner.
 */
export async function listPasskeysAction(
  client: DbClient = db,
): Promise<ActionResult<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]>> {
  const context = await requireOwner({ client });

  const rows = await client
    .select({
      id: passkeyCredential.id,
      name: passkeyCredential.name,
      createdAt: passkeyCredential.createdAt,
      lastUsedAt: passkeyCredential.lastUsedAt,
    })
    .from(passkeyCredential)
    .where(eq(passkeyCredential.userId, context.user.id));

  return {
    success: true,
    data: rows,
  };
}

/**
 * Initiates passwordless sign-in with passkey (AC-5).
 */
export async function startPasskeyAuthenticationAction(
  client: DbClient = db,
): Promise<ActionResult<{ options: ReturnType<typeof createAuthenticationOptions> }>> {
  const challenge = generateWebAuthnChallenge();
  const config = getWebAuthnConfig();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  await client.insert(verification).values({
    identifier: `passkey_auth:${challenge}`,
    value: challenge,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const options = createAuthenticationOptions(challenge, config.rpId);
  return {
    success: true,
    data: { options },
  };
}

/**
 * Completes passwordless sign-in with passkey (AC-5).
 */
export async function completePasskeyAuthenticationAction(
  formData: { challenge: string; response: AuthenticationResponseJSON },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  const parsed = completePasskeyAuthenticationSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input.', code: 'INVALID_INPUT' };
  }

  const ip = await getClientIp();

  // Look up challenge
  const challengeRows = await client
    .select()
    .from(verification)
    .where(eq(verification.identifier, `passkey_auth:${parsed.data.challenge}`))
    .limit(1);

  const challengeRecord = challengeRows[0];
  if (!challengeRecord || challengeRecord.expiresAt.getTime() <= Date.now()) {
    return {
      success: false,
      error: 'Passkey sign-in session expired. Please try again.',
      code: 'CHALLENGE_EXPIRED',
    };
  }

  // Look up passkey by credentialId
  const credRows = await client
    .select()
    .from(passkeyCredential)
    .where(eq(passkeyCredential.credentialId, parsed.data.response.id))
    .limit(1);

  const cred = credRows[0];
  if (!cred) {
    return { success: false, error: 'Unrecognized passkey credential.', code: 'NOT_FOUND' };
  }

  const userRows = await client.select().from(user).where(eq(user.id, cred.userId)).limit(1);
  const existingUser = userRows[0];
  if (!existingUser) {
    return { success: false, error: 'User not found.', code: 'NOT_FOUND' };
  }

  const rateLimitStatus = await checkMfaRateLimit(existingUser.email, ip, client);
  if (!rateLimitStatus.allowed) {
    return {
      success: false,
      error: 'Too many failed sign-in attempts. Please try again later.',
      code: 'RATE_LIMITED',
    };
  }

  try {
    const config = getWebAuthnConfig();
    const result = await verifyAuthenticationResponse({
      response: parsed.data.response,
      publicKeyPem: cred.publicKey,
      prevCounter: cred.counter,
      expectedChallenge: challengeRecord.value,
      expectedOrigin: config.origin,
      expectedRpId: config.rpId,
    });

    const now = new Date();

    // Update counter and lastUsedAt
    await client
      .update(passkeyCredential)
      .set({
        counter: result.newCounter,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(passkeyCredential.id, cred.id));

    await recordMfaSuccess(existingUser.email, client);
    await client.delete(verification).where(eq(verification.id, challengeRecord.id));

    // Rotate session and set session cookie
    let oldToken: string | undefined;
    try {
      const cookieStore = await cookies();
      oldToken =
        cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
        cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      oldToken = undefined;
    }

    const newSession = await rotateSession(oldToken, existingUser.id, client, {
      ipAddress: anonymizeIp(ip),
    });
    await setSessionCookie(newSession.token);

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: existingUser.id,
          action: 'auth.sign_in.success',
          targetType: 'session',
          targetId: newSession.id,
          outcome: 'success',
          metadata: {
            session_id: newSession.id,
            auth_method: 'passkey',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      data: {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
      },
    };
  } catch (err) {
    await recordMfaFailure(existingUser.email, ip, client);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Passkey verification failed.',
    };
  }
}

/**
 * Returns overall MFA status for the authenticated owner and studio settings.
 */
export async function getMfaStatusAction(client: DbClient = db): Promise<
  ActionResult<{
    totpEnabled: boolean;
    passkeyCount: number;
    recoveryCodesRemaining: number;
    mfaRequired: boolean;
    mfaPostponedUntil: Date | null;
    hasMfa: boolean;
  }>
> {
  const context = await requireOwner({ client });

  const totpRows = await client
    .select()
    .from(totpCredential)
    .where(and(eq(totpCredential.userId, context.user.id), eq(totpCredential.verified, true)))
    .limit(1);

  const passkeys = await client
    .select({ count: count() })
    .from(passkeyCredential)
    .where(eq(passkeyCredential.userId, context.user.id));

  const recoveryCodes = await client
    .select({ count: count() })
    .from(recoveryCode)
    .where(and(eq(recoveryCode.userId, context.user.id), isNull(recoveryCode.usedAt)));

  const settings = await getStudioSettings(client);

  const totpEnabled = Boolean(totpRows[0]);
  const passkeyCount = passkeys[0]?.count ?? 0;
  const recoveryCodesRemaining = recoveryCodes[0]?.count ?? 0;
  const hasMfa = totpEnabled || passkeyCount > 0;

  return {
    success: true,
    data: {
      totpEnabled,
      passkeyCount,
      recoveryCodesRemaining,
      mfaRequired: settings.mfa_required,
      mfaPostponedUntil: settings.mfa_postponed_until,
      hasMfa,
    },
  };
}

/**
 * Postpones mandatory MFA enrolment by up to 7 days from now (AC-8).
 */
export async function postponeMfaAction(
  client: DbClient = db,
): Promise<ActionResult<{ postponedUntil: Date }>> {
  const context = await requireOwner({ client });
  const ip = await getClientIp();

  const settings = await getStudioSettings(client);
  const now = new Date();
  const maxPostpone = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await client
    .update(studioSettings)
    .set({
      mfa_postponed_until: maxPostpone,
      updated_at: now,
    })
    .where(eq(studioSettings.id, settings.id));

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.mfa.postponed',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          user_id: context.user.id,
          postponed_until: maxPostpone.toISOString(),
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    data: { postponedUntil: maxPostpone },
  };
}

/**
 * Lists active sessions for current owner with current session badge.
 */
export async function listActiveSessionsAction(client: DbClient = db): Promise<
  ActionResult<
    {
      id: string;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: Date;
      lastReauthenticatedAt: Date;
      isCurrent: boolean;
    }[]
  >
> {
  const context = await requireOwner({ client });

  let currentToken: string | undefined;
  try {
    const cookieStore = await cookies();
    currentToken =
      cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
      cookieStore.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    currentToken = undefined;
  }

  const rows = await client.select().from(session).where(eq(session.userId, context.user.id));

  return {
    success: true,
    data: rows.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastReauthenticatedAt: s.lastReauthenticatedAt,
      isCurrent: s.token === currentToken,
    })),
  };
}

/**
 * Revokes a session by ID for current owner.
 */
export async function revokeSessionByIdAction(
  formData: { sessionId: string },
  client: DbClient = db,
): Promise<ActionResult> {
  const parsed = revokeSessionSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: 'Invalid session ID.', code: 'INVALID_INPUT' };
  }

  const context = await requireOwner({ client });

  const rows = await client
    .select()
    .from(session)
    .where(and(eq(session.id, parsed.data.sessionId), eq(session.userId, context.user.id)))
    .limit(1);

  const target = rows[0];
  if (!target) {
    return { success: false, error: 'Session not found.', code: 'NOT_FOUND' };
  }

  await revokeSession(target.token, client);
  return { success: true };
}

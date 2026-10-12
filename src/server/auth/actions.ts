'use server';

import 'server-only';
import { cookies, headers } from 'next/headers';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db, type DbClient } from '@/server/db/client';
import {
  user,
  account,
  verification,
  totpCredential,
  passkeyCredential,
} from '@/server/db/schema/auth';
import { getStudioSettings } from '@/server/settings/repo';
import { verifyPasswordArgon2id, validatePasswordPolicy } from './passwords/policy';
import {
  checkSignInRateLimit,
  recordSignInFailure,
  recordSignInSuccess,
  anonymizeIp,
  consumeSetupRateLimit,
  consumePasswordResetRequestRateLimit,
  checkPasswordResetActionRateLimit,
  recordPasswordResetActionFailure,
  RateLimitUnavailableError,
} from './rate-limiter';
import { resolveClientIp } from '@/server/http/client-ip';
import { logger } from '@/server/log';
import {
  rotateSession,
  revokeSession,
  verifySession,
  signOutEverywhere,
  getSessionCookieAttributes,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from './session';
import { setupOwner } from './setup';
import { requestPasswordReset, resetPassword } from './password-reset';
import { requireOwner } from './guards';
import { env } from '@/env';
import { audit } from '@/server/audit';

export type ActionResult<T = unknown> =
  { success: true; data?: T; error?: never } | { success: false; error: string; data?: never };

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
  const isProd = process.env.NODE_ENV === 'production';
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
 * Helper to remove session cookie on the response.
 */
async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(SECURE_SESSION_COOKIE_NAME);
}

/**
 * Setup Owner Action (Public allowlisted; guarded by setup token & count=0).
 */
export async function setupOwnerAction(
  formData: {
    setupToken: string;
    name: string;
    email: string;
    password: string;
  },
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; name: string } }>> {
  const ip = await getClientIp();

  try {
    // Rate limiting on setup (TASK-0023: atomic single-statement consumption)
    const rateLimitStatus = await consumeSetupRateLimit(ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many setup attempts. Please try again later.',
      };
    }

    const owner = await setupOwner({ ...formData, client });
    const session = await rotateSession(null, owner.id, client, {
      ipAddress: anonymizeIp(ip), // I1-S05
    });
    await setSessionCookie(session.token);

    try {
      await audit(
        {
          actorType: 'system',
          actorId: owner.id,
          action: 'auth.setup.completed',
          targetType: 'user',
          targetId: owner.id,
          outcome: 'success',
          metadata: {
            owner_id: owner.id,
            setup_method: 'initial_bootstrap',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal if audit logging encounters a transient error
    }

    return {
      success: true,
      data: {
        user: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
        },
      },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Setup failed.',
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Setup failed.',
    };
  }
}

async function recordSignInAuditFailure(ip: string, client: DbClient): Promise<void> {
  try {
    await audit(
      {
        actorType: 'system',
        actorId: null,
        action: 'auth.sign_in.failure',
        targetType: 'user',
        outcome: 'failure',
        metadata: {
          failure_reason: 'invalid_credentials',
          ip_anonymized: anonymizeIp(ip),
        },
      },
      client,
    );
  } catch {
    // Non-fatal
  }
}

export interface SignInResult {
  user: { id: string; email: string; name: string };
  mfaRequired?: boolean;
  mfaTicket?: string;
  mfaEnforced?: boolean;
}

/**
 * Sign In Action (Public allowlisted; guarded by database-backed rate limiting).
 */
export async function signInAction(
  formData: {
    email: string;
    password: string;
  },
  client: DbClient = db,
): Promise<ActionResult<SignInResult>> {
  try {
    const normalizedEmail = formData.email.toLowerCase().trim();
    const ip = await getClientIp();

    // 1. Rate limiting check (survives restarts)
    const rateLimitStatus = await checkSignInRateLimit(normalizedEmail, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many failed attempts. Please try again later.',
      };
    }

    // 2. Query user by email
    const userRows = await client
      .select()
      .from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1);

    if (userRows.length === 0) {
      await recordSignInFailure(normalizedEmail, ip, client);
      await recordSignInAuditFailure(ip, client);
      // Generic error to prevent enumeration
      return {
        success: false,
        error: 'Invalid email or password.',
      };
    }

    const existingUser = userRows[0];
    if (!existingUser) {
      await recordSignInFailure(normalizedEmail, ip, client);
      await recordSignInAuditFailure(ip, client);
      return {
        success: false,
        error: 'Invalid email or password.',
      };
    }

    // 3. Query password hash from account
    const accountRows = await client
      .select()
      .from(account)
      .where(eq(account.userId, existingUser.id))
      .limit(1);

    const acc = accountRows[0];
    if (!acc?.password) {
      await recordSignInFailure(normalizedEmail, ip, client);
      await recordSignInAuditFailure(ip, client);
      return {
        success: false,
        error: 'Invalid email or password.',
      };
    }

    // 4. Verify password with Argon2id
    const passwordMatch = await verifyPasswordArgon2id(acc.password, formData.password);

    if (!passwordMatch) {
      await recordSignInFailure(normalizedEmail, ip, client);
      await recordSignInAuditFailure(ip, client);
      return {
        success: false,
        error: 'Invalid email or password.',
      };
    }

    // 5. Successful authentication
    await recordSignInSuccess(normalizedEmail, client);

    // 5b. Multi-Factor Authentication enforcement (AC-2)
    // If TOTP is active on this account, challenge for second factor before establishing session
    const activeTotp = await client
      .select()
      .from(totpCredential)
      .where(and(eq(totpCredential.userId, existingUser.id), eq(totpCredential.verified, true)))
      .limit(1);

    if (activeTotp.length > 0) {
      const mfaTicket = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

      await client.insert(verification).values({
        identifier: `mfa_ticket:${mfaTicket}`,
        value: existingUser.id,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      return {
        success: true,
        data: {
          user: {
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
          },
          mfaRequired: true,
          mfaTicket,
        },
      };
    }

    // Retrieve any pre-existing cookie to rotate session
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
            auth_method: 'password',
            ip_anonymized: anonymizeIp(ip),
          },
        },
        client,
      );
    } catch {
      // Non-fatal if audit logging encounters a transient error
    }

    let mfaEnforced = false;
    try {
      const settings = await getStudioSettings(client);
      if (settings.mfa_required) {
        const now = Date.now();
        const postponementExpired =
          !settings.mfa_postponed_until || settings.mfa_postponed_until.getTime() <= now;
        if (postponementExpired) {
          const passkeys = await client
            .select()
            .from(passkeyCredential)
            .where(eq(passkeyCredential.userId, existingUser.id))
            .limit(1);
          if (passkeys.length === 0) {
            mfaEnforced = true;
          }
        }
      }
    } catch {
      // Non-fatal if settings query encounters a transient error
    }

    return {
      success: true,
      data: {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
        mfaEnforced,
      },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Invalid email or password.',
      };
    }
    throw err;
  }
}

/**
 * Sign Out Action (Public allowlisted).
 */
export async function signOutAction(client: DbClient = db): Promise<ActionResult> {
  try {
    const cookieStore = await cookies();
    const token =
      cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
      cookieStore.get(SESSION_COOKIE_NAME)?.value;

    let sessionId: string | null = null;
    let actorId: string | null = null;

    if (token) {
      const verified = await verifySession(token, client);
      if (verified) {
        sessionId = verified.session.id;
        actorId = verified.user.id;
      }
      await revokeSession(token, client);
    }
    await clearSessionCookie();

    try {
      await audit(
        {
          actorType: 'owner',
          actorId,
          action: 'auth.sign_out.success',
          targetType: 'session',
          targetId: sessionId,
          outcome: 'success',
          metadata: {
            session_id: sessionId,
            everywhere: false,
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return { success: true };
  } catch {
    await clearSessionCookie();
    return { success: true };
  }
}

/**
 * Sign Out Everywhere Action (Protected; requires owner session).
 */
export async function signOutEverywhereAction(client: DbClient = db): Promise<ActionResult> {
  const context = await requireOwner({ client });
  await signOutEverywhere(context.user.id, client);
  await clearSessionCookie();

  try {
    await audit(
      {
        actorType: 'owner',
        actorId: context.user.id,
        action: 'auth.sign_out.success',
        targetType: 'user',
        targetId: context.user.id,
        outcome: 'success',
        metadata: {
          everywhere: true,
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
 * Request Password Reset Action (Public allowlisted).
 */
export async function requestPasswordResetAction(
  formData: {
    email: string;
  },
  options: {
    client?: DbClient;
    baseUrl?: string;
    transporter?: import('nodemailer').Transporter;
  } = {},
): Promise<ActionResult<{ message: string }>> {
  // 1. Fast format validation
  const email = formData.email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return {
      success: false,
      error: 'Invalid email address.',
    };
  }

  try {
    const client = options.client ?? db;
    const ip = await getClientIp();

    // 2. Rate limiting for password reset requests (TASK-0023: atomic single-statement consumption)
    const rateLimitStatus = await consumePasswordResetRequestRateLimit(email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many password reset requests. Please try again later.',
      };
    }

    let baseUrl = 'http://localhost:3000';
    try {
      baseUrl = env.AUTH_URL;
    } catch {
      baseUrl = process.env.AUTH_URL ?? baseUrl;
    }
    const result = await requestPasswordReset(email, {
      baseUrl: options.baseUrl ?? baseUrl,
      client,
      transporter: options.transporter,
    });

    try {
      await audit(
        {
          actorType: 'system',
          actorId: null,
          action: 'auth.password_reset.requested',
          outcome: 'success',
          metadata: {
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
      data: { message: result.message },
    };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Password reset request failed.',
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Password reset request failed.',
    };
  }
}

/**
 * Reset Password Action (Public allowlisted; guarded by single-use token).
 */
export async function resetPasswordAction(
  formData: {
    email: string;
    token: string;
    newPassword: string;
  },
  client: DbClient = db,
): Promise<ActionResult> {
  // 1. Validate password policy first before DB access
  const policy = validatePasswordPolicy(formData.newPassword);
  if (!policy.valid) {
    return {
      success: false,
      error: policy.message ?? 'Invalid password',
    };
  }

  try {
    const ip = await getClientIp();

    // 2. Rate limiting for reset action (I1-S04)
    const rateLimitStatus = await checkPasswordResetActionRateLimit(formData.email, ip, client);
    if (!rateLimitStatus.allowed) {
      return {
        success: false,
        error: 'Too many password reset attempts. Please try again later.',
      };
    }

    await resetPassword({ ...formData, client });

    try {
      await audit(
        {
          actorType: 'owner',
          actorId: null,
          action: 'auth.password_reset.completed',
          outcome: 'success',
          metadata: {
            duration_ms: 0,
          },
        },
        client,
      );
    } catch {
      // Non-fatal
    }

    return { success: true };
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      logger.error({ errorClass: 'RateLimitUnavailableError', err }, 'Rate limiter unavailable');
      return {
        success: false,
        error: 'Password reset failed.',
      };
    }
    try {
      const ip = await getClientIp();
      await recordPasswordResetActionFailure(formData.email, ip, client);
    } catch {
      // Ignore database connection errors during failure recording
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Password reset failed.',
    };
  }
}

/**
 * Protected action example verifying that guarded server actions enforce requireOwner().
 */
export async function getOwnerSessionInfoAction(
  client: DbClient = db,
): Promise<ActionResult<{ user: { id: string; email: string; role: string } }>> {
  const context = await requireOwner({ client });
  return {
    success: true,
    data: {
      user: {
        id: context.user.id,
        email: context.user.email,
        role: context.user.role,
      },
    },
  };
}

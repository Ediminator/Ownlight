import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { session, user, type User, type Session } from '@/server/db/schema/auth';

export const SESSION_COOKIE_NAME = 'ownlight_session';
export const SECURE_SESSION_COOKIE_NAME = '__Secure-ownlight_session';

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SESSION_IDLE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface CookieAttributes {
  name: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

/**
 * Determines whether the session cookie should have the Secure attribute and __Secure- prefix.
 * In production over HTTPS, returns true. When accessed over plain HTTP (e.g. self-hosted Synology
 * private LAN with AUTH_URL=http://...), returns false to prevent browsers dropping the cookie.
 */
export function shouldUseSecureCookies(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  authUrl: string | undefined = process.env.AUTH_URL,
): boolean {
  if (nodeEnv !== 'production') {
    return false;
  }
  if (typeof authUrl === 'string' && authUrl.trim().toLowerCase().startsWith('http://')) {
    return false;
  }
  return true;
}

/**
 * Returns security attributes for the session cookie adhering to OWASP ASVS V7.
 */
export function getSessionCookieAttributes(isProduction = false): CookieAttributes {
  return {
    name: isProduction ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Verifies a session token against the database and returns session + user.
 * Returns null if token is unknown, expired, or revoked.
 */
export async function verifySession(
  sessionToken: string,
  client: DbClient = defaultDb,
): Promise<{ session: Session; user: User } | null> {
  if (!sessionToken || typeof sessionToken !== 'string') return null;

  const now = new Date();
  const rows = await client
    .select({
      session,
      user,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.token, sessionToken), gt(session.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return row;
}

/**
 * Creates a brand-new session in the database for a user.
 */
export async function createSession(
  userId: string,
  client: DbClient = defaultDb,
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<Session> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  const [newSession] = await client
    .insert(session)
    .values({
      userId,
      token,
      expiresAt,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!newSession) {
    throw new Error('Failed to create session');
  }

  return newSession;
}

/**
 * Rotates an existing session (session fixation prevention).
 * Destroys any pre-existing session token and returns a newly created session.
 */
export async function rotateSession(
  oldSessionToken: string | null | undefined,
  userId: string,
  client: DbClient = defaultDb,
  metadata?: { ipAddress?: string; userAgent?: string },
): Promise<Session> {
  if (oldSessionToken) {
    await client.delete(session).where(eq(session.token, oldSessionToken));
  }
  return await createSession(userId, client, metadata);
}

/**
 * Revokes a single session.
 */
export async function revokeSession(
  sessionToken: string,
  client: DbClient = defaultDb,
): Promise<void> {
  if (!sessionToken) return;
  await client.delete(session).where(eq(session.token, sessionToken));
}

/**
 * Global sign-out: Invalidates all active sessions for a user across all devices.
 */
export async function signOutEverywhere(
  userId: string,
  client: DbClient = defaultDb,
): Promise<void> {
  if (!userId) return;
  await client.delete(session).where(eq(session.userId, userId));
}

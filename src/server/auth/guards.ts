import { headers, cookies } from 'next/headers';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { type User, type Session } from '@/server/db/schema/auth';
import { verifySession, SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME } from './session';
import { verifyApiKey, hasRequiredScopes, type ApiKeyWithScopes, API_KEY_PREFIX } from './api-keys';
import { eq } from 'drizzle-orm';
import { user } from '@/server/db/schema/auth';

export class UnauthorizedError extends Error {
  public readonly statusCode = 401;
  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  public readonly statusCode = 403;
  constructor(message = 'Insufficient permissions.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AuthContext {
  user: User;
  session?: Session;
  apiKey?: ApiKeyWithScopes;
  authType: 'session' | 'apiKey';
  scopes: string[];
}

export interface RequireAuthOptions {
  scopes?: readonly string[];
  headers?: Headers | Record<string, string | undefined>;
  client?: DbClient;
}

/**
 * Extracts Bearer token from headers if present.
 */
export function extractBearerToken(
  headerSource?: Headers | Record<string, string | undefined>,
): string | null {
  let authHeader: string | null | undefined = null;

  if (headerSource) {
    if (typeof (headerSource as Headers).get === 'function') {
      authHeader = (headerSource as Headers).get('authorization');
    } else {
      const record = headerSource as Record<string, string | undefined>;
      authHeader = record.authorization ?? record.Authorization;
    }
  }

  if (!authHeader) return null;

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
    return parts[1] ?? null;
  }

  return null;
}

export interface RequireSessionOptions {
  headers?: Headers | Record<string, string | undefined>;
  client?: DbClient;
}

/**
 * Extracts session token from next/headers cookies() or an explicit headers / Record object.
 */
export async function extractSessionToken(
  headerSource?: Headers | Record<string, string | undefined>,
): Promise<string | undefined> {
  let sessionToken: string | undefined;

  // Try extracting from next/headers cookies()
  try {
    const cookieStore = await cookies();
    sessionToken =
      cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
      cookieStore.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    // cookies() may throw outside Next.js request context (e.g. testing)
    sessionToken = undefined;
  }

  // If not found in cookieStore, try headers object directly if passed
  if (!sessionToken && headerSource) {
    const cookieHeader =
      typeof (headerSource as Headers).get === 'function'
        ? (headerSource as Headers).get('cookie')
        : (headerSource as Record<string, string | undefined>).cookie;

    if (cookieHeader) {
      const secureMatch = /__Secure-ownlight_session=([^;]+)/.exec(cookieHeader);
      const standardMatch = /ownlight_session=([^;]+)/.exec(cookieHeader);
      const match = secureMatch ?? standardMatch;
      if (match?.[1]) {
        sessionToken = match[1];
      }
    }
  }

  return sessionToken;
}

/**
 * Session-only authorization guard for the studio owner (ADR-0006, TASK-0015 AC-4).
 * Enforces cookie-based web session authentication ONLY.
 * Strictly excludes and ignores API keys / Bearer tokens to prevent CodeQL CWE-807 bypass alerts.
 */
export async function requireOwnerSession(
  options: RequireSessionOptions = {},
): Promise<AuthContext> {
  const client = options.client ?? defaultDb;

  let headerSource = options.headers;
  if (!headerSource) {
    try {
      headerSource = await headers();
    } catch {
      headerSource = undefined;
    }
  }

  const sessionToken = await extractSessionToken(headerSource);
  if (!sessionToken) {
    throw new UnauthorizedError('Authentication required. Active web session required.');
  }

  const sessionResult = await verifySession(sessionToken, client);
  if (!sessionResult) {
    throw new UnauthorizedError('Invalid or expired session.');
  }

  if (sessionResult.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required for this action.');
  }

  return {
    user: sessionResult.user,
    session: sessionResult.session,
    authType: 'session',
    scopes: ['*'],
  };
}

export const requireOwnerWebSession = requireOwnerSession;

/**
 * Central authorization guard (ADR-0006).
 * Accepts either:
 * 1. Bearer API key (validated against SHA-256 hash in DB and required scopes)
 * 2. Active owner web session cookie (grants all scopes)
 */
export async function requireAuth(options: RequireAuthOptions = {}): Promise<AuthContext> {
  const client = options.client ?? defaultDb;

  // Inspect explicit options.headers or fall back to next/headers headers()
  let headerSource = options.headers;
  if (!headerSource) {
    try {
      headerSource = await headers();
    } catch {
      headerSource = undefined;
    }
  }

  // 1. Check Bearer API Token
  const bearerToken = extractBearerToken(headerSource);
  if (bearerToken) {
    if (!bearerToken.startsWith(API_KEY_PREFIX)) {
      throw new UnauthorizedError('Malformed API key format.');
    }

    const verification = await verifyApiKey(bearerToken, client);
    if (!verification.valid || !verification.key) {
      if (verification.error === 'expired') {
        throw new UnauthorizedError('API key has expired.');
      }
      if (verification.error === 'revoked') {
        throw new UnauthorizedError('API key has been revoked.');
      }
      throw new UnauthorizedError('Invalid API key.');
    }

    const key = verification.key;

    // Check scope enforcement
    if (options.scopes && !hasRequiredScopes(key.scopes, options.scopes)) {
      throw new ForbiddenError(
        `Insufficient permissions. Required scope(s): ${options.scopes.join(', ')}`,
      );
    }

    // Load user record
    const userRows = await client.select().from(user).where(eq(user.id, key.userId)).limit(1);
    const foundUser = userRows[0];
    if (!foundUser) {
      throw new UnauthorizedError('User associated with API key not found.');
    }

    return {
      user: foundUser,
      apiKey: key,
      authType: 'apiKey',
      scopes: key.scopes,
    };
  }

  // 2. Check Web Session Cookie
  const sessionToken = await extractSessionToken(headerSource);
  if (!sessionToken) {
    throw new UnauthorizedError('Authentication required. No session or API key provided.');
  }

  const sessionResult = await verifySession(sessionToken, client);
  if (!sessionResult) {
    throw new UnauthorizedError('Invalid or expired session.');
  }

  return {
    user: sessionResult.user,
    session: sessionResult.session,
    authType: 'session',
    scopes: ['*'], // Full access for active web session
  };
}

/**
 * Restricts access strictly to the studio owner.
 */
export async function requireOwner(
  options: Omit<RequireAuthOptions, 'scopes'> = {},
): Promise<AuthContext> {
  const context = await requireAuth(options);
  if (context.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required for this action.');
  }

  // If authenticated via API key, it must possess full administrative scope ('*' or 'admin')
  if (context.authType === 'apiKey') {
    const hasAdminScope = context.scopes.includes('*') || context.scopes.includes('admin');
    if (!hasAdminScope) {
      throw new ForbiddenError('API key lacks administrative scope required for this action.');
    }
  }

  return context;
}

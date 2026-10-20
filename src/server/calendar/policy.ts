import {
  requireAuth,
  type AuthContext,
  type RequireAuthOptions,
  ForbiddenError,
} from '@/server/auth/guards';
import { CALENDAR_READ, CALENDAR_WRITE } from '@/server/auth/scopes';
import type { DbClient } from '@/server/db/client';

function isAuthContext(value: unknown): value is AuthContext {
  return value !== null && typeof value === 'object' && 'user' in value;
}

/**
 * Authorizes read access to the calendar domain (ADR-0017).
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'calendar:read' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 */
export async function authorizeCalendarRead(
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  if (context.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required to read calendar resources.');
  }

  const hasScope = context.scopes.includes('*') || context.scopes.includes(CALENDAR_READ);
  if (!hasScope) {
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${CALENDAR_READ}`);
  }

  return context;
}

/**
 * Authorizes write access to the calendar domain (ADR-0017).
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'calendar:write' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 */
export async function authorizeCalendarWrite(
  action: string,
  targetId?: string | null,
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  if (context.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required to modify calendar resources.');
  }

  const hasScope = context.scopes.includes('*') || context.scopes.includes(CALENDAR_WRITE);
  if (!hasScope) {
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${CALENDAR_WRITE}`);
  }

  return context;
}

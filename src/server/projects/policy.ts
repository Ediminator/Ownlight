import {
  requireAuth,
  requireOwner,
  type AuthContext,
  type RequireAuthOptions,
  ForbiddenError,
} from '@/server/auth/guards';
import { PROJECTS_READ, PROJECTS_WRITE } from '@/server/auth/scopes';
import { audit } from '@/server/audit';
import type { DbClient } from '@/server/db/client';

function isAuthContext(value: unknown): value is AuthContext {
  return value !== null && typeof value === 'object' && 'user' in value;
}

/**
 * Authorizes read access to the projects domain (ADR-0006, ADR-0016).
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'projects:read' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 */
export async function authorizeProjectRead(
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  if (context.user.role !== 'owner') {
    throw new ForbiddenError('Owner role required to read project resources.');
  }

  const hasScope = context.scopes.includes('*') || context.scopes.includes(PROJECTS_READ);
  if (!hasScope) {
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${PROJECTS_READ}`);
  }

  return context;
}

/**
 * Authorizes write access to the projects domain (ADR-0006, ADR-0016).
 * - Callers must be authenticated with role === 'owner'.
 * - Bearer API keys must possess 'projects:write' or '*' scope.
 * - Web sessions implicitly hold full scopes ('*').
 * - On authorization denial of an authenticated actor, an audit event with outcome: 'denied' is recorded.
 */
export async function authorizeProjectWrite(
  action: string,
  targetId?: string | null,
  contextOrOptions?: AuthContext | RequireAuthOptions,
  dbClient?: DbClient,
): Promise<AuthContext> {
  const context = isAuthContext(contextOrOptions)
    ? contextOrOptions
    : await requireAuth({ ...(contextOrOptions ?? {}), client: dbClient });

  if (context.user.role !== 'owner') {
    if (context.authType === 'apiKey') {
      try {
        await audit(
          {
            action,
            actorType: 'token',
            actorId: context.apiKey?.id ?? null,
            targetType: 'project',
            targetId: targetId ?? null,
            outcome: 'denied',
            metadata: null,
          },
          dbClient,
        );
      } catch {
        // Suppress secondary audit error during auth denial
      }
    }
    throw new ForbiddenError('Owner role required to write project resources.');
  }

  const hasScope = context.scopes.includes('*') || context.scopes.includes(PROJECTS_WRITE);
  if (!hasScope) {
    if (context.authType === 'apiKey') {
      try {
        await audit(
          {
            action,
            actorType: 'token',
            actorId: context.apiKey?.id ?? null,
            targetType: 'project',
            targetId: targetId ?? null,
            outcome: 'denied',
            metadata: null,
          },
          dbClient,
        );
      } catch {
        // Suppress secondary audit error during auth denial
      }
    }
    throw new ForbiddenError(`Insufficient permissions. Required scope: ${PROJECTS_WRITE}`);
  }

  return context;
}

export { requireOwner };

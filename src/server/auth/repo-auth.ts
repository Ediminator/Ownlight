import { db as defaultDb, type DbClient } from '@/server/db/client';
import { requireOwner, type AuthContext } from '@/server/auth/guards';

export class UnauthenticatedError extends Error {
  public readonly code = 'UNAUTHENTICATED';
  public readonly statusCode = 401;
  constructor(message = 'UNAUTHENTICATED') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

export type RepoAuthInput =
  AuthContext | { auth?: AuthContext | null; client?: DbClient } | DbClient | null | undefined;

/**
 * Resolves authentication and database client for repository operations.
 * Enforces studio owner role and throws typed UnauthenticatedError('UNAUTHENTICATED')
 * when authentication fails or caller lacks owner privileges.
 */
export async function resolveRepoAuth(
  authOrOptions?: RepoAuthInput,
  explicitClient?: DbClient,
): Promise<{ auth: AuthContext; client: DbClient }> {
  // 1. Direct AuthContext passed
  if (authOrOptions && 'user' in authOrOptions && 'authType' in authOrOptions) {
    if (authOrOptions.user.role !== 'owner') {
      throw new UnauthenticatedError('UNAUTHENTICATED');
    }
    return { auth: authOrOptions, client: explicitClient ?? defaultDb };
  }

  // 2. Options object with explicit { auth, client }
  if (
    authOrOptions &&
    typeof authOrOptions === 'object' &&
    ('auth' in authOrOptions || 'client' in authOrOptions)
  ) {
    const client = authOrOptions.client ?? explicitClient ?? defaultDb;

    if (authOrOptions.auth !== undefined) {
      if (authOrOptions.auth?.user.role !== 'owner') {
        throw new UnauthenticatedError('UNAUTHENTICATED');
      }
      return { auth: authOrOptions.auth, client };
    }

    // auth was not explicitly provided in options object -> delegate to requireOwner
    try {
      const auth = await requireOwner({ client });
      return { auth, client };
    } catch {
      throw new UnauthenticatedError('UNAUTHENTICATED');
    }
  }

  // 3. authOrOptions is a DbClient or null/undefined
  const isClient =
    authOrOptions !== null &&
    authOrOptions !== undefined &&
    typeof authOrOptions === 'object' &&
    ('select' in authOrOptions || 'query' in authOrOptions || 'transaction' in authOrOptions);

  const client = (isClient ? authOrOptions : explicitClient) ?? defaultDb;

  try {
    const auth = await requireOwner({ client });
    return { auth, client };
  } catch {
    throw new UnauthenticatedError('UNAUTHENTICATED');
  }
}

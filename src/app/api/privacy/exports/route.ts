import { NextRequest, NextResponse } from 'next/server';
import { db, type DbClient } from '@/server/db/client';
import {
  requireOwner,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import { assertFreshReauthentication } from '@/server/auth/reauth';
import { exportRequestSchema } from '@/server/privacy/export/schema';
import { generateExport } from '@/server/privacy/export/service';
import { env, clientEnv } from '@/env';

export const dynamic = 'force-dynamic';

/**
 * Handles DSAR data export generation requests (AC-3, AC-4, AC-6, AC-7).
 *
 * Enforces:
 * - Same-origin check
 * - Owner web session authentication (API keys strictly forbidden)
 * - Fresh step-up re-authentication within 5 minutes
 * - Strict input schema parsing
 * - Streaming response without server-side file persistence
 */
export async function POST(
  request: NextRequest,
  options?: { client?: DbClient },
): Promise<Response> {
  const dbClient = options?.client ?? db;
  // 1. Origin verification (reject cross-origin requests)
  const origin = request.headers.get('origin');
  if (origin) {
    let isAllowed = false;
    try {
      const requestOrigin = new URL(request.url).origin;
      if (origin === requestOrigin) {
        isAllowed = true;
      }
    } catch {
      // Ignore URL parse failures
    }

    if (!isAllowed) {
      const host = request.headers.get('host');
      if (host) {
        try {
          const parsedOrigin = new URL(origin);
          if (parsedOrigin.host === host) {
            isAllowed = true;
          }
        } catch {
          // Ignore
        }
      }
    }

    if (!isAllowed) {
      try {
        const authOrigin = new URL(env.AUTH_URL).origin;
        if (origin === authOrigin) {
          isAllowed = true;
        }
      } catch {
        // Ignore
      }
    }

    if (!isAllowed) {
      try {
        const clientAppOrigin = new URL(clientEnv.NEXT_PUBLIC_APP_URL).origin;
        if (origin === clientAppOrigin) {
          isAllowed = true;
        }
      } catch {
        // Ignore
      }
    }

    if (!isAllowed) {
      return NextResponse.json(
        { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Forbidden origin' },
        { status: 403 },
      );
    }
  }

  // 2. Reject API keys even with full wildcard scope (ADR-0006, AC-4)
  const bearer = extractBearerToken(request.headers);
  if (bearer) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        code: 'FORBIDDEN',
        message: 'API keys are not permitted for data exports',
      },
      { status: 403 },
    );
  }

  // 3. Web session authentication & owner role check
  let authContext: AuthContext;
  try {
    authContext = await requireOwner({ headers: request.headers, client: dbClient });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Owner role required' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: 'UNAUTHORIZED', code: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 },
    );
  }

  if (authContext.authType !== 'session') {
    return NextResponse.json(
      { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Web session required' },
      { status: 403 },
    );
  }

  // 4. Step-up re-authentication check (<= 5 minutes freshness, AC-4)
  try {
    await assertFreshReauthentication(authContext.user.id, dbClient, authContext.session?.token);
  } catch {
    return NextResponse.json(
      { error: 'REAUTH_REQUIRED', code: 'REAUTH_REQUIRED' },
      { status: 403 },
    );
  }

  // 5. Parse request body strictly
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'BAD_REQUEST', code: 'BAD_REQUEST', message: 'Invalid JSON payload' },
      { status: 400 },
    );
  }

  const parsed = exportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', code: 'BAD_REQUEST', message: 'Invalid request payload' },
      { status: 400 },
    );
  }

  // 6. Generate export
  const result = await generateExport({
    contactId: parsed.data.contactId,
    format: parsed.data.format,
    locale: parsed.data.locale,
    actorId: authContext.user.id,
    client: dbClient,
  });

  if (!result) {
    return NextResponse.json(
      { error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Contact not found' },
      { status: 404 },
    );
  }

  // 7. Stream response with strict security headers (AC-3)
  return new Response(result.content, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

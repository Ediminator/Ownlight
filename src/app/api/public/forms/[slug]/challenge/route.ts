import { NextResponse, type NextRequest } from 'next/server';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { getPublishedFormBySlug } from '@/server/inquiry-forms/service';
import {
  getOrCreatePowSecret,
  createFormChallenge,
  POW_MAX_NUMBER,
} from '@/server/inquiry-forms/pow';
import { consumeRateLimit, anonymizeIp } from '@/server/auth/rate-limiter';
import { resolveClientIp } from '@/server/http/client-ip';
import { logger, getRequestId } from '@/server/log';

export const CHALLENGE_IP_MAX_ATTEMPTS = 30;
export const CHALLENGE_IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function applyRouteSecurityHeaders(
  response: NextResponse,
  contentType = 'application/json',
): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Content-Type', contentType);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export interface ChallengeRouteContext {
  params: Promise<{ slug: string }>;
  client?: DbClient;
}

/**
 * Public Proof-of-Work challenge generation endpoint (TASK-0029 / ADR-0015 §1, §4).
 * Returns an ALTCHA challenge for published inquiry forms.
 * Rate limited to 30 requests per 10 minutes per anonymised IP bucket.
 * Fails closed with 503 on database or rate-limiter unavailability.
 */
export async function GET(
  request: NextRequest,
  context: ChallengeRouteContext,
): Promise<NextResponse> {
  const startTime = Date.now();
  const requestId = getRequestId();
  const dbClient = context.client ?? defaultDb;

  try {
    const { slug } = await context.params;

    // 1. Validate form exists and is published (AC-1)
    const form = await getPublishedFormBySlug(slug, dbClient);
    if (!form?.currentNoticeVersionId) {
      return applyRouteSecurityHeaders(
        new NextResponse('Inquiry form not found', { status: 404 }),
        'text/plain; charset=utf-8',
      );
    }

    // 2. Rate limit per anonymised IP bucket: 30 per 10 minutes (AC-4)
    const clientIp = resolveClientIp(request.headers);
    const ipBucket = clientIp ? anonymizeIp(clientIp) : 'unknown';
    const rateLimitKey = `challenge_ip:${ipBucket}`;

    const limitResult = await consumeRateLimit(
      rateLimitKey,
      CHALLENGE_IP_MAX_ATTEMPTS,
      CHALLENGE_IP_WINDOW_MS,
      dbClient,
    );

    if (!limitResult.allowed) {
      logger.warn(
        {
          request_id: requestId,
          form_id: form.id,
          outcome: 'rate_limited',
          reason: 'rate_limited',
          bucket: 'challenge_ip',
          duration_ms: Date.now() - startTime,
        },
        'PoW challenge request rate limited',
      );

      return applyRouteSecurityHeaders(
        new NextResponse('Too Many Requests', { status: 429 }),
        'text/plain; charset=utf-8',
      );
    }

    // 3. Generate challenge using studio HMAC secret (AC-1, AC-13)
    const secret = await getOrCreatePowSecret(dbClient);
    const challenge = await createFormChallenge(secret, {
      maxnumber: POW_MAX_NUMBER,
    });

    const response = NextResponse.json(challenge, { status: 200 });
    return applyRouteSecurityHeaders(response, 'application/json');
  } catch (error) {
    // 4. Fail closed on database or rate limiter failure (AC-4, ADR-0015 §4)
    logger.error(
      {
        request_id: requestId,
        outcome: 'unavailable',
        reason: 'challenge_unavailable',
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      },
      'Challenge endpoint unavailable; failing closed',
    );

    return applyRouteSecurityHeaders(
      new NextResponse('Service Unavailable', { status: 503 }),
      'text/plain; charset=utf-8',
    );
  }
}

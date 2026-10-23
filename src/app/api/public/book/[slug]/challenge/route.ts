import { NextResponse, type NextRequest } from 'next/server';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { findBookingTypeBySlug } from '@/server/calendar/repo';
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

export interface BookingChallengeRouteContext {
  params: Promise<{ slug: string }>;
  client?: DbClient;
}

/**
 * Public Proof-of-Work challenge generation endpoint for public bookings (TASK-0044).
 * Returns an ALTCHA challenge for active booking types.
 * Rate limited to 30 requests per 10 minutes per anonymised IP bucket.
 * Fails closed with 503 on database or rate-limiter unavailability.
 */
export async function GET(
  request: NextRequest,
  context: BookingChallengeRouteContext,
): Promise<NextResponse> {
  const startTime = Date.now();
  const requestId = getRequestId();
  const dbClient = context.client ?? defaultDb;

  try {
    const { slug } = await context.params;

    // 1. Validate booking type exists and is active
    const bookingType = await findBookingTypeBySlug(slug, dbClient);
    if (!bookingType?.isActive) {
      return applyRouteSecurityHeaders(
        new NextResponse('Booking type not found or closed', { status: 404 }),
        'text/plain; charset=utf-8',
      );
    }

    // 2. Rate limit per anonymised IP bucket: 30 per 10 minutes
    const clientIp = resolveClientIp(request.headers);
    const ipBucket = clientIp ? anonymizeIp(clientIp) : 'unknown';
    const rateLimitKey = `booking_challenge_ip:${ipBucket}`;

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
          booking_type_id: bookingType.id,
          outcome: 'rate_limited',
          reason: 'rate_limited',
          bucket: 'booking_challenge_ip',
          duration_ms: Date.now() - startTime,
        },
        'Booking PoW challenge request rate limited',
      );

      return applyRouteSecurityHeaders(
        new NextResponse('Too Many Requests', { status: 429 }),
        'text/plain; charset=utf-8',
      );
    }

    // 3. Generate challenge using studio HMAC secret
    const secret = await getOrCreatePowSecret(dbClient);
    const challenge = await createFormChallenge(secret, {
      maxnumber: POW_MAX_NUMBER,
    });

    const response = NextResponse.json(challenge, { status: 200 });
    return applyRouteSecurityHeaders(response, 'application/json');
  } catch (error) {
    logger.error(
      {
        request_id: requestId,
        outcome: 'unavailable',
        reason: 'challenge_unavailable',
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      },
      'Booking challenge endpoint unavailable; failing closed',
    );

    return applyRouteSecurityHeaders(
      new NextResponse('Service Unavailable', { status: 503 }),
      'text/plain; charset=utf-8',
    );
  }
}

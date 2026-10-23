import { NextRequest } from 'next/server';
import { db, type DbClient } from '@/server/db/client';
import { renderIcalFeedForToken } from '@/server/calendar/service';

export const dynamic = 'force-dynamic';

export interface CalendarFeedRouteContext {
  params: Promise<{ token: string }> | { token: string };
  client?: DbClient;
}

const ANTI_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * Public secret-token authenticated calendar feed endpoint (RFC 5545).
 * Responds to both /api/calendar/feed/[token] and /api/calendar/feed/[token].ics.
 */
export async function GET(
  request: NextRequest,
  context: CalendarFeedRouteContext,
): Promise<Response> {
  const dbClient = context.client ?? db;

  const rawParams = await Promise.resolve(context.params);
  const rawToken = rawParams.token;

  if (!rawToken || typeof rawToken !== 'string') {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...ANTI_CACHE_HEADERS,
      },
    });
  }

  // Handle tokens with or without .ics suffix per RFC / specification
  const token = rawToken.endsWith('.ics') ? rawToken.slice(0, -4) : rawToken;

  if (!token) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...ANTI_CACHE_HEADERS,
      },
    });
  }

  const result = await renderIcalFeedForToken(token, dbClient);

  if (!result.found || !result.ical) {
    return new Response('Calendar feed not found or expired', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...ANTI_CACHE_HEADERS,
      },
    });
  }

  return new Response(result.ical, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      ...ANTI_CACHE_HEADERS,
    },
  });
}

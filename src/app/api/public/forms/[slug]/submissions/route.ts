import { NextResponse, type NextRequest } from 'next/server';
import { getEmbedOrigins } from '@/env';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { getPublishedFormBySlug } from '@/server/inquiry-forms/service';
import { submitInquiry } from '@/server/inquiry-forms/submit';
import { resolveClientIp } from '@/server/http/client-ip';
import { logger, getRequestId } from '@/server/log';
import type { LeadLocale } from '@/server/db/schema/leads';

const MAX_BODY_BYTES = 16 * 1024; // 16 KiB (ADR-0015 §2, §4)

function applyRouteSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export interface SubmissionsRouteContext {
  params: Promise<{ slug: string }>;
  client?: DbClient;
}

/**
 * Script-free cross-origin HTML POST route handler for inquiry forms.
 * Accepts application/x-www-form-urlencoded (≤ 16 KiB).
 * Enforces origin matching against PUBLIC_FORMS_EMBED_ORIGINS.
 * Requires accept_unverified = true on the form.
 * Responds with 303 See Other redirects, returning no HTML.
 * (ADR-0015 §1, §2, §3, TASK-0028 AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9).
 */
export async function POST(
  request: NextRequest,
  context: SubmissionsRouteContext,
): Promise<NextResponse> {
  const startTime = Date.now();
  const requestId = getRequestId();

  // 1. Content-Type check: strictly application/x-www-form-urlencoded
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return applyRouteSecurityHeaders(
      new NextResponse('Unsupported Media Type: expected application/x-www-form-urlencoded', {
        status: 415,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  // 2. Body size limit check (≤ 16 KiB)
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
      logger.warn(
        {
          request_id: requestId,
          outcome: 'body_too_large',
          reason: 'body_too_large',
          duration_ms: Date.now() - startTime,
        },
        'Script-free inquiry submission rejected: body too large',
      );
      return applyRouteSecurityHeaders(
        new NextResponse('Payload Too Large: maximum body size is 16 KiB', {
          status: 413,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      );
    }
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    logger.warn(
      {
        request_id: requestId,
        outcome: 'body_too_large',
        reason: 'body_too_large',
        duration_ms: Date.now() - startTime,
      },
      'Script-free inquiry submission rejected: body too large',
    );
    return applyRouteSecurityHeaders(
      new NextResponse('Payload Too Large: maximum body size is 16 KiB', {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  // 3. Embed origins allowlist check (AC-2)
  const allowedOrigins = getEmbedOrigins();
  if (allowedOrigins.length === 0) {
    logger.warn(
      {
        request_id: requestId,
        outcome: 'forbidden',
        reason: 'origin_denied',
        duration_ms: Date.now() - startTime,
      },
      'Script-free inquiry submission rejected: no embed origins configured',
    );
    return applyRouteSecurityHeaders(
      new NextResponse('Forbidden: cross-origin inquiry submissions are not enabled', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  // 4. Origin header validation (AC-5)
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null' || !allowedOrigins.includes(origin)) {
    logger.warn(
      {
        request_id: requestId,
        outcome: 'origin_denied',
        reason: 'origin_denied',
        duration_ms: Date.now() - startTime,
      },
      'Script-free inquiry submission rejected: origin missing or unlisted',
    );
    return applyRouteSecurityHeaders(
      new NextResponse('Forbidden: invalid or unlisted submission origin', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  const dbClient = context.client ?? defaultDb;

  // 5. Load published form by slug
  const { slug } = await context.params;
  const form = await getPublishedFormBySlug(slug, dbClient);
  if (!form?.currentNoticeVersionId) {
    return applyRouteSecurityHeaders(
      new NextResponse('Not Found: inquiry form does not exist', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  // Parse URL-encoded body
  const bodyText = new TextDecoder().decode(rawBody);
  const formDataParams = new URLSearchParams(bodyText);

  // Determine locale
  const rawLocale = formDataParams.get('locale');
  const locale: LeadLocale =
    rawLocale === 'de'
      ? 'de'
      : rawLocale === 'en'
        ? 'en'
        : form.defaultLocale === 'de'
          ? 'de'
          : 'en';

  // 6. Check form.accept_unverified (AC-8)
  if (!form.acceptUnverified) {
    logger.warn(
      {
        request_id: requestId,
        form_id: form.id,
        outcome: 'unverified_rejected',
        reason: 'unverified_rejected',
        delivery_mode: 'script_free',
        duration_ms: Date.now() - startTime,
      },
      'Script-free inquiry submission rejected: form does not accept unverified submissions',
    );
    return applyRouteSecurityHeaders(
      NextResponse.redirect(new URL(`/${locale}/f/${slug}?error=unverified`, request.url), 303),
    );
  }

  // 7. Build input object for submitInquiry
  const rawInput: Record<string, unknown> = {};
  for (const [key, value] of formDataParams.entries()) {
    rawInput[key] = value;
  }

  // Checkbox handling for notice_acknowledged
  if (formDataParams.has('notice_acknowledged')) {
    const val = formDataParams.get('notice_acknowledged');
    rawInput.notice_acknowledged = val === 'on' || val === 'true' || val === '1';
  } else {
    rawInput.notice_acknowledged = false;
  }

  // Remove internal fields from validation input
  delete rawInput.slug;
  delete rawInput.locale;
  delete rawInput.delivery_mode;
  delete rawInput.deliveryMode;

  const clientIp = resolveClientIp(request.headers);

  // 8. Submit inquiry
  const result = await submitInquiry(
    rawInput,
    {
      slug,
      locale,
      deliveryMode: 'script_free',
      verification: 'unverified',
      clientIp,
    },
    dbClient,
  );

  // 9. Process result and redirect destinations (AC-4, AC-6, AC-7, AC-9)
  if (result.success) {
    let successDestination = `/${locale}/f/${slug}/thanks`;

    // Validate form.success_redirect_url against allowlist (AC-6, AC-7)
    if (form.successRedirectUrl) {
      try {
        const parsedUrl = new URL(form.successRedirectUrl);
        if (allowedOrigins.includes(parsedUrl.origin)) {
          successDestination = form.successRedirectUrl;
        }
      } catch {
        // Fall back to hosted thanks page
      }
    }

    const redirectTarget = successDestination.startsWith('http')
      ? successDestination
      : new URL(successDestination, request.url).toString();

    return applyRouteSecurityHeaders(NextResponse.redirect(redirectTarget, 303));
  }

  // Handle failure outcomes
  if (result.outcome === 'unverified_rejected') {
    return applyRouteSecurityHeaders(
      NextResponse.redirect(new URL(`/${locale}/f/${slug}?error=unverified`, request.url), 303),
    );
  }

  if (result.outcome === 'rate_limited') {
    return applyRouteSecurityHeaders(
      new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  if (result.outcome === 'unavailable') {
    return applyRouteSecurityHeaders(
      new NextResponse('Service Unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  // Default validation failure redirect (AC-7 / ADR-0015 §2)
  return applyRouteSecurityHeaders(
    NextResponse.redirect(new URL(`/${locale}/f/${slug}?error=invalid`, request.url), 303),
  );
}

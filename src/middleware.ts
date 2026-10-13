import { NextResponse, NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export const SECURE_SESSION_COOKIE = '__Secure-ownlight_session';
export const STANDARD_SESSION_COOKIE = 'ownlight_session';
export const BETTER_AUTH_SECURE_COOKIE = '__Secure-better-auth.session_token';
export const BETTER_AUTH_COOKIE = 'better-auth.session_token';

import { getEmbedOrigins } from './env';

const PUBLIC_PATH_SEGMENTS = [
  'sign-in',
  'setup',
  'forgot-password',
  'reset-password',
  'verify-email',
  'f',
];

/**
 * Checks whether the request path is a public inquiry form route (/{locale}/f/** or /f/**).
 */
function isPublicFormRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'f') return true;
  if (segments[0] && routing.locales.includes(segments[0] as 'en' | 'de') && segments[1] === 'f') {
    return true;
  }
  return false;
}

/**
 * Checks whether the request path is an inquiry form embed route
 * (/{locale}/f/[slug]/embed or .../embed/thanks, or /f/[slug]/embed or .../embed/thanks).
 */
export function isEmbedRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  // /f/[slug]/embed or /f/[slug]/embed/thanks
  if (segments[0] === 'f' && segments.length >= 3 && segments[2] === 'embed') {
    return segments.length === 3 || (segments.length === 4 && segments[3] === 'thanks');
  }
  // /[locale]/f/[slug]/embed or /[locale]/f/[slug]/embed/thanks
  if (
    segments[0] &&
    routing.locales.includes(segments[0] as 'en' | 'de') &&
    segments[1] === 'f' &&
    segments.length >= 4 &&
    segments[3] === 'embed'
  ) {
    return segments.length === 4 || (segments.length === 5 && segments[4] === 'thanks');
  }
  return false;
}

/**
 * Generates a random 16-byte base64 nonce using Web Crypto API (Edge-safe).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Checks whether a given path is an authentication or public route.
 */
function isPublicPath(pathname: string): boolean {
  // Static assets and internal routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return true;
  }

  // Remove locale prefix (/en/setup -> /setup)
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  const first = segments[0];
  const second = segments[1];

  if (first && routing.locales.includes(first as 'en' | 'de')) {
    if (!second) return false; // /en or /de alone is the dashboard (protected)
    return PUBLIC_PATH_SEGMENTS.includes(second);
  }

  return first ? PUBLIC_PATH_SEGMENTS.includes(first) : false;
}

/**
 * Determines whether the request carries an active session cookie.
 */
function hasValidSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has(SECURE_SESSION_COOKIE) ||
    request.cookies.has(STANDARD_SESSION_COOKIE) ||
    request.cookies.has(BETTER_AUTH_SECURE_COOKIE) ||
    request.cookies.has(BETTER_AUTH_COOKIE)
  );
}

/**
 * Extracts or infers locale from pathname.
 */
function extractLocale(pathname: string): 'en' | 'de' {
  const first = pathname.split('/').find(Boolean);
  if (first === 'de') return 'de';
  return 'en';
}

function applySecurityHeaders(
  response: NextResponse,
  cspHeader: string,
  nonce: string,
  isProd: boolean,
  requestId?: string,
  isEmbed = false,
): void {
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  if (isEmbed) {
    response.headers.delete('X-Frame-Options');
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
  }

  if (requestId) {
    response.headers.set('X-Request-Id', requestId);
  }

  if (isProd) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isProd = process.env.NODE_ENV === 'production';

  // 1. Correlation ID: propagate incoming x-request-id or generate new UUID
  const rawHeader = request.headers.get('x-request-id');
  const incomingRequestId = rawHeader ? rawHeader.trim() : null;
  const isValidRequestId =
    incomingRequestId !== null &&
    incomingRequestId.length > 0 &&
    incomingRequestId.length <= 128 &&
    /^[a-zA-Z0-9_\-.]{1,128}$/.test(incomingRequestId);
  const requestId = isValidRequestId && incomingRequestId ? incomingRequestId : crypto.randomUUID();

  // 2. Generate cryptographically random 16-byte base64 nonce for CSP (strict-dynamic)
  const nonce = generateNonce();

  // 3. Inspect embed route status and embed allowlist (AC-1, AC-2, AC-3)
  const isEmbed = isEmbedRoute(pathname);
  const embedOrigins = getEmbedOrigins();

  // If embed route requested but embed origins allowlist is empty or unconfigured: return 404 (AC-2)
  if (isEmbed && embedOrigins.length === 0) {
    const notFoundResponse = new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
    const defaultCsp = `
      default-src 'self';
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
      style-src 'self' 'unsafe-inline';
      img-src 'self' blob: data:;
      font-src 'self';
      object-src 'none';
      base-uri 'none';
      form-action 'self';
      frame-ancestors 'none';
    `
      .replace(/\s{2,}/g, ' ')
      .trim();
    applySecurityHeaders(notFoundResponse, defaultCsp, nonce, isProd, requestId, false);
    return notFoundResponse;
  }

  // 4. Build Content Security Policy header adhering to ASVS 5.0 V3 and ADR-0015 §3
  const frameAncestorsDirective =
    isEmbed && embedOrigins.length > 0
      ? `frame-ancestors 'self' ${embedOrigins.join(' ')};`
      : "frame-ancestors 'none';";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'none';
    form-action 'self';
    ${frameAncestorsDirective}
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 5. Route metadata & session inspection
  const authenticated = hasValidSessionCookie(request);
  const isPublic = isPublicPath(pathname);

  // 6. Pass nonce, metadata, and correlation ID to request headers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-request-id', requestId);
  if (isPublic) {
    requestHeaders.set('x-is-auth-route', '1');
  }

  // 7. Root path locale negotiation: delegate '/' to intlMiddleware first
  if (pathname === '/') {
    const response = intlMiddleware(
      new NextRequest(request, {
        headers: requestHeaders,
      }),
    );
    applySecurityHeaders(response, cspHeader, nonce, isProd, requestId, isEmbed);
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // 8. Route protection: redirect unauthenticated requests to protected app routes
  if (!isPublic && !authenticated) {
    const locale = extractLocale(pathname);
    const signInUrl = new URL(`/${locale}/sign-in`, request.url);
    if (pathname !== `/${locale}`) {
      signInUrl.searchParams.set('callbackUrl', pathname);
    }
    const redirectResponse = NextResponse.redirect(signInUrl);
    applySecurityHeaders(redirectResponse, cspHeader, nonce, isProd, requestId, isEmbed);
    return redirectResponse;
  }

  // 9. Delegate to next-intl middleware for locale negotiation
  const response = intlMiddleware(
    new NextRequest(request, {
      headers: requestHeaders,
    }),
  );

  // 10. Apply mandatory security headers, correlation ID and route metadata
  applySecurityHeaders(response, cspHeader, nonce, isProd, requestId, isEmbed);
  response.headers.set('x-pathname', pathname);
  response.headers.set('x-middleware-request-x-pathname', pathname);
  response.headers.set('x-middleware-request-x-request-id', requestId);
  if (isPublic) {
    response.headers.set('x-is-auth-route', '1');
    response.headers.set('x-middleware-request-x-is-auth-route', '1');
  }

  // Strictly no Set-Cookie on public form routes and embed routes (AC-12 / TDDDG §25)
  if (isPublicFormRoute(pathname) || isEmbed) {
    response.headers.delete('set-cookie');
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

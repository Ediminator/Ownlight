import 'server-only';
import net from 'node:net';
import { env } from '@/env';

/**
 * Resolves the client IP address from trusted reverse-proxy hops.
 *
 * Requirements:
 * 1. Reads ONLY the X-Forwarded-For header as a list L (comma-separated, left-to-right, trimmed).
 * 2. With TRUSTED_PROXY_COUNT = N >= 1, the client IP is the N-th entry from the right (L[len - N]),
 *    provided it is a syntactically valid IPv4 or IPv6 address. Otherwise returns null.
 * 3. With N = 0, or missing X-Forwarded-For, or header has fewer than N entries, or non-IP entry
 *    at selected position, returns null.
 * 4. Callers map null to a fixed shared bucket 'unknown'.
 */
export function resolveClientIp(
  headers: Headers | Record<string, string | string[] | undefined>,
  trustedProxyCount?: number,
): string | null {
  const n =
    trustedProxyCount ??
    (() => {
      try {
        return env.TRUSTED_PROXY_COUNT;
      } catch {
        const raw = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);
        return Number.isFinite(raw) ? raw : 1;
      }
    })();

  if (n <= 0) {
    return null;
  }

  let rawHeader: string | string[] | undefined;

  if ('get' in headers && typeof headers.get === 'function') {
    rawHeader = headers.get('x-forwarded-for') ?? undefined;
  } else {
    const record = headers as Record<string, string | string[] | undefined>;
    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === 'x-forwarded-for') {
        const desc = Object.getOwnPropertyDescriptor(record, key);
        if (desc) {
          rawHeader = desc.value as string | string[] | undefined;
        }
        break;
      }
    }
  }

  if (!rawHeader) {
    return null;
  }

  const rawString = Array.isArray(rawHeader) ? rawHeader.join(',') : rawHeader;
  if (!rawString || typeof rawString !== 'string') {
    return null;
  }

  const list = rawString.split(',').map((entry) => entry.trim());
  if (list.length < n) {
    return null;
  }

  const candidate = list[list.length - n];
  if (!candidate || net.isIP(candidate) === 0) {
    return null;
  }

  return candidate;
}

import 'server-only';
import net from 'node:net';

export class CaldavSsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaldavSsrfError';
  }
}

export interface ValidateCaldavServerUrlOptions {
  allowLoopback?: boolean;
}

/**
 * Validates user-supplied CalDAV server URLs to prevent Server-Side Request Forgery (SSRF).
 * Blocks loopback, private RFC 1918 subnets, cloud metadata addresses, and non-HTTP protocols.
 * (ASVS 5.0 V5.5 / Decision D9 compliant)
 */
export function validateCaldavServerUrl(
  urlString: string,
  options: ValidateCaldavServerUrlOptions = {},
): string {
  if (!urlString || typeof urlString !== 'string' || !urlString.trim()) {
    throw new CaldavSsrfError('Server URL cannot be empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    throw new CaldavSsrfError('Invalid CalDAV server URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CaldavSsrfError(
      `Forbidden protocol: "${parsed.protocol}". Only HTTP/HTTPS is permitted.`,
    );
  }

  let hostname = parsed.hostname.toLowerCase();
  // Strip IPv6 brackets if present, e.g. [::1] -> ::1
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  const allowLoopback = options.allowLoopback ?? false;

  // 1. Loopback addresses
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '0.0.0.0';

  if (isLoopback) {
    if (allowLoopback) {
      return parsed.toString();
    }
    throw new CaldavSsrfError(
      'Loopback address detected. Connecting to local server instances is blocked for security.',
    );
  }

  // 2. Local / internal domain suffixes
  if (
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.arpa')
  ) {
    throw new CaldavSsrfError('Internal and local domain names are blocked.');
  }

  // 3. IPv4 address classification
  const ipFamily = net.isIP(hostname);
  if (ipFamily === 4) {
    const parts = hostname.split('.').map((p) => Number(p));
    const [b0, b1] = parts;

    // 10.0.0.0/8
    if (b0 === 10) {
      throw new CaldavSsrfError('Private IPv4 network addresses (10.0.0.0/8) are blocked.');
    }

    // 172.16.0.0/12
    if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) {
      throw new CaldavSsrfError('Private IPv4 network addresses (172.16.0.0/12) are blocked.');
    }

    // 192.168.0.0/16
    if (b0 === 192 && b1 === 168) {
      throw new CaldavSsrfError('Private IPv4 network addresses (192.168.0.0/16) are blocked.');
    }

    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure instance metadata)
    if (b0 === 169 && b1 === 254) {
      throw new CaldavSsrfError('Link-local and metadata addresses (169.254.0.0/16) are blocked.');
    }
  }

  // 4. IPv6 address classification
  if (ipFamily === 6) {
    // Unique local address (fc00::/7)
    if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
      throw new CaldavSsrfError('Unique local IPv6 addresses (fc00::/7) are blocked.');
    }

    // Link-local address (fe80::/10)
    if (
      hostname.startsWith('fe8') ||
      hostname.startsWith('fe9') ||
      hostname.startsWith('fea') ||
      hostname.startsWith('feb')
    ) {
      throw new CaldavSsrfError('Link-local IPv6 addresses (fe80::/10) are blocked.');
    }

    // IPv4-mapped IPv6 (::ffff:x.x.x.x or normalized ::ffff:xxxx:xxxx)
    if (hostname.startsWith('::ffff:')) {
      const rest = hostname.slice('::ffff:'.length);
      if (net.isIP(rest) === 4) {
        return validateCaldavServerUrl(`http://${rest}`, options);
      }
      const [p0, p1] = rest.split(':');
      if (p0 !== undefined && p1 !== undefined) {
        const hi = parseInt(p0, 16);
        const lo = parseInt(p1, 16);
        const b0 = (hi >> 8) & 0xff;
        const b1 = hi & 0xff;
        const b2 = (lo >> 8) & 0xff;
        const b3 = lo & 0xff;
        return validateCaldavServerUrl(
          `http://${String(b0)}.${String(b1)}.${String(b2)}.${String(b3)}`,
          options,
        );
      }
    }
  }

  return parsed.toString();
}

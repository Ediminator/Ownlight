import crypto from 'node:crypto';
import { env } from '@/env';

export interface TimelineCursorData {
  occurredAt: Date;
  id: string;
}

const FALLBACK_SECRET = 'ownlight-timeline-cursor-secret-key-default-32b';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCursorSecret(): string {
  try {
    return env.AUTH_SECRET || FALLBACK_SECRET;
  } catch {
    return FALLBACK_SECRET;
  }
}

/**
 * Encodes a timeline keyset pagination cursor as a signed, opaque base64url string.
 */
export function encodeTimelineCursor(data: TimelineCursorData): string {
  const secret = getCursorSecret();
  const payload = `${data.occurredAt.toISOString()}|${data.id}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const token = `${payload}|${sig}`;
  return Buffer.from(token, 'utf8').toString('base64url');
}

/**
 * Decodes and cryptographically verifies an opaque timeline cursor.
 * Returns null if the cursor has been tampered with, is malformed, or has an invalid signature.
 */
export function decodeTimelineCursor(cursorString: string): TimelineCursorData | null {
  if (!cursorString || typeof cursorString !== 'string') {
    return null;
  }

  try {
    const raw = Buffer.from(cursorString, 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length !== 3) {
      return null;
    }

    const [isoDate, id, receivedSig] = parts;
    if (!isoDate || !id || !receivedSig) {
      return null;
    }

    // Validate UUID format
    if (!UUID_REGEX.test(id)) {
      return null;
    }

    // Validate Date format
    const occurredAt = new Date(isoDate);
    if (Number.isNaN(occurredAt.getTime())) {
      return null;
    }

    // Verify HMAC signature in constant time
    const secret = getCursorSecret();
    const payload = `${isoDate}|${id}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const receivedBuf = Buffer.from(receivedSig, 'utf8');

    if (expectedBuf.length !== receivedBuf.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return null;
    }

    return { occurredAt, id };
  } catch {
    return null;
  }
}

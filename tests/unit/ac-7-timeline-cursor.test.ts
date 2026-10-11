import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { encodeTimelineCursor, decodeTimelineCursor } from '@/server/timeline/cursor';

describe('AC-7: Keyset pagination cursor encoding, HMAC signature, and tampering protection', () => {
  const sampleData = {
    occurredAt: new Date('2026-06-15T12:00:00.000Z'),
    id: '018f0000-0000-7000-8000-000000000001',
  };

  it('AC-7: encodes and decodes cursor accurately (round-trip)', () => {
    const encoded = encodeTimelineCursor(sampleData);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeTimelineCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe(sampleData.id);
    expect(decoded?.occurredAt.toISOString()).toBe(sampleData.occurredAt.toISOString());
  });

  it('AC-7: rejects tampered timestamp in cursor', () => {
    const encoded = encodeTimelineCursor(sampleData);
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parts = raw.split('|');
    const id = parts[1] ?? '';
    const sig = parts[2] ?? '';

    // Tamper with the date without updating HMAC signature
    const tamperedRaw = `2026-06-16T12:00:00.000Z|${id}|${sig}`;
    const tamperedEncoded = Buffer.from(tamperedRaw, 'utf8').toString('base64url');

    const result = decodeTimelineCursor(tamperedEncoded);
    expect(result).toBeNull();
  });

  it('AC-7: rejects tampered event ID in cursor', () => {
    const encoded = encodeTimelineCursor(sampleData);
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parts = raw.split('|');
    const date = parts[0] ?? '';
    const sig = parts[2] ?? '';

    // Tamper with event ID without updating HMAC signature
    const tamperedRaw = `${date}|018f0000-0000-7000-8000-000000000099|${sig}`;
    const tamperedEncoded = Buffer.from(tamperedRaw, 'utf8').toString('base64url');

    const result = decodeTimelineCursor(tamperedEncoded);
    expect(result).toBeNull();
  });

  it('AC-7: rejects forged signature with wrong HMAC key', () => {
    const payload = `${sampleData.occurredAt.toISOString()}|${sampleData.id}`;
    const forgedSig = crypto
      .createHmac('sha256', 'attacker-key')
      .update(payload)
      .digest('base64url');
    const forgedToken = Buffer.from(`${payload}|${forgedSig}`, 'utf8').toString('base64url');

    const result = decodeTimelineCursor(forgedToken);
    expect(result).toBeNull();
  });

  it('AC-7: rejects malformed, non-base64url, or corrupted tokens', () => {
    expect(decodeTimelineCursor('')).toBeNull();
    expect(decodeTimelineCursor('not-a-token')).toBeNull();
    expect(decodeTimelineCursor('invalid||token')).toBeNull();
    expect(decodeTimelineCursor('!!!bad-base64url???')).toBeNull();
    expect(decodeTimelineCursor(Buffer.from('only|two', 'utf8').toString('base64url'))).toBeNull();
    expect(
      decodeTimelineCursor(
        Buffer.from('not-a-date|018f0000-0000-7000-8000-000000000001|sig', 'utf8').toString(
          'base64url',
        ),
      ),
    ).toBeNull();
    expect(
      decodeTimelineCursor(
        Buffer.from('2026-01-01T00:00:00.000Z|not-a-uuid|sig', 'utf8').toString('base64url'),
      ),
    ).toBeNull();
  });
});

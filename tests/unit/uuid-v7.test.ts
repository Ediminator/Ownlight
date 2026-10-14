import { describe, it, expect } from 'vitest';
import { generateUuidV7, isUuidV7, extractUuidV7Timestamp } from '@/lib/id';

describe('UUIDv7 RFC 9562 implementation', () => {
  it('generates valid UUIDv7 format with version 7 and variant 2', () => {
    const id = generateUuidV7();
    expect(isUuidV7(id)).toBe(true);

    // Format: 8-4-4-4-12
    const parts = id.split('-');
    expect(parts.length).toBe(5);
    const [p0, p1, p2, p3, p4] = parts;
    expect(p0?.length).toBe(8);
    expect(p1?.length).toBe(4);
    expect(p2?.length).toBe(4);
    expect(p3?.length).toBe(4);
    expect(p4?.length).toBe(12);

    // Version nibble is 7
    expect(p2?.[0]).toBe('7');
    // Variant nibble is 8, 9, a, or b (RFC 4122/9562 binary 10xx)
    expect(['8', '9', 'a', 'b']).toContain(p3?.[0]?.toLowerCase());
  });

  it('embeds millisecond timestamp accurately', () => {
    const before = Date.now();
    const id = generateUuidV7();
    const after = Date.now();

    const extracted = extractUuidV7Timestamp(id);
    expect(extracted).toBeGreaterThanOrEqual(before);
    expect(extracted).toBeLessThanOrEqual(after);
  });

  it('generates monotonically increasing IDs over time (chronologically sortable)', () => {
    const id1 = generateUuidV7(1000);
    const id2 = generateUuidV7(2000);
    const id3 = generateUuidV7(3000);

    const ids = [id2, id3, id1];
    ids.sort();

    expect(ids).toEqual([id1, id2, id3]);
  });

  it('isUuidV7 correctly rejects invalid strings', () => {
    expect(isUuidV7('')).toBe(false);
    expect(isUuidV7(null)).toBe(false);
    expect(isUuidV7(undefined)).toBe(false);
    expect(isUuidV7(12345)).toBe(false);
    expect(isUuidV7({})).toBe(false);
    expect(isUuidV7([])).toBe(false);
    expect(isUuidV7(true)).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
    // UUIDv4 (version 4 instead of 7)
    expect(isUuidV7('c9bf9e57-1685-4c89-bafb-ff5af830be8a')).toBe(false);
  });

  it('extractUuidV7Timestamp throws on invalid UUID', () => {
    expect(() => extractUuidV7Timestamp('invalid')).toThrow('Invalid UUIDv7');
  });
});

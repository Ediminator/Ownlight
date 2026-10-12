import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { generateFormSlug, isFormSlug, FORM_SLUG_REGEX } from '@/server/inquiry-forms/slug';

describe('TASK-0024: AC-9 Form Slug Generation & Validation', () => {
  it('AC-9: generates 1,000 slugs, all matching ^[a-z2-7]{10}$ and all unique using crypto.randomBytes', () => {
    const randomBytesSpy = vi.spyOn(crypto, 'randomBytes');

    const count = 1000;
    const slugs = new Set<string>();

    for (let i = 0; i < count; i++) {
      const slug = generateFormSlug();
      expect(slug).toHaveLength(10);
      expect(FORM_SLUG_REGEX.test(slug)).toBe(true);
      expect(isFormSlug(slug)).toBe(true);
      slugs.add(slug);
    }

    // All 1,000 generated slugs must be strictly unique
    expect(slugs.size).toBe(count);

    // Generator must use crypto.randomBytes
    expect(randomBytesSpy).toHaveBeenCalled();
    expect(randomBytesSpy).toHaveBeenCalledWith(10);

    randomBytesSpy.mockRestore();
  });

  it('AC-9: isFormSlug rejects invalid slug formats', () => {
    expect(isFormSlug('')).toBe(false);
    expect(isFormSlug('abc')).toBe(false); // too short
    expect(isFormSlug('abcdefghijk')).toBe(false); // 11 chars
    expect(isFormSlug('ABCDEF2345')).toBe(false); // uppercase
    expect(isFormSlug('abcdefgh01')).toBe(false); // 0 and 1 are not in base32
    expect(isFormSlug('abcdefgh89')).toBe(false); // 8 and 9 are not in base32
    expect(isFormSlug(null)).toBe(false);
    expect(isFormSlug(undefined)).toBe(false);
    expect(isFormSlug(1234567890)).toBe(false);
    expect(isFormSlug('abc-efgh23')).toBe(false); // hyphens not allowed
  });
});

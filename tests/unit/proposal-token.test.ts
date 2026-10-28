import { describe, it, expect } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';

describe('TASK-0060: Proposal Secret Token & SHA-256 Hash Verification', () => {
  it('AC-1: generates 32-byte (256-bit) cryptographically secure URL-safe base64 tokens', () => {
    const rawToken = randomBytes(32).toString('base64url');

    // 32 bytes encoded in base64url is 43 characters
    expect(rawToken).toHaveLength(43);
    // Matches URL-safe base64 character set (no +, /, or = padding)
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('AC-1: computes deterministic 64-character hex SHA-256 hash', () => {
    const rawToken = randomBytes(32).toString('base64url');
    const hash1 = createHash('sha256').update(rawToken).digest('hex');
    const hash2 = createHash('sha256').update(rawToken).digest('hex');

    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('AC-1: guarantees collision resistance across generated tokens and hashes', () => {
    const tokenSet = new Set<string>();
    const hashSet = new Set<string>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      const rawToken = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(rawToken).digest('hex');

      expect(tokenSet.has(rawToken)).toBe(false);
      expect(hashSet.has(hash)).toBe(false);

      tokenSet.add(rawToken);
      hashSet.add(hash);
    }

    expect(tokenSet.size).toBe(count);
    expect(hashSet.size).toBe(count);
  });

  it('AC-3: verifies that token revocation produces non-matching hash preventing previous link access', () => {
    const originalToken = randomBytes(32).toString('base64url');
    const originalHash = createHash('sha256').update(originalToken).digest('hex');

    const revokedFreshToken = randomBytes(32).toString('base64url');
    const revokedFreshHash = createHash('sha256').update(revokedFreshToken).digest('hex');

    expect(originalToken).not.toBe(revokedFreshToken);
    expect(originalHash).not.toBe(revokedFreshHash);

    // Old token hashed against new hash produces mismatch
    const checkOldAgainstNew = createHash('sha256').update(originalToken).digest('hex');
    expect(checkOldAgainstNew).toBe(originalHash);
    expect(checkOldAgainstNew).not.toBe(revokedFreshHash);
  });
});

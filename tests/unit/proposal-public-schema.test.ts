import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { acceptProposalSchema } from '@/server/proposals/schema';
import { anonymizeIp } from '@/server/auth/rate-limiter';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

describe('TASK-0062: Public Proposal Schema & Unit Tests', () => {
  describe('acceptProposalSchema input validation', () => {
    const validUuid1 = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b';
    const validUuid2 = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6c';

    it('AC-3: accepts valid proposal acceptance payload with selectedOptions', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        selectedOptions: [
          { id: validUuid1, quantity: 2 },
          { id: validUuid2, quantity: 1 },
        ],
        agreementConfirmed: true,
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.token).toBe('test-token-123');
        expect(result.data.acceptedByName).toBe('Jane Doe');
        expect(result.data.acceptedByEmail).toBe('jane@example.com');
        expect(result.data.selectedOptions).toHaveLength(2);
      }
    });

    it('AC-3: accepts payload with selectedOptionIds as string array', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        selectedOptionIds: [validUuid1, validUuid2],
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.selectedOptionIds).toEqual([validUuid1, validUuid2]);
        expect(result.data.agreementConfirmed).toBe(true);
      }
    });

    it('AC-3: accepts payload with selectedOptionIds as object array', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        selectedOptionIds: [{ id: validUuid1, quantity: 3 }],
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('AC-3: rejects empty or missing token', () => {
      const input = {
        token: '   ',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects empty or missing acceptedByName', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: '   ',
        acceptedByEmail: 'jane@example.com',
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects name exceeding 200 characters', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'A'.repeat(201),
        acceptedByEmail: 'jane@example.com',
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects invalid email address', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'not-an-email',
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects agreementConfirmed when explicitly set to false', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        agreementConfirmed: false,
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects negative or zero quantity in selectedOptions', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        selectedOptions: [{ id: validUuid1, quantity: 0 }],
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('AC-3: rejects unrecognized keys under strict mode', () => {
      const input = {
        token: 'test-token-123',
        acceptedByName: 'Jane Doe',
        acceptedByEmail: 'jane@example.com',
        unknownField: 'malicious',
      };

      const result = acceptProposalSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('anonymizeIp data minimisation (GDPR Art. 5 / TDDDG §25)', () => {
    it('AC-3: correctly masks IPv4 addresses to /24 subnet (zeroes last octet)', () => {
      expect(anonymizeIp('192.168.1.150')).toBe('192.168.1.0');
      expect(anonymizeIp('10.0.50.99')).toBe('10.0.50.0');
      expect(anonymizeIp('172.16.254.1')).toBe('172.16.254.0');
    });

    it('AC-3: correctly masks IPv6 addresses to /48 subnet', () => {
      expect(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3::/48');
      expect(anonymizeIp('2001:db8:abcd:0012::1')).toBe('2001:db8:abcd::/48');
    });

    it('AC-3: handles empty and malformed IP gracefully', () => {
      expect(anonymizeIp('')).toBe('0.0.0.0');
      expect(anonymizeIp('   ')).toBe('0.0.0.0');
      expect(anonymizeIp('unknown-host')).toBe('unknown-host');
    });
  });

  describe('AC-7: translation key parity in en.json and de.json', () => {
    it('AC-7: proposals.public exists in en.json and de.json with parity', () => {
      const enProposals = (enMessages as Record<string, unknown>).proposals as Record<
        string,
        unknown
      >;
      const deProposals = (deMessages as Record<string, unknown>).proposals as Record<
        string,
        unknown
      >;

      expect(enProposals).toBeDefined();
      expect(deProposals).toBeDefined();

      const enPublic = enProposals.public as Record<string, unknown>;
      const dePublic = deProposals.public as Record<string, unknown>;

      expect(enPublic).toBeDefined();
      expect(dePublic).toBeDefined();

      const getLeafKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
        let keys: string[] = [];
        for (const [k, v] of Object.entries(obj)) {
          const currentKey = prefix ? `${prefix}.${k}` : k;
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            keys = keys.concat(getLeafKeys(v as Record<string, unknown>, currentKey));
          } else {
            keys.push(currentKey);
          }
        }
        return keys.sort();
      };

      const enKeys = getLeafKeys(enPublic);
      const deKeys = getLeafKeys(dePublic);

      expect(enKeys.length).toBeGreaterThan(15);
      expect(enKeys).toEqual(deKeys);
    });
  });
});

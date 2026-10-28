import { describe, it, expect } from 'vitest';
import {
  saveDraftProposalSchema,
  sendProposalSchema,
  revokeProposalTokenSchema,
} from '@/server/proposals/schema';

describe('TASK-0060: Proposal Schemas Validation Unit Tests (AC-7)', () => {
  describe('AC-7: sendProposalSchema', () => {
    it('accepts valid proposalId with future expiration date and optional recipient email', () => {
      const valid = {
        proposalId: '01920000-0000-7000-8000-000000000001',
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        recipientEmail: 'client@example.org',
      };

      const parsed = sendProposalSchema.parse(valid);
      expect(parsed.proposalId).toBe(valid.proposalId);
      expect(parsed.validUntil).toBeInstanceOf(Date);
      expect(parsed.recipientEmail).toBe('client@example.org');
    });

    it('accepts valid proposalId without expiration date or recipient email', () => {
      const valid = {
        proposalId: '01920000-0000-7000-8000-000000000002',
      };

      const parsed = sendProposalSchema.parse(valid);
      expect(parsed.proposalId).toBe(valid.proposalId);
      expect(parsed.validUntil).toBeUndefined();
      expect(parsed.recipientEmail).toBeUndefined();
    });

    it('AC-7: rejects expiration date in the past with localized schema error message', () => {
      const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
      const payload = {
        proposalId: '01920000-0000-7000-8000-000000000003',
        validUntil: pastDate,
      };

      const result = sendProposalSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Expiration date must be in the future');
      }
    });

    it('rejects invalid recipient email address format', () => {
      const payload = {
        proposalId: '01920000-0000-7000-8000-000000000004',
        recipientEmail: 'not-an-email',
      };

      const result = sendProposalSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Invalid recipient email address');
      }
    });

    it('rejects non-UUID proposalId', () => {
      const result = sendProposalSchema.safeParse({
        proposalId: 'invalid-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('strictly rejects unpermitted extra properties', () => {
      const result = sendProposalSchema.safeParse({
        proposalId: '01920000-0000-7000-8000-000000000005',
        unrecognizedField: 'malicious-data',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AC-7: saveDraftProposalSchema', () => {
    it('accepts valid draft proposal creation payload', () => {
      const valid = {
        projectId: '01920000-0000-7000-8000-000000000010',
        clientId: '01920000-0000-7000-8000-000000000011',
        title: 'New Wedding Proposal',
        currency: 'EUR',
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        lineItems: [
          {
            name: 'Base Package',
            itemType: 'base_package' as const,
            unitPriceMinor: 250000,
            quantity: 1,
            taxRateBasisPoints: 1900,
          },
        ],
      };

      const parsed = saveDraftProposalSchema.parse(valid);
      expect(parsed.title).toBe('New Wedding Proposal');
      expect(parsed.lineItems).toHaveLength(1);
    });

    it('AC-7: rejects draft with negative line-item prices', () => {
      const payload = {
        projectId: '01920000-0000-7000-8000-000000000020',
        title: 'Draft Proposal with Negative Price',
        lineItems: [
          {
            name: 'Subsidized Package',
            itemType: 'base_package' as const,
            unitPriceMinor: -5000,
            quantity: 1,
            taxRateBasisPoints: 1900,
          },
        ],
      };

      const result = saveDraftProposalSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Unit price cannot be negative');
      }
    });

    it('rejects draft with empty title', () => {
      const result = saveDraftProposalSchema.safeParse({
        projectId: '01920000-0000-7000-8000-000000000021',
        title: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('strictly rejects unpermitted extra properties', () => {
      const result = saveDraftProposalSchema.safeParse({
        projectId: '01920000-0000-7000-8000-000000000022',
        title: 'Valid Title',
        forbiddenField: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('revokeProposalTokenSchema', () => {
    it('accepts valid UUID proposalId', () => {
      const parsed = revokeProposalTokenSchema.parse({
        proposalId: '01920000-0000-7000-8000-000000000030',
      });
      expect(parsed.proposalId).toBe('01920000-0000-7000-8000-000000000030');
    });

    it('rejects invalid proposalId UUID', () => {
      const result = revokeProposalTokenSchema.safeParse({
        proposalId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('strictly rejects extra fields', () => {
      const result = revokeProposalTokenSchema.safeParse({
        proposalId: '01920000-0000-7000-8000-000000000031',
        extra: 'not allowed',
      });
      expect(result.success).toBe(false);
    });
  });
});

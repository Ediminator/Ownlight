import { describe, it, expect } from 'vitest';
import {
  createProposalSchema,
  updateProposalSchema,
  proposalLineItemInputSchema,
  transitionProposalStatusSchema,
} from '@/server/proposals/schema';

describe('TASK-0058: Proposals Zod Schemas Validation', () => {
  describe('proposalLineItemInputSchema', () => {
    it('validates a correct line item input', () => {
      const valid = {
        name: 'Full Day Coverage',
        description: 'Comprehensive wedding coverage',
        unitPriceMinor: 250000,
        quantity: 1,
        minQuantity: 1,
        maxQuantity: 1,
        taxRateBasisPoints: 1900,
        itemType: 'base_package' as const,
        isOptional: false,
        isSelected: true,
        position: 0,
      };

      const parsed = proposalLineItemInputSchema.parse(valid);
      expect(parsed.name).toBe('Full Day Coverage');
      expect(parsed.unitPriceMinor).toBe(250000);
      expect(parsed.itemType).toBe('base_package');
    });

    it('rejects negative unit price or negative quantity', () => {
      expect(() =>
        proposalLineItemInputSchema.parse({
          name: 'Invalid Price',
          unitPriceMinor: -100,
          quantity: 1,
        }),
      ).toThrow();

      expect(() =>
        proposalLineItemInputSchema.parse({
          name: 'Invalid Quantity',
          unitPriceMinor: 1000,
          quantity: -1,
        }),
      ).toThrow();
    });

    it('rejects empty or whitespace-only name', () => {
      expect(() =>
        proposalLineItemInputSchema.parse({
          name: '   ',
          unitPriceMinor: 1000,
        }),
      ).toThrow();
    });

    it('rejects invalid tax rate basis points (e.g. negative or > 10000)', () => {
      expect(() =>
        proposalLineItemInputSchema.parse({
          name: 'Invalid Tax',
          unitPriceMinor: 1000,
          taxRateBasisPoints: -100,
        }),
      ).toThrow();

      expect(() =>
        proposalLineItemInputSchema.parse({
          name: 'Invalid Tax',
          unitPriceMinor: 1000,
          taxRateBasisPoints: 15000,
        }),
      ).toThrow();
    });

    it('rejects unknown properties in strict mode', () => {
      expect(() =>
        proposalLineItemInputSchema.parse({
          name: 'Test Item',
          unitPriceMinor: 1000,
          unknownField: 'malicious',
        }),
      ).toThrow();
    });
  });

  describe('createProposalSchema', () => {
    it('validates a correct proposal input with line items', () => {
      const valid = {
        projectId: '01920000-0000-7000-8000-000000000071',
        clientId: '01920000-0000-7000-8000-000000000081',
        title: 'Emma & Liam Wedding Proposal',
        currency: 'EUR',
        pricesIncludeTax: true,
        isKleinunternehmer: false,
        taxNotice: null,
        validUntil: '2026-12-31T23:59:59.000Z',
        internalNotes: 'VIP wedding couple',
        lineItems: [
          {
            name: 'Base Package',
            unitPriceMinor: 200000,
            quantity: 1,
            taxRateBasisPoints: 1900,
            itemType: 'base_package' as const,
          },
        ],
      };

      const parsed = createProposalSchema.parse(valid);
      expect(parsed.title).toBe('Emma & Liam Wedding Proposal');
      expect(parsed.validUntil).toBeInstanceOf(Date);
      expect(parsed.lineItems).toHaveLength(1);
    });

    it('rejects invalid UUIDs for projectId and clientId', () => {
      expect(() =>
        createProposalSchema.parse({
          projectId: 'invalid-uuid',
          clientId: '01920000-0000-7000-8000-000000000081',
          title: 'Proposal Title',
        }),
      ).toThrow();

      expect(() =>
        createProposalSchema.parse({
          projectId: '01920000-0000-7000-8000-000000000071',
          clientId: 'not-a-uuid',
          title: 'Proposal Title',
        }),
      ).toThrow();
    });

    it('rejects empty title or title exceeding 200 characters', () => {
      expect(() =>
        createProposalSchema.parse({
          projectId: '01920000-0000-7000-8000-000000000071',
          clientId: '01920000-0000-7000-8000-000000000081',
          title: '   ',
        }),
      ).toThrow();

      expect(() =>
        createProposalSchema.parse({
          projectId: '01920000-0000-7000-8000-000000000071',
          clientId: '01920000-0000-7000-8000-000000000081',
          title: 'x'.repeat(201),
        }),
      ).toThrow();
    });

    it('rejects currency not exactly 3 characters', () => {
      expect(() =>
        createProposalSchema.parse({
          projectId: '01920000-0000-7000-8000-000000000071',
          clientId: '01920000-0000-7000-8000-000000000081',
          title: 'Proposal',
          currency: 'EURO',
        }),
      ).toThrow();
    });
  });

  describe('updateProposalSchema', () => {
    it('validates partial updates', () => {
      const parsed = updateProposalSchema.parse({
        title: 'Updated Proposal Title',
        pricesIncludeTax: false,
      });

      expect(parsed.title).toBe('Updated Proposal Title');
      expect(parsed.pricesIncludeTax).toBe(false);
      expect(parsed.currency).toBeUndefined();
    });

    it('rejects empty title when provided', () => {
      expect(() =>
        updateProposalSchema.parse({
          title: '   ',
        }),
      ).toThrow();
    });
  });

  describe('transitionProposalStatusSchema', () => {
    it('validates accepted transition payload with client signature details', () => {
      const valid = {
        newStatus: 'accepted' as const,
        acceptedByName: 'Liam Smith',
        acceptedByEmail: 'liam@example.com',
        acceptanceIpAnonymized: '192.168.1.0',
        acceptanceUserAgent: 'Mozilla/5.0...',
        selectedLineItemIds: ['01920000-0000-7000-8000-000000000211'],
      };

      const parsed = transitionProposalStatusSchema.parse(valid);
      expect(parsed.newStatus).toBe('accepted');
      expect(parsed.acceptedByName).toBe('Liam Smith');
      expect(parsed.acceptedByEmail).toBe('liam@example.com');
    });

    it('validates declined transition payload with decline reason', () => {
      const valid = {
        newStatus: 'declined' as const,
        declineReason: 'Decided on another photographer',
      };

      const parsed = transitionProposalStatusSchema.parse(valid);
      expect(parsed.newStatus).toBe('declined');
      expect(parsed.declineReason).toBe('Decided on another photographer');
    });

    it('rejects invalid email format for acceptedByEmail', () => {
      expect(() =>
        transitionProposalStatusSchema.parse({
          newStatus: 'accepted',
          acceptedByEmail: 'not-an-email',
        }),
      ).toThrow();
    });

    it('rejects unknown status value', () => {
      expect(() =>
        transitionProposalStatusSchema.parse({
          newStatus: 'invalid_status',
        }),
      ).toThrow();
    });
  });
});

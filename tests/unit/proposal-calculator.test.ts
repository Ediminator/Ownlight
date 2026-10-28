import { describe, it, expect } from 'vitest';
import {
  calculateProposalTotals,
  type ProposalItemForCalculation,
} from '@/server/proposals/calculator';

describe('TASK-0058: Proposal Tax & Minor Unit Calculator', () => {
  // AC-2
  describe('AC-2: Gross pricing calculation (pricesIncludeTax: true)', () => {
    it('AC-2: calculates gross pricing with single 19% VAT item with zero floating-point drift', () => {
      // 119.00 EUR gross = 11900 cents gross. Net should be 10000 cents, Tax 1900 cents.
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 11900,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(11900);
      expect(result.taxMinor).toBe(1900);
      expect(result.totalMinor).toBe(11900);
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0]).toEqual({
        taxRateBasisPoints: 1900,
        taxRatePercentFormatted: '19.00',
        netMinor: 10000,
        taxMinor: 1900,
        grossMinor: 11900,
      });
    });

    it('AC-2: calculates gross pricing with mixed 19% and 7% items', () => {
      const items: ProposalItemForCalculation[] = [
        // 2800.00 EUR package at 19% (Gross)
        // Net = Math.round(280000 * 10000 / 11900) = Math.round(235294.1176) = 235294 cents
        // Tax = 280000 - 235294 = 44706 cents
        {
          unitPriceMinor: 280000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        // 53.50 EUR book/print at 7% (Gross), quantity 2 = 10700 cents
        // Net = Math.round(10700 * 10000 / 10700) = 10000 cents
        // Tax = 10700 - 10000 = 700 cents
        {
          unitPriceMinor: 5350,
          quantity: 2,
          taxRateBasisPoints: 700,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.totalMinor).toBe(280000 + 10700);
      expect(result.subtotalMinor).toBe(290700);
      expect(result.taxMinor).toBe(44706 + 700);

      const bucket19 = result.breakdown.find((b) => b.taxRateBasisPoints === 1900);
      expect(bucket19).toBeDefined();
      expect(bucket19?.grossMinor).toBe(280000);
      expect(bucket19?.netMinor).toBe(235294);
      expect(bucket19?.taxMinor).toBe(44706);
      expect(bucket19?.taxRatePercentFormatted).toBe('19.00');

      const bucket7 = result.breakdown.find((b) => b.taxRateBasisPoints === 700);
      expect(bucket7).toBeDefined();
      expect(bucket7?.grossMinor).toBe(10700);
      expect(bucket7?.netMinor).toBe(10000);
      expect(bucket7?.taxMinor).toBe(700);
      expect(bucket7?.taxRatePercentFormatted).toBe('7.00');
    });

    it('AC-2: handles rounding boundaries where net calculation has half-cent remainders', () => {
      // 10.00 EUR gross at 19% VAT
      // Net = Math.round(1000 * 10000 / 11900) = Math.round(840.336) = 840 cents
      // Tax = 1000 - 840 = 160 cents
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 1000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.totalMinor).toBe(1000);
      expect(result.taxMinor).toBe(160);
      expect(result.breakdown[0]?.netMinor).toBe(840);
      expect(result.breakdown[0]?.taxMinor).toBe(160);
      expect((result.breakdown[0]?.netMinor ?? 0) + (result.breakdown[0]?.taxMinor ?? 0)).toBe(
        1000,
      );
    });
  });

  // AC-3
  describe('AC-3: Net pricing calculation (pricesIncludeTax: false)', () => {
    it('AC-3: calculates net pricing with 19% VAT added on top', () => {
      // 100.00 EUR net = 10000 cents. Tax = 1900 cents. Total = 11900 cents.
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 10000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: false,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(10000);
      expect(result.taxMinor).toBe(1900);
      expect(result.totalMinor).toBe(11900);
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0]).toEqual({
        taxRateBasisPoints: 1900,
        taxRatePercentFormatted: '19.00',
        netMinor: 10000,
        taxMinor: 1900,
        grossMinor: 11900,
      });
    });

    it('AC-3: calculates net pricing with mixed 19% and 7% rates and multiple quantities', () => {
      const items: ProposalItemForCalculation[] = [
        // 1500.00 EUR net x 1 = 150000 cents at 19% -> Tax = 28500 cents
        {
          unitPriceMinor: 150000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        // 200.00 EUR net x 2 = 40000 cents at 7% -> Tax = 2800 cents
        {
          unitPriceMinor: 20000,
          quantity: 2,
          taxRateBasisPoints: 700,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: false,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(190000);
      expect(result.taxMinor).toBe(28500 + 2800);
      expect(result.totalMinor).toBe(190000 + 31300);

      const b19 = result.breakdown.find((b) => b.taxRateBasisPoints === 1900);
      expect(b19?.netMinor).toBe(150000);
      expect(b19?.taxMinor).toBe(28500);
      expect(b19?.grossMinor).toBe(178500);

      const b7 = result.breakdown.find((b) => b.taxRateBasisPoints === 700);
      expect(b7?.netMinor).toBe(40000);
      expect(b7?.taxMinor).toBe(2800);
      expect(b7?.grossMinor).toBe(42800);
    });

    it('AC-3: handles rounding on net pricing with odd cents', () => {
      // 33.33 EUR net = 3333 cents at 19%
      // Tax = Math.round(3333 * 1900 / 10000) = Math.round(633.27) = 633 cents
      // Gross = 3333 + 633 = 3966 cents
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 3333,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: false,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(3333);
      expect(result.taxMinor).toBe(633);
      expect(result.totalMinor).toBe(3966);
    });
  });

  // AC-4
  describe('AC-4: §19 UStG Kleinunternehmer calculation', () => {
    it('AC-4: sets tax to 0 minor units, total equals subtotal, and breakdown empty when isKleinunternehmer is true', () => {
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 250000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        {
          unitPriceMinor: 50000,
          quantity: 2,
          taxRateBasisPoints: 700,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: true,
      });

      expect(result.subtotalMinor).toBe(350000);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(350000);
      expect(result.breakdown).toEqual([]);
    });

    it('AC-4: ignores pricesIncludeTax setting in Kleinunternehmer mode', () => {
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 10000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const grossModeResult = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: true,
      });

      const netModeResult = calculateProposalTotals(items, {
        pricesIncludeTax: false,
        isKleinunternehmer: true,
      });

      expect(grossModeResult).toEqual(netModeResult);
      expect(grossModeResult.taxMinor).toBe(0);
      expect(grossModeResult.totalMinor).toBe(10000);
      expect(grossModeResult.subtotalMinor).toBe(10000);
    });
  });

  // Edge and abuse cases
  describe('Edge and boundary cases', () => {
    it('returns zeroes and empty breakdown when item list is empty', () => {
      const result = calculateProposalTotals([], {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result).toEqual({
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        breakdown: [],
      });
    });

    it('ignores unselected items (isSelected: false)', () => {
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 200000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        {
          unitPriceMinor: 50000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: false,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.totalMinor).toBe(200000);
    });

    it('ignores items with zero or negative quantity', () => {
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 10000,
          quantity: 0,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        {
          unitPriceMinor: 10000,
          quantity: -1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
        {
          unitPriceMinor: 15000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.totalMinor).toBe(15000);
    });

    it('handles zero tax rate (0 basis points) in regular tax mode', () => {
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 10000,
          quantity: 1,
          taxRateBasisPoints: 0,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: true,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(10000);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(10000);
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0]).toEqual({
        taxRateBasisPoints: 0,
        taxRatePercentFormatted: '0.00',
        netMinor: 10000,
        taxMinor: 0,
        grossMinor: 10000,
      });
    });

    it('handles large monetary amounts safely in 64-bit integer range', () => {
      // 5,000,000.00 EUR = 500,000,000 cents
      const items: ProposalItemForCalculation[] = [
        {
          unitPriceMinor: 500000000,
          quantity: 1,
          taxRateBasisPoints: 1900,
          isSelected: true,
        },
      ];

      const result = calculateProposalTotals(items, {
        pricesIncludeTax: false,
        isKleinunternehmer: false,
      });

      expect(result.subtotalMinor).toBe(500000000);
      expect(result.taxMinor).toBe(95000000);
      expect(result.totalMinor).toBe(595000000);
    });
  });
});

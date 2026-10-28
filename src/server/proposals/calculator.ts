export interface ProposalItemForCalculation {
  unitPriceMinor: number;
  quantity: number;
  taxRateBasisPoints: number;
  isSelected?: boolean;
}

export interface TaxRateBreakdown {
  taxRateBasisPoints: number;
  taxRatePercentFormatted: string; // e.g. "19.00", "7.00"
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
}

export interface TaxCalculationResult {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  breakdown: TaxRateBreakdown[];
}

export interface TaxCalculationOptions {
  pricesIncludeTax: boolean;
  isKleinunternehmer: boolean;
}

/**
 * Calculates proposal monetary totals and VAT breakdown in 64-bit integer minor units (cents).
 * Implements ADR-0018 §2.2:
 * - Operates strictly in integer minor units and basis points to eliminate IEEE-754 floating-point drift.
 * - In Kleinunternehmer mode (§19 UStG): tax is 0 minor units, total equals subtotal, breakdown is empty.
 * - In Gross mode (pricesIncludeTax: true): extracts Net and Tax from inclusive prices using:
 *     net = Math.round((gross * 10000) / (10000 + rate))
 *     tax = gross - net
 * - In Net mode (pricesIncludeTax: false): calculates Tax on top of net amounts using:
 *     tax = Math.round((net * rate) / 10000)
 *     gross = net + tax
 */
export function calculateProposalTotals(
  items: ProposalItemForCalculation[],
  options: TaxCalculationOptions,
): TaxCalculationResult {
  const selectedItems = items.filter((i) => i.isSelected !== false && i.quantity > 0);

  if (selectedItems.length === 0) {
    return {
      subtotalMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      breakdown: [],
    };
  }

  // §19 UStG Kleinunternehmer exemption: no VAT charged
  if (options.isKleinunternehmer) {
    const totalMinor = selectedItems.reduce(
      (sum, item) => sum + item.unitPriceMinor * item.quantity,
      0,
    );
    return {
      subtotalMinor: totalMinor,
      taxMinor: 0,
      totalMinor,
      breakdown: [],
    };
  }

  // Aggregate by tax rate basis points
  const rateBuckets = new Map<number, number>();
  for (const item of selectedItems) {
    const itemTotal = item.unitPriceMinor * item.quantity;
    const current = rateBuckets.get(item.taxRateBasisPoints) ?? 0;
    rateBuckets.set(item.taxRateBasisPoints, current + itemTotal);
  }

  // Sort descending by tax rate basis points for deterministic output (e.g. 1900, 700, 0)
  const sortedRates = Array.from(rateBuckets.keys()).sort((a, b) => b - a);

  let calculatedSubtotal = 0;
  let calculatedTax = 0;
  let calculatedTotal = 0;
  const breakdown: TaxRateBreakdown[] = [];

  for (const rateBasisPoints of sortedRates) {
    const amountMinor = rateBuckets.get(rateBasisPoints) ?? 0;
    let net = 0;
    let tax = 0;
    let gross = 0;

    if (options.pricesIncludeTax) {
      // Amount is Gross: Net = Math.round((Gross * 10000) / (10000 + Rate))
      gross = amountMinor;
      net = Math.round((gross * 10000) / (10000 + rateBasisPoints));
      tax = gross - net;
    } else {
      // Amount is Net: Tax = Math.round((Net * Rate) / 10000)
      net = amountMinor;
      tax = Math.round((net * rateBasisPoints) / 10000);
      gross = net + tax;
    }

    calculatedSubtotal += options.pricesIncludeTax ? gross : net;
    calculatedTax += tax;
    calculatedTotal += gross;

    breakdown.push({
      taxRateBasisPoints: rateBasisPoints,
      taxRatePercentFormatted: (rateBasisPoints / 100).toFixed(2),
      netMinor: net,
      taxMinor: tax,
      grossMinor: gross,
    });
  }

  return {
    subtotalMinor: calculatedSubtotal,
    taxMinor: calculatedTax,
    totalMinor: calculatedTotal,
    breakdown,
  };
}

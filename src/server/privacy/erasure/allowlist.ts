/**
 * Allowlist of tables containing client_id or contact_id columns
 * that are intentionally not erased by a domain erasure provider.
 *
 * Every entry must provide a concrete, documented justification.
 */

export interface ErasureCoverageExemption {
  tableName: string;
  reason: string;
}

export const ERASURE_COVERAGE_ALLOWLIST: readonly ErasureCoverageExemption[] = [];

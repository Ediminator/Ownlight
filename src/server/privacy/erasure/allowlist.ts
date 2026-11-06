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

export const ERASURE_COVERAGE_ALLOWLIST: readonly ErasureCoverageExemption[] = [
  {
    tableName: 'contracts',
    reason:
      'Legal contracts and signature records. DSAR erasure provider and statutory retention hold implementation is scheduled in TASK-0066 as part of Epic E6.',
  },
];

/**
 * Allowlist of tables containing client_id or contact_id columns
 * that are intentionally not exported by a domain export provider.
 *
 * Every entry must provide a concrete, documented justification.
 */

export interface ExportCoverageExemption {
  tableName: string;
  reason: string;
}

export const EXPORT_COVERAGE_ALLOWLIST: readonly ExportCoverageExemption[] = [
  {
    tableName: 'google_contacts_outbox',
    reason:
      'Internal ephemeral queue for asynchronous Google Contacts API operations, containing no independent personal data not already reflected in client_contacts and google_contacts_links.',
  },
];

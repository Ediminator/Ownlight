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
  // All current tables with client_id or contact_id columns are fully covered
  // by domain export providers:
  // - client_contacts -> subject, client
  // - client_addresses -> addresses
  // - client_tags -> tags
  // - client_notes -> notes
  // - client_timeline_events -> timeline
  // - consent_records -> consents
  // When future epics introduce ephemeral/internal tables with client_id or contact_id
  // that do not hold exportable personal data, register an exemption here with reasoning.
];

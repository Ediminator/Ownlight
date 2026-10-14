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
  // All current tables with client_id or contact_id columns are fully covered
  // by domain erasure providers:
  // - client_contacts -> contacts
  // - client_addresses -> addresses
  // - client_tags -> tags (removes client_tags join rows; tags table itself remains)
  // - client_notes -> notes
  // - client_timeline_events -> timeline
  // - consent_records -> consents
  // When future epics introduce tables with client_id or contact_id columns
  // that have statutory retention or non-deletable data, register an exemption here with reasoning.
  {
    tableName: 'projects',
    reason:
      'Temporary exemption until TASK-0035 registers projectsErasureProvider and active project legal holds.',
  },
  {
    tableName: 'project_participants',
    reason:
      'Temporary exemption until TASK-0035 registers projectsErasureProvider for project participant contact records.',
  },
];

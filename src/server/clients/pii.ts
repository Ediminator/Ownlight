/**
 * PII manifest for the clients and contacts domain (TASK-0009).
 * Defines all personal-data database columns introduced in this domain,
 * consumed by the automated data inventory docs test (AC-15),
 * GDPR Art. 15/20 data export (TASK-0015), and GDPR Art. 17 right to erasure (TASK-0016).
 */

export const CLIENT_PII_COLUMNS = [
  'clients.display_name',
  'clients.preferred_locale',
  'client_contacts.given_name',
  'client_contacts.family_name',
  'client_contacts.email',
  'client_contacts.email_normalized',
  'client_contacts.phone',
  'client_addresses.line1',
  'client_addresses.line2',
  'client_addresses.postal_code',
  'client_addresses.city',
  'client_addresses.region',
  'client_addresses.country_code',
  'tags.name',
  'client_notes.body',
] as const;

export type ClientPiiColumn = (typeof CLIENT_PII_COLUMNS)[number];

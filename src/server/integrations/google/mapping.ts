/**
 * Google People API Data Minimisation & Mapping (TASK-0021, ADR-0014).
 *
 * Implements strict GDPR Art. 5(1)(c) data minimisation:
 * Transmits ONLY given name, family name, and phone numbers for mobile caller ID.
 * Explicitly strips emails, postal addresses, client notes, photos, and internal CRM identifiers.
 */

export interface ContactForGoogleSync {
  givenName?: string | null;
  familyName?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

export interface GooglePersonName {
  givenName?: string;
  familyName?: string;
}

export interface GooglePersonPhone {
  value: string;
  type: string;
}

export interface GooglePersonPayload {
  names: GooglePersonName[];
  phoneNumbers?: GooglePersonPhone[];
  etag?: string;
}

export const FORBIDDEN_PEOPLE_FIELDS = [
  'emailAddresses',
  'addresses',
  'biographies',
  'photos',
  'userDefined',
  'sipAddresses',
  'relations',
  'occupations',
  'organizations',
  'interests',
  'client_id',
  'clientId',
  'contact_id',
  'contactId',
] as const;

/**
 * Transforms a client contact into a strictly minimised Google People API Person resource payload.
 */
export function mapContactToGooglePerson(
  contact: ContactForGoogleSync,
  etag?: string,
): GooglePersonPayload {
  const given = contact.givenName?.trim();
  const family = contact.familyName?.trim();
  const phone = contact.phone?.trim();

  const nameEntry: GooglePersonName = {};
  if (given && given.length > 0) {
    nameEntry.givenName = given;
  }
  if (family && family.length > 0) {
    nameEntry.familyName = family;
  }

  const names: GooglePersonName[] = Object.keys(nameEntry).length > 0 ? [nameEntry] : [];

  const payload: GooglePersonPayload = {
    names,
  };

  if (phone && phone.length > 0) {
    payload.phoneNumbers = [
      {
        value: phone,
        type: 'mobile',
      },
    ];
  }

  if (etag) {
    payload.etag = etag;
  }

  return payload;
}

/**
 * Validates that an outgoing JSON payload does not contain any forbidden fields.
 * Throws an error in development/test if any prohibited field is present.
 */
export function assertMinimisedPayload(payload: Record<string, unknown>): void {
  for (const forbidden of FORBIDDEN_PEOPLE_FIELDS) {
    if (forbidden in payload && payload[forbidden] !== undefined) {
      throw new Error(
        `Data minimisation violation: prohibited field "${forbidden}" found in People API payload.`,
      );
    }
  }
}

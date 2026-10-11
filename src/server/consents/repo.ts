import { eq, and, sql, inArray } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clientContacts } from '@/server/db/schema/clients';
import {
  consentRecords,
  type ConsentRecord,
  type ConsentPurpose,
  type ConsentStatus,
  type ConsentMethod,
} from '@/server/db/schema/consents';
import type { ActorType } from '@/server/db/schema/audit';
import { generateUuidV7 } from '@/lib/id';

export interface ConsentItemView {
  id: string;
  contactId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  effectiveOn: string;
  method: ConsentMethod;
  scope: string | null;
  evidenceNote: string | null;
  recordedByActorType: ActorType;
  createdAt: Date;
}

export interface ContactConsentSummary {
  contactId: string;
  contactName: string;
  isPrimary: boolean;
  marketing: ConsentItemView | null;
  imageUsage: ConsentItemView | null;
  history: ConsentItemView[];
}

export interface ClientConsentsResult {
  clientId: string;
  contacts: ContactConsentSummary[];
}

/**
 * Checks whether a contact belongs to the given client.
 * Returns the contact record if found, or null otherwise.
 */
export async function getContactForClient(
  contactId: string,
  clientId: string,
  client: DbClient = defaultDb,
): Promise<{ id: string; givenName: string | null; familyName: string | null } | null> {
  const [row] = await client
    .select({
      id: clientContacts.id,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
    })
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .limit(1);

  return row ?? null;
}

/**
 * Retrieves the latest consent record for a contact and purpose.
 * Sorted by (effective_on DESC, created_at DESC, id DESC).
 */
export async function getLatestConsentRecord(
  contactId: string,
  purpose: ConsentPurpose,
  client: DbClient = defaultDb,
): Promise<ConsentRecord | null> {
  const [row] = await client
    .select()
    .from(consentRecords)
    .where(and(eq(consentRecords.contactId, contactId), eq(consentRecords.purpose, purpose)))
    .orderBy(
      sql`${consentRecords.effectiveOn} DESC`,
      sql`${consentRecords.createdAt} DESC`,
      sql`${consentRecords.id} DESC`,
    )
    .limit(1);

  return row ?? null;
}

/**
 * Inserts a new immutable consent record.
 */
export async function insertConsentRecord(
  record: {
    id?: string;
    contactId: string;
    purpose: ConsentPurpose;
    status: ConsentStatus;
    effectiveOn: string;
    method: ConsentMethod;
    scope?: string | null;
    evidenceNote?: string | null;
    recordedByActorType: ActorType;
    recordedByActorId?: string | null;
  },
  client: DbClient = defaultDb,
): Promise<ConsentRecord> {
  const id = record.id ?? generateUuidV7();
  const [row] = await client
    .insert(consentRecords)
    .values({
      id,
      contactId: record.contactId,
      purpose: record.purpose,
      status: record.status,
      effectiveOn: record.effectiveOn,
      method: record.method,
      scope: record.scope ?? null,
      evidenceNote: record.evidenceNote ?? null,
      recordedByActorType: record.recordedByActorType,
      recordedByActorId: record.recordedByActorId ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to insert consent record');
  }

  return row;
}

/**
 * Lists consent status and full history per contact for a client.
 * Returns explicit projection columns only.
 */
export async function listConsentsForClient(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<ClientConsentsResult> {
  // 1. Get all contacts for this client
  const contacts = await client
    .select({
      id: clientContacts.id,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
      isPrimary: clientContacts.isPrimary,
    })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(sql`${clientContacts.isPrimary} DESC`, sql`${clientContacts.createdAt} ASC`);

  if (contacts.length === 0) {
    return {
      clientId,
      contacts: [],
    };
  }

  const contactIds = contacts.map((c) => c.id);

  // 2. Fetch all consent records for these contacts
  const allRecords = await client
    .select({
      id: consentRecords.id,
      contactId: consentRecords.contactId,
      purpose: consentRecords.purpose,
      status: consentRecords.status,
      effectiveOn: consentRecords.effectiveOn,
      method: consentRecords.method,
      scope: consentRecords.scope,
      evidenceNote: consentRecords.evidenceNote,
      recordedByActorType: consentRecords.recordedByActorType,
      createdAt: consentRecords.createdAt,
    })
    .from(consentRecords)
    .where(inArray(consentRecords.contactId, contactIds))
    .orderBy(
      sql`${consentRecords.effectiveOn} DESC`,
      sql`${consentRecords.createdAt} DESC`,
      sql`${consentRecords.id} DESC`,
    );

  // 3. Assemble per-contact status and history
  const recordsByContact = new Map<string, ConsentItemView[]>();
  for (const r of allRecords) {
    const list = recordsByContact.get(r.contactId) ?? [];
    list.push(r);
    recordsByContact.set(r.contactId, list);
  }

  const contactSummaries: ContactConsentSummary[] = contacts.map((contact) => {
    const history = recordsByContact.get(contact.id) ?? [];
    const marketing = history.find((r) => r.purpose === 'marketing') ?? null;
    const imageUsage = history.find((r) => r.purpose === 'image_usage') ?? null;
    const fullName =
      [contact.givenName, contact.familyName].filter(Boolean).join(' ') || 'Unnamed Contact';

    return {
      contactId: contact.id,
      contactName: fullName,
      isPrimary: contact.isPrimary,
      marketing,
      imageUsage,
      history,
    };
  });

  return {
    clientId,
    contacts: contactSummaries,
  };
}

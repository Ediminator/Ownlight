import { db as defaultDb, type DbClient } from '@/server/db/client';
import type { AuthContext } from '@/server/auth/guards';
import { audit, type ActorType } from '@/server/audit';
import { logger } from '@/server/log';

function getAuditActor(auth: AuthContext): { actorType: ActorType; actorId: string | null } {
  const actorType: ActorType = auth.authType === 'apiKey' ? 'token' : (auth.user.role as ActorType);
  const actorId =
    auth.authType === 'apiKey' ? (auth.apiKey?.id ?? auth.apiKey?.prefix ?? null) : auth.user.id;
  return { actorType, actorId };
}
import { getStudioSettings } from '@/server/settings/repo';
import type { ClientLocale, ClientKind, AddressType } from '@/server/db/schema/clients';
import { normalizeEmail } from './schema';
import {
  findDuplicateEmails,
  getClientById,
  listClients,
  insertClientWithPrimaryContact,
  updateClientRecord,
  countClientContacts,
  insertContact,
  updateContactRecord,
  deleteContactRecord,
  upsertAddressRecord,
  deleteAddressRecord,
  setClientTagsRecord,
  listAllTags,
  type DuplicateEmailMatch,
  type ClientWithRelations,
  type ListClientsResult,
  type ClientTagItem,
  type TagSummaryItem,
} from './repo';

export type ServiceResult<T> =
  | { success: true; data: T; code?: never; error?: never; duplicates?: never; fields?: never }
  | {
      success: false;
      code:
        | 'VALIDATION_FAILED'
        | 'NOT_FOUND'
        | 'DUPLICATE_EMAIL'
        | 'LIMIT_EXCEEDED'
        | 'CLIENT_NEEDS_CONTACT'
        | 'UNAUTHORIZED'
        | 'FORBIDDEN';
      error: string;
      data?: { duplicates?: DuplicateEmailMatch[] };
      duplicates?: DuplicateEmailMatch[];
      fields?: string[];
    };

/**
 * Creates a new client and primary contact.
 */
export async function createClient(
  input: {
    kind: ClientKind;
    displayName: string;
    preferredLocale?: ClientLocale;
    googleContactsSyncEnabled?: boolean;
    primaryContact: {
      givenName?: string | null;
      familyName?: string | null;
      email?: string | null;
      phone?: string | null;
    };
    acknowledgeDuplicates?: boolean;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ clientId: string }>> {
  // 1. Resolve preferred locale (defaults to studio_settings.default_locale)
  let locale: ClientLocale = input.preferredLocale ?? 'en';
  if (!input.preferredLocale) {
    try {
      const settings = await getStudioSettings(client);
      locale = settings.default_locale === 'de' ? 'de' : 'en';
    } catch {
      locale = 'en';
    }
  }

  // 2. Duplicate detection by normalized email
  const emailNormalized = normalizeEmail(input.primaryContact.email);
  if (emailNormalized) {
    const duplicates = await findDuplicateEmails(emailNormalized, null, client);
    if (duplicates.length > 0 && !input.acknowledgeDuplicates) {
      logger.info(
        { action: 'client.create.duplicate_detected', count: duplicates.length },
        'Duplicate email detected during client creation',
      );
      return {
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'DUPLICATE_EMAIL',
        duplicates,
        data: { duplicates },
      };
    }
  }

  // 3. Insert client and primary contact
  const { clientId, contactId } = await insertClientWithPrimaryContact(
    {
      kind: input.kind,
      displayName: input.displayName,
      preferredLocale: locale,
      googleContactsSyncEnabled: input.googleContactsSyncEnabled,
    },
    {
      givenName: input.primaryContact.givenName,
      familyName: input.primaryContact.familyName,
      email: input.primaryContact.email ? input.primaryContact.email.trim() : null,
      emailNormalized,
      phone: input.primaryContact.phone ? input.primaryContact.phone.trim() : null,
    },
    client,
    { actorType: 'owner', actorId: getAuditActor(auth).actorId },
  );

  // 4. Audit logging
  const { actorType, actorId } = getAuditActor(auth);

  const metadata: Record<string, unknown> = {};
  if (input.acknowledgeDuplicates) {
    metadata.duplicate_acknowledged = true;
  }

  await audit(
    {
      actorType,
      actorId,
      action: 'client.created',
      targetType: 'client',
      targetId: clientId,
      outcome: 'success',
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    },
    client,
  );

  logger.info({ clientId, contactId, action: 'client.created' }, 'Client created successfully');

  return {
    success: true,
    data: { clientId },
  };
}

/**
 * Updates a client record.
 */
export async function updateClient(
  input: {
    clientId: string;
    kind?: ClientKind;
    displayName?: string;
    preferredLocale?: ClientLocale;
    googleContactsSyncEnabled?: boolean;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ clientId: string }>> {
  const existing = await getClientById(input.clientId, client);
  if (!existing) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    };
  }

  const changedFields: string[] = [];
  if (input.kind !== undefined && input.kind !== existing.client.kind) {
    changedFields.push('kind');
  }
  if (input.displayName !== undefined && input.displayName !== existing.client.displayName) {
    changedFields.push('display_name');
  }
  if (
    input.preferredLocale !== undefined &&
    input.preferredLocale !== existing.client.preferredLocale
  ) {
    changedFields.push('preferred_locale');
  }
  if (
    input.googleContactsSyncEnabled !== undefined &&
    input.googleContactsSyncEnabled !== existing.client.googleContactsSyncEnabled
  ) {
    changedFields.push('google_contacts_sync_enabled');
  }

  await updateClientRecord(
    input.clientId,
    {
      kind: input.kind,
      displayName: input.displayName,
      preferredLocale: input.preferredLocale,
      googleContactsSyncEnabled: input.googleContactsSyncEnabled,
    },
    client,
  );

  const { actorType, actorId } = getAuditActor(auth);

  await audit(
    {
      actorType,
      actorId,
      action: 'client.updated',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { changed_fields: changedFields },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, action: 'client.updated' },
    'Client updated successfully',
  );

  return {
    success: true,
    data: { clientId: input.clientId },
  };
}

/**
 * Adds a new contact to a client, enforcing duplicate check and 10 contacts limit.
 */
export async function addContact(
  input: {
    clientId: string;
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
    acknowledgeDuplicates?: boolean;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ contactId: string }>> {
  // Verify client exists
  const existing = await getClientById(input.clientId, client);
  if (!existing) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // Check 10-contact limit (AC-7)
  const contactCount = await countClientContacts(input.clientId, client);
  if (contactCount >= 10) {
    return {
      success: false,
      code: 'LIMIT_EXCEEDED',
      error: 'LIMIT_EXCEEDED',
    };
  }

  // Duplicate email check
  const emailNormalized = normalizeEmail(input.email);
  if (emailNormalized) {
    const duplicates = await findDuplicateEmails(emailNormalized, null, client);
    if (duplicates.length > 0 && !input.acknowledgeDuplicates) {
      return {
        success: false,
        code: 'DUPLICATE_EMAIL',
        error: 'DUPLICATE_EMAIL',
        duplicates,
        data: { duplicates },
      };
    }
  }

  const inserted = await insertContact(
    input.clientId,
    {
      givenName: input.givenName,
      familyName: input.familyName,
      email: input.email ? input.email.trim() : null,
      emailNormalized,
      phone: input.phone ? input.phone.trim() : null,
      isPrimary: input.isPrimary,
    },
    client,
    getAuditActor(auth),
  );

  const { actorType, actorId } = getAuditActor(auth);

  const metadata: Record<string, unknown> = {
    contact_id: inserted.id,
  };
  if (input.acknowledgeDuplicates) {
    metadata.duplicate_acknowledged = true;
  }

  await audit(
    {
      actorType,
      actorId,
      action: 'client.contact.added',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata,
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, contactId: inserted.id, action: 'client.contact.added' },
    'Contact added successfully',
  );

  return {
    success: true,
    data: { contactId: inserted.id },
  };
}

/**
 * Updates an existing contact for a client.
 */
export async function updateContact(
  input: {
    clientId: string;
    contactId: string;
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
    acknowledgeDuplicates?: boolean;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ contactId: string }>> {
  const existingClient = await getClientById(input.clientId, client);
  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const existingContact = existingClient.contacts.find((c) => c.id === input.contactId);
  if (!existingContact) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // Duplicate email check
  let emailNormalized: string | null | undefined = undefined;
  if (input.email !== undefined) {
    emailNormalized = normalizeEmail(input.email);
    if (emailNormalized && emailNormalized !== existingContact.emailNormalized) {
      const duplicates = await findDuplicateEmails(emailNormalized, input.contactId, client);
      if (duplicates.length > 0 && !input.acknowledgeDuplicates) {
        return {
          success: false,
          code: 'DUPLICATE_EMAIL',
          error: 'DUPLICATE_EMAIL',
          duplicates,
          data: { duplicates },
        };
      }
    }
  }

  const changedFields: string[] = [];
  if (input.givenName !== undefined && input.givenName !== existingContact.givenName) {
    changedFields.push('given_name');
  }
  if (input.familyName !== undefined && input.familyName !== existingContact.familyName) {
    changedFields.push('family_name');
  }
  if (input.email !== undefined && input.email !== existingContact.email) {
    changedFields.push('email');
  }
  if (input.phone !== undefined && input.phone !== existingContact.phone) {
    changedFields.push('phone');
  }
  if (input.isPrimary !== undefined && input.isPrimary !== existingContact.isPrimary) {
    changedFields.push('is_primary');
  }

  const updated = await updateContactRecord(
    input.clientId,
    input.contactId,
    {
      givenName: input.givenName,
      familyName: input.familyName,
      email: input.email ? input.email.trim() : input.email,
      emailNormalized: emailNormalized !== undefined ? emailNormalized : undefined,
      phone: input.phone ? input.phone.trim() : input.phone,
      isPrimary: input.isPrimary,
    },
    client,
  );

  if (!updated) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const { actorType, actorId } = getAuditActor(auth);

  const metadata: Record<string, unknown> = {
    contact_id: input.contactId,
    changed_fields: changedFields,
  };
  if (input.acknowledgeDuplicates) {
    metadata.duplicate_acknowledged = true;
  }

  await audit(
    {
      actorType,
      actorId,
      action: 'client.contact.updated',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata,
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, contactId: input.contactId, action: 'client.contact.updated' },
    'Contact updated successfully',
  );

  return {
    success: true,
    data: { contactId: input.contactId },
  };
}

/**
 * Removes a contact from a client.
 * Invariants: Cannot remove only contact (CLIENT_NEEDS_CONTACT); oldest remaining contact becomes primary if needed.
 */
export async function removeContact(
  input: {
    clientId: string;
    contactId: string;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ contactId: string }>> {
  // 1. Verify client and contact existence strictly scoped by clientId (AC-12 IDOR guard)
  const existingClient = await getClientById(input.clientId, client);
  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const existingContact = existingClient.contacts.find((c) => c.id === input.contactId);
  if (!existingContact) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  // 2. Check contact count (AC-6 invariant: client must have at least one contact)
  if (existingClient.contacts.length <= 1) {
    return {
      success: false,
      code: 'CLIENT_NEEDS_CONTACT',
      error: 'CLIENT_NEEDS_CONTACT',
    };
  }

  const result = await deleteContactRecord(
    input.clientId,
    input.contactId,
    client,
    getAuditActor(auth),
  );
  if (!result) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const { actorType, actorId } = getAuditActor(auth);

  await audit(
    {
      actorType,
      actorId,
      action: 'client.contact.removed',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { contact_id: input.contactId },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, contactId: input.contactId, action: 'client.contact.removed' },
    'Contact removed successfully',
  );

  return {
    success: true,
    data: { contactId: input.contactId },
  };
}

/**
 * Upserts a postal or billing address for a client.
 */
export async function upsertAddress(
  input: {
    clientId: string;
    type: AddressType;
    line1: string;
    line2?: string | null;
    postalCode?: string;
    postal_code?: string;
    city: string;
    region?: string | null;
    countryCode?: string;
    country_code?: string;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ addressId: string }>> {
  const postalCode = (input.postalCode ?? input.postal_code ?? '').trim();
  const countryCode = (input.countryCode ?? input.country_code ?? '').trim().toUpperCase();

  const existingClient = await getClientById(input.clientId, client);
  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  const upserted = await upsertAddressRecord(
    input.clientId,
    {
      type: input.type,
      line1: input.line1.trim(),
      line2: input.line2 ? input.line2.trim() : null,
      postalCode,
      city: input.city.trim(),
      region: input.region ? input.region.trim() : null,
      countryCode,
    },
    client,
  );

  const { actorType, actorId } = getAuditActor(auth);

  await audit(
    {
      actorType,
      actorId,
      action: 'client.address.upserted',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: {
        address_type: input.type,
        changed_fields: ['line1', 'city', 'postal_code', 'country_code'],
      },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, addressType: input.type, action: 'client.address.upserted' },
    'Address upserted successfully',
  );

  return {
    success: true,
    data: { addressId: upserted.id },
  };
}

/**
 * Removes an address from a client by type.
 */
export async function removeAddress(
  input: {
    clientId: string;
    type: AddressType;
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ type: AddressType }>> {
  const existingClient = await getClientById(input.clientId, client);
  if (!existingClient) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  await deleteAddressRecord(input.clientId, input.type, client);

  const { actorType, actorId } = getAuditActor(auth);

  await audit(
    {
      actorType,
      actorId,
      action: 'client.address.removed',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: { address_type: input.type },
    },
    client,
  );

  logger.info(
    { clientId: input.clientId, addressType: input.type, action: 'client.address.removed' },
    'Address removed successfully',
  );

  return {
    success: true,
    data: { type: input.type },
  };
}

/**
 * Retrieves client by ID with all relations.
 */
export async function getClient(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<ServiceResult<ClientWithRelations>> {
  const result = await getClientById(clientId, client);
  if (!result) {
    return { success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' };
  }

  return {
    success: true,
    data: result,
  };
}

/**
 * Lists clients with pagination, optional search (q), and optional tag filter (tagId).
 * Search terms are never logged or stored.
 */
export async function getClientList(
  page = 1,
  pageSize = 25,
  qOrClient?: string | DbClient,
  tagId?: string,
  client: DbClient = defaultDb,
): Promise<ServiceResult<ListClientsResult>> {
  let q: string | undefined;
  let dbClient: DbClient = defaultDb;

  if (qOrClient && typeof qOrClient === 'object') {
    dbClient = qOrClient;
  } else if (typeof qOrClient === 'string') {
    q = qOrClient;
    dbClient = client;
  }

  const result = await listClients({ page, pageSize, q, tagId }, dbClient);
  return {
    success: true,
    data: result,
  };
}

/**
 * Replaces a client's tag set. Reuses existing tags by normalized name.
 * Audited with tag_count and created_tag_count only (no tag names in audit metadata or logs).
 */
export async function setClientTags(
  input: {
    clientId: string;
    tagNames: string[];
  },
  auth: AuthContext,
  client: DbClient = defaultDb,
): Promise<ServiceResult<{ clientId: string; tags: ClientTagItem[] }>> {
  // 1. Enforce max 20 distinct tag names per client (AC-2)
  const normalizedSet = new Set<string>();
  for (const name of input.tagNames) {
    normalizedSet.add(name.trim().toLowerCase());
  }

  if (normalizedSet.size > 20) {
    return {
      success: false,
      code: 'LIMIT_EXCEEDED',
      error: 'LIMIT_EXCEEDED',
    };
  }

  // 2. Execute replacement in database
  const result = await setClientTagsRecord(input.clientId, input.tagNames, client);
  if (!result) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    };
  }

  // 3. Audit logging with tag counts only (no tag names)
  const { actorType, actorId } = getAuditActor(auth);

  await audit(
    {
      actorType,
      actorId,
      action: 'client.tags.changed',
      targetType: 'client',
      targetId: input.clientId,
      outcome: 'success',
      metadata: {
        tag_count: result.tagCount,
        created_tag_count: result.createdTagCount,
      },
    },
    client,
  );

  // 4. Structured logging without tag names
  logger.info(
    {
      clientId: input.clientId,
      tagCount: result.tagCount,
      createdTagCount: result.createdTagCount,
      action: 'client.tags.changed',
    },
    'Client tags updated successfully',
  );

  return {
    success: true,
    data: {
      clientId: input.clientId,
      tags: result.tags,
    },
  };
}

/**
 * Lists all tags with their client count, sorted by name ascending.
 */
export async function listTags(
  client: DbClient = defaultDb,
): Promise<ServiceResult<TagSummaryItem[]>> {
  const result = await listAllTags(client);
  return {
    success: true,
    data: result,
  };
}

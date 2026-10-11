import { eq, and, asc, count, ne, inArray, sql, type SQL } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  clients,
  clientContacts,
  clientAddresses,
  type Client,
  type ClientContact,
  type ClientAddress,
  type ClientKind,
  type ClientLocale,
  type AddressType,
} from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import type { ActorType } from '@/server/db/schema/audit';
import { recordTimelineEvent } from '@/server/timeline/service';
import { escapeLikeWildcards } from './schema';
import { generateUuidV7 } from '@/lib/id';

export interface DuplicateEmailMatch {
  clientId: string;
  displayName: string;
}

export interface ClientTagItem {
  id: string;
  name: string;
}

export interface TagSummaryItem {
  id: string;
  name: string;
  clientCount: number;
}

export interface ClientWithRelations {
  client: Client;
  contacts: ClientContact[];
  addresses: ClientAddress[];
  tags: ClientTagItem[];
}

export interface ClientListItem {
  id: string;
  kind: ClientKind;
  displayName: string;
  primaryContact: {
    givenName: string | null;
    familyName: string | null;
    email: string | null;
    phone: string | null;
  };
  tags: ClientTagItem[];
}

export interface ListClientsOptions {
  page?: number;
  pageSize?: number;
  q?: string;
  tagId?: string;
}

export interface ListClientsResult {
  items: ClientListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Checks for existing contacts sharing the same normalized email address.
 * Excludes the given contactId if updating an existing contact.
 */
export async function findDuplicateEmails(
  emailNormalized: string,
  excludeContactId?: string | null,
  client: DbClient = defaultDb,
): Promise<DuplicateEmailMatch[]> {
  const conditions = [eq(clientContacts.emailNormalized, emailNormalized)];
  if (excludeContactId) {
    conditions.push(ne(clientContacts.id, excludeContactId));
  }

  const rows = await client
    .select({
      clientId: clientContacts.clientId,
      displayName: clients.displayName,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clientContacts.clientId, clients.id))
    .where(and(...conditions));

  return rows;
}

/**
 * Retrieves a client along with all its contacts, addresses, and tags.
 */
export async function getClientById(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<ClientWithRelations | null> {
  const [clientRow] = await client
    .select({
      id: clients.id,
      kind: clients.kind,
      displayName: clients.displayName,
      preferredLocale: clients.preferredLocale,
      lastActivityAt: clients.lastActivityAt,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    return null;
  }

  const contacts = await client
    .select({
      id: clientContacts.id,
      clientId: clientContacts.clientId,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
      email: clientContacts.email,
      emailNormalized: clientContacts.emailNormalized,
      phone: clientContacts.phone,
      isPrimary: clientContacts.isPrimary,
      createdAt: clientContacts.createdAt,
      updatedAt: clientContacts.updatedAt,
    })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(asc(clientContacts.createdAt), asc(clientContacts.id));

  const addresses = await client
    .select({
      id: clientAddresses.id,
      clientId: clientAddresses.clientId,
      type: clientAddresses.type,
      line1: clientAddresses.line1,
      line2: clientAddresses.line2,
      postalCode: clientAddresses.postalCode,
      city: clientAddresses.city,
      region: clientAddresses.region,
      countryCode: clientAddresses.countryCode,
      createdAt: clientAddresses.createdAt,
      updatedAt: clientAddresses.updatedAt,
    })
    .from(clientAddresses)
    .where(eq(clientAddresses.clientId, clientId))
    .orderBy(asc(clientAddresses.type));

  const clientTagRows = await client
    .select({
      id: tags.id,
      name: tags.name,
    })
    .from(clientTags)
    .innerJoin(tags, eq(clientTags.tagId, tags.id))
    .where(eq(clientTags.clientId, clientId))
    .orderBy(asc(tags.name), asc(tags.id));

  return {
    client: clientRow,
    contacts,
    addresses,
    tags: clientTagRows,
  };
}

/**
 * Lists clients with pagination and optional search (q) and tag filtering (tagId).
 * Escapes LIKE wildcards in q and searches across display_name, contacts, and tags.
 */
export async function listClients(
  optionsOrPage: ListClientsOptions | number = 1,
  pageSizeOrClient: number | DbClient = 25,
  maybeClient: DbClient = defaultDb,
): Promise<ListClientsResult> {
  let page = 1;
  let pageSize = 25;
  let q: string | undefined;
  let tagId: string | undefined;
  let client: DbClient = defaultDb;

  if (typeof optionsOrPage === 'number') {
    page = optionsOrPage;
    if (typeof pageSizeOrClient === 'number') {
      pageSize = pageSizeOrClient;
      client = maybeClient;
    } else {
      client = pageSizeOrClient;
    }
  } else {
    page = optionsOrPage.page ?? 1;
    pageSize = optionsOrPage.pageSize ?? 25;
    q = optionsOrPage.q;
    tagId = optionsOrPage.tagId;
    if (typeof pageSizeOrClient !== 'number') {
      client = pageSizeOrClient;
    } else {
      client = maybeClient;
    }
  }

  const offset = (page - 1) * pageSize;
  const whereConditions: SQL[] = [];

  if (tagId) {
    whereConditions.push(
      sql`EXISTS (
        SELECT 1 FROM client_tags
        WHERE client_tags.client_id = ${clients.id}
        AND client_tags.tag_id = ${tagId}
      )`,
    );
  }

  if (q && q.trim().length > 0) {
    const escapedPattern = `%${escapeLikeWildcards(q.trim())}%`;
    whereConditions.push(
      sql`(
        ${clients.displayName} ILIKE ${escapedPattern} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM client_contacts
          WHERE client_contacts.client_id = ${clients.id}
          AND (
            client_contacts.given_name ILIKE ${escapedPattern} ESCAPE '\\'
            OR client_contacts.family_name ILIKE ${escapedPattern} ESCAPE '\\'
            OR client_contacts.email_normalized ILIKE ${escapedPattern} ESCAPE '\\'
            OR client_contacts.phone ILIKE ${escapedPattern} ESCAPE '\\'
          )
        )
        OR EXISTS (
          SELECT 1 FROM client_tags
          JOIN tags ON tags.id = client_tags.tag_id
          WHERE client_tags.client_id = ${clients.id}
          AND tags.name ILIKE ${escapedPattern} ESCAPE '\\'
        )
      )`,
    );
  }

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  const countQuery = client.select({ total: count() }).from(clients);
  const [totalRow] = whereClause ? await countQuery.where(whereClause) : await countQuery;
  const total = totalRow?.total ?? 0;

  const dataQuery = client
    .select({
      id: clients.id,
      kind: clients.kind,
      displayName: clients.displayName,
    })
    .from(clients);

  const clientRows = whereClause
    ? await dataQuery
        .where(whereClause)
        .orderBy(asc(clients.displayName), asc(clients.id))
        .limit(pageSize)
        .offset(offset)
    : await dataQuery
        .orderBy(asc(clients.displayName), asc(clients.id))
        .limit(pageSize)
        .offset(offset);

  if (clientRows.length === 0) {
    return {
      items: [],
      total,
      page,
      pageSize,
    };
  }

  const clientIds = clientRows.map((c) => c.id);
  const primaryContacts = await client
    .select({
      clientId: clientContacts.clientId,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
      email: clientContacts.email,
      phone: clientContacts.phone,
    })
    .from(clientContacts)
    .where(and(inArray(clientContacts.clientId, clientIds), eq(clientContacts.isPrimary, true)));

  const primaryContactMap = new Map(primaryContacts.map((c) => [c.clientId, c]));

  const clientTagRows = await client
    .select({
      clientId: clientTags.clientId,
      id: tags.id,
      name: tags.name,
    })
    .from(clientTags)
    .innerJoin(tags, eq(clientTags.tagId, tags.id))
    .where(inArray(clientTags.clientId, clientIds))
    .orderBy(asc(tags.name), asc(tags.id));

  const clientTagsMap = new Map<string, ClientTagItem[]>();
  for (const row of clientTagRows) {
    const existing = clientTagsMap.get(row.clientId) ?? [];
    existing.push({ id: row.id, name: row.name });
    clientTagsMap.set(row.clientId, existing);
  }

  const items: ClientListItem[] = clientRows.map((c) => {
    const primary = primaryContactMap.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      displayName: c.displayName,
      primaryContact: {
        givenName: primary?.givenName ?? null,
        familyName: primary?.familyName ?? null,
        email: primary?.email ?? null,
        phone: primary?.phone ?? null,
      },
      tags: clientTagsMap.get(c.id) ?? [],
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
  };
}

/**
 * Replaces a client's tag set within a transaction, reusing existing tags by normalized name.
 */
export async function setClientTagsRecord(
  clientId: string,
  tagNames: string[],
  dbClient: DbClient = defaultDb,
): Promise<{ tagCount: number; createdTagCount: number; tags: ClientTagItem[] } | null> {
  return await dbClient.transaction(async (tx) => {
    const [clientRow] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientRow) {
      return null;
    }

    const now = new Date();

    // Deduplicate tag names case-insensitively within request, keeping first spelling
    const uniqueRequestTags: { name: string; nameNormalized: string }[] = [];
    const seenNormalized = new Set<string>();

    for (const rawName of tagNames) {
      const trimmed = rawName.trim();
      const normalized = trimmed.toLowerCase();
      if (!seenNormalized.has(normalized)) {
        seenNormalized.add(normalized);
        uniqueRequestTags.push({ name: trimmed, nameNormalized: normalized });
      }
    }

    const resolvedTags: ClientTagItem[] = [];
    let createdTagCount = 0;

    if (uniqueRequestTags.length > 0) {
      const normalizedList = uniqueRequestTags.map((t) => t.nameNormalized);
      const existingTagRows = await tx
        .select({
          id: tags.id,
          name: tags.name,
          nameNormalized: tags.nameNormalized,
        })
        .from(tags)
        .where(inArray(tags.nameNormalized, normalizedList));

      const existingMap = new Map(existingTagRows.map((t) => [t.nameNormalized, t]));

      for (const reqTag of uniqueRequestTags) {
        const existing = existingMap.get(reqTag.nameNormalized);
        if (existing) {
          resolvedTags.push({ id: existing.id, name: existing.name });
        } else {
          const tagId = generateUuidV7();
          const [insertedTag] = await tx
            .insert(tags)
            .values({
              id: tagId,
              name: reqTag.name,
              nameNormalized: reqTag.nameNormalized,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();

          if (insertedTag) {
            createdTagCount++;
            resolvedTags.push({ id: insertedTag.id, name: insertedTag.name });
            existingMap.set(insertedTag.nameNormalized, insertedTag);
          } else {
            const [conflictTag] = await tx
              .select({ id: tags.id, name: tags.name, nameNormalized: tags.nameNormalized })
              .from(tags)
              .where(eq(tags.nameNormalized, reqTag.nameNormalized))
              .limit(1);
            if (conflictTag) {
              resolvedTags.push({ id: conflictTag.id, name: conflictTag.name });
            }
          }
        }
      }
    }

    // Replace client's tag set
    await tx.delete(clientTags).where(eq(clientTags.clientId, clientId));

    if (resolvedTags.length > 0) {
      await tx.insert(clientTags).values(
        resolvedTags.map((t) => ({
          clientId,
          tagId: t.id,
          createdAt: now,
        })),
      );
    }

    // Bump client last_activity_at and updated_at
    await tx
      .update(clients)
      .set({
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(clients.id, clientId));

    resolvedTags.sort((a, b) => a.name.localeCompare(b.name));

    return {
      tagCount: resolvedTags.length,
      createdTagCount,
      tags: resolvedTags,
    };
  });
}

/**
 * Lists all tags with their client count, sorted by name ascending.
 * Includes unused tags (clientCount: 0).
 */
export async function listAllTags(client: DbClient = defaultDb): Promise<TagSummaryItem[]> {
  const rows = await client
    .select({
      id: tags.id,
      name: tags.name,
      clientCount: count(clientTags.clientId),
    })
    .from(tags)
    .leftJoin(clientTags, eq(tags.id, clientTags.tagId))
    .groupBy(tags.id, tags.name)
    .orderBy(asc(tags.name), asc(tags.id));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientCount: r.clientCount,
  }));
}

/**
 * Inserts a new client and its mandatory primary contact within a single transaction.
 */
export async function insertClientWithPrimaryContact(
  clientData: {
    kind: ClientKind;
    displayName: string;
    preferredLocale: ClientLocale;
  },
  contactData: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
  },
  dbClient: DbClient = defaultDb,
  actor?: { actorType: ActorType; actorId: string | null },
): Promise<{ clientId: string; contactId: string }> {
  return await dbClient.transaction(async (tx) => {
    const clientId = generateUuidV7();
    const contactId = generateUuidV7();
    const now = new Date();

    await tx.insert(clients).values({
      id: clientId,
      kind: clientData.kind,
      displayName: clientData.displayName,
      preferredLocale: clientData.preferredLocale,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: contactData.givenName ?? null,
      familyName: contactData.familyName ?? null,
      email: contactData.email ?? null,
      emailNormalized: contactData.emailNormalized ?? null,
      phone: contactData.phone ?? null,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });

    await recordTimelineEvent(tx, {
      clientId,
      type: 'client.created',
      occurredAt: now,
      actorType: actor?.actorType ?? 'owner',
      actorId: actor?.actorId ?? null,
      subjectType: 'client',
      subjectId: clientId,
      data: {},
    });

    return { clientId, contactId };
  });
}

/**
 * Updates a client record and bumps last_activity_at.
 */
export async function updateClientRecord(
  clientId: string,
  updates: {
    kind?: ClientKind;
    displayName?: string;
    preferredLocale?: ClientLocale;
  },
  dbClient: DbClient = defaultDb,
): Promise<Client | null> {
  return await dbClient.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(clients)
      .set({
        ...updates,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(clients.id, clientId))
      .returning();

    return updated ?? null;
  });
}

/**
 * Counts contacts for a given client.
 */
export async function countClientContacts(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<number> {
  const [row] = await client
    .select({ total: count() })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));
  return row?.total ?? 0;
}

/**
 * Inserts a new contact for a client, enforcing primary contact constraints.
 */
export async function insertContact(
  clientId: string,
  contactData: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
  },
  dbClient: DbClient = defaultDb,
  actor?: { actorType: ActorType; actorId: string | null },
): Promise<ClientContact> {
  return await dbClient.transaction(async (tx) => {
    const now = new Date();
    const isPrimary = Boolean(contactData.isPrimary);

    if (isPrimary) {
      // Clear previous primary
      await tx
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)));
    }

    const contactId = generateUuidV7();
    const [inserted] = await tx
      .insert(clientContacts)
      .values({
        id: contactId,
        clientId,
        givenName: contactData.givenName ?? null,
        familyName: contactData.familyName ?? null,
        email: contactData.email ?? null,
        emailNormalized: contactData.emailNormalized ?? null,
        phone: contactData.phone ?? null,
        isPrimary,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!inserted) {
      throw new Error('Failed to insert contact');
    }

    // Bump client last_activity_at
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    await recordTimelineEvent(tx, {
      clientId,
      type: 'client.contact.added',
      occurredAt: now,
      actorType: actor?.actorType ?? 'owner',
      actorId: actor?.actorId ?? null,
      subjectType: 'contact',
      subjectId: contactId,
      data: {},
    });

    return inserted;
  });
}

/**
 * Updates a contact record. If switching to primary, unsets previous primary without race condition.
 */
export async function updateContactRecord(
  clientId: string,
  contactId: string,
  updates: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
  },
  dbClient: DbClient = defaultDb,
): Promise<ClientContact | null> {
  return await dbClient.transaction(async (tx) => {
    // 1. Verify existence scoped strictly by clientId (IDOR guard)
    const [existing] = await tx
      .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .limit(1);

    if (!existing) {
      return null;
    }

    const now = new Date();

    // 2. If promoting to primary, unset current primary on other contacts first
    if (updates.isPrimary === true && !existing.isPrimary) {
      await tx
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)));
    }

    // 3. Apply updates
    const [updated] = await tx
      .update(clientContacts)
      .set({
        ...updates,
        updatedAt: now,
      })
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .returning();

    // 4. Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return updated ?? null;
  });
}

/**
 * Removes a contact from a client.
 * Invariant: if removed contact was primary, oldest remaining contact automatically becomes primary.
 */
export async function deleteContactRecord(
  clientId: string,
  contactId: string,
  dbClient: DbClient = defaultDb,
  actor?: { actorType: ActorType; actorId: string | null },
): Promise<{ success: boolean; wasPrimary: boolean; newPrimaryId?: string } | null> {
  return await dbClient.transaction(async (tx) => {
    // Verify existence strictly scoped by clientId
    const [existing] = await tx
      .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .limit(1);

    if (!existing) {
      return null;
    }

    const now = new Date();

    // Delete contact
    await tx
      .delete(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)));

    let newPrimaryId: string | undefined;

    // If was primary, promote oldest remaining contact
    if (existing.isPrimary) {
      const [oldest] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId))
        .orderBy(asc(clientContacts.createdAt), asc(clientContacts.id))
        .limit(1);

      if (oldest) {
        newPrimaryId = oldest.id;
        await tx
          .update(clientContacts)
          .set({ isPrimary: true, updatedAt: now })
          .where(eq(clientContacts.id, oldest.id));
      }
    }

    // Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    await recordTimelineEvent(tx, {
      clientId,
      type: 'client.contact.removed',
      occurredAt: now,
      actorType: actor?.actorType ?? 'owner',
      actorId: actor?.actorId ?? null,
      subjectType: 'contact',
      subjectId: contactId,
      data: {},
    });

    return {
      success: true,
      wasPrimary: existing.isPrimary,
      newPrimaryId,
    };
  });
}

/**
 * Upserts a postal or billing address for a client (1 address per type limit).
 */
export async function upsertAddressRecord(
  clientId: string,
  addressData: {
    type: AddressType;
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    region?: string | null;
    countryCode: string;
  },
  dbClient: DbClient = defaultDb,
): Promise<ClientAddress> {
  return await dbClient.transaction(async (tx) => {
    // Verify client exists
    const [clientRow] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientRow) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const now = new Date();
    const addressId = generateUuidV7();

    const [upserted] = await tx
      .insert(clientAddresses)
      .values({
        id: addressId,
        clientId,
        type: addressData.type,
        line1: addressData.line1,
        line2: addressData.line2 ?? null,
        postalCode: addressData.postalCode,
        city: addressData.city,
        region: addressData.region ?? null,
        countryCode: addressData.countryCode,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [clientAddresses.clientId, clientAddresses.type],
        set: {
          line1: addressData.line1,
          line2: addressData.line2 ?? null,
          postalCode: addressData.postalCode,
          city: addressData.city,
          region: addressData.region ?? null,
          countryCode: addressData.countryCode,
          updatedAt: now,
        },
      })
      .returning();

    if (!upserted) {
      throw new Error('Failed to upsert address');
    }

    // Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return upserted;
  });
}

/**
 * Removes an address from a client by type.
 */
export async function deleteAddressRecord(
  clientId: string,
  type: AddressType,
  dbClient: DbClient = defaultDb,
): Promise<boolean> {
  return await dbClient.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(and(eq(clientAddresses.clientId, clientId), eq(clientAddresses.type, type)))
      .limit(1);

    if (!existing) {
      return false;
    }

    await tx
      .delete(clientAddresses)
      .where(and(eq(clientAddresses.clientId, clientId), eq(clientAddresses.type, type)));

    const now = new Date();
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return true;
  });
}

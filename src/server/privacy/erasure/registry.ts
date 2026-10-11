import { eq, and, or, inArray, count, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { clientTags } from '@/server/db/schema/tags';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { clientLegalHolds, isHoldActive } from '@/server/db/schema/client-legal-holds';
import type { ErasureProvider, ErasureHoldProvider } from './types';

const erasureProviders = new Map<string, ErasureProvider>();
const holdProviders = new Map<string, ErasureHoldProvider>();

/**
 * Registers an erasure provider.
 */
export function registerErasureProvider(provider: ErasureProvider): void {
  erasureProviders.set(provider.id, provider);
}

/**
 * Returns all registered erasure providers.
 */
export function getErasureProviders(): ErasureProvider[] {
  return Array.from(erasureProviders.values());
}

/**
 * Registers an erasure hold provider.
 */
export function registerErasureHoldProvider(provider: ErasureHoldProvider): void {
  holdProviders.set(provider.id, provider);
}

/**
 * Returns all registered erasure hold providers.
 */
export function getErasureHoldProviders(): ErasureHoldProvider[] {
  return Array.from(holdProviders.values());
}

/**
 * Clears all erasure providers from the registry.
 */
export function clearErasureProviders(): void {
  erasureProviders.clear();
}

/**
 * Clears all erasure hold providers from the registry.
 */
export function clearErasureHoldProviders(): void {
  holdProviders.clear();
}

/**
 * Helper to fetch all consent record IDs for a contact.
 */
async function getContactConsentIds(contactId: string, tx: DbClient): Promise<string[]> {
  const rows = await tx
    .select({ id: consentRecords.id })
    .from(consentRecords)
    .where(eq(consentRecords.contactId, contactId));
  return rows.map((r) => r.id);
}

/**
 * Helper to fetch all contact IDs for a client.
 */
async function getClientContactIds(clientId: string, tx: DbClient): Promise<string[]> {
  const rows = await tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));
  return rows.map((r) => r.id);
}

/**
 * Default domain erasure providers for all current E1 personal data.
 * Ordered safely from child dependents up to parent client.
 */
const DEFAULT_ERASURE_PROVIDERS: ErasureProvider[] = [
  {
    id: 'timeline',
    category: 'timeline',
    coveredTables: ['client_timeline_events'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientTimelineEvents)
          .where(eq(clientTimelineEvents.clientId, subject.clientId));
        return res?.count ?? 0;
      } else {
        const consentIds = await getContactConsentIds(subject.contactId, tx);
        const contactPredicate = and(
          eq(clientTimelineEvents.subjectType, 'contact'),
          eq(clientTimelineEvents.subjectId, subject.contactId),
        );
        const subjectPredicate =
          consentIds.length > 0
            ? or(
                contactPredicate,
                and(
                  eq(clientTimelineEvents.subjectType, 'consent_record'),
                  inArray(clientTimelineEvents.subjectId, consentIds),
                ),
              )
            : contactPredicate;

        const [res] = await tx
          .select({ count: count() })
          .from(clientTimelineEvents)
          .where(and(eq(clientTimelineEvents.clientId, subject.clientId), subjectPredicate));
        return res?.count ?? 0;
      }
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clientTimelineEvents)
          .where(eq(clientTimelineEvents.clientId, subject.clientId))
          .returning({ id: clientTimelineEvents.id });
        return deleted.length;
      } else {
        const consentIds = await getContactConsentIds(subject.contactId, tx);
        const contactPredicate = and(
          eq(clientTimelineEvents.subjectType, 'contact'),
          eq(clientTimelineEvents.subjectId, subject.contactId),
        );
        const subjectPredicate =
          consentIds.length > 0
            ? or(
                contactPredicate,
                and(
                  eq(clientTimelineEvents.subjectType, 'consent_record'),
                  inArray(clientTimelineEvents.subjectId, consentIds),
                ),
              )
            : contactPredicate;

        const deleted = await tx
          .delete(clientTimelineEvents)
          .where(and(eq(clientTimelineEvents.clientId, subject.clientId), subjectPredicate))
          .returning({ id: clientTimelineEvents.id });
        return deleted.length;
      }
    },
  },
  {
    id: 'consents',
    category: 'consents',
    coveredTables: ['consent_records'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const contactIds = await getClientContactIds(subject.clientId, tx);
        if (contactIds.length === 0) return 0;
        const [res] = await tx
          .select({ count: count() })
          .from(consentRecords)
          .where(inArray(consentRecords.contactId, contactIds));
        return res?.count ?? 0;
      } else {
        const [res] = await tx
          .select({ count: count() })
          .from(consentRecords)
          .where(eq(consentRecords.contactId, subject.contactId));
        return res?.count ?? 0;
      }
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const contactIds = await getClientContactIds(subject.clientId, tx);
        if (contactIds.length === 0) return 0;
        const deleted = await tx
          .delete(consentRecords)
          .where(inArray(consentRecords.contactId, contactIds))
          .returning({ id: consentRecords.id });
        return deleted.length;
      } else {
        const deleted = await tx
          .delete(consentRecords)
          .where(eq(consentRecords.contactId, subject.contactId))
          .returning({ id: consentRecords.id });
        return deleted.length;
      }
    },
  },
  {
    id: 'notes',
    category: 'notes',
    coveredTables: ['client_notes'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientNotes)
          .where(eq(clientNotes.clientId, subject.clientId));
        return res?.count ?? 0;
      }
      return 0;
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clientNotes)
          .where(eq(clientNotes.clientId, subject.clientId))
          .returning({ id: clientNotes.id });
        return deleted.length;
      }
      return 0;
    },
  },
  {
    id: 'tags',
    category: 'tags',
    coveredTables: ['client_tags'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientTags)
          .where(eq(clientTags.clientId, subject.clientId));
        return res?.count ?? 0;
      }
      return 0;
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        // Removes assignments only; tags table rows are preserved (AC-2)
        const deleted = await tx
          .delete(clientTags)
          .where(eq(clientTags.clientId, subject.clientId))
          .returning({ tagId: clientTags.tagId });
        return deleted.length;
      }
      return 0;
    },
  },
  {
    id: 'addresses',
    category: 'addresses',
    coveredTables: ['client_addresses'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientAddresses)
          .where(eq(clientAddresses.clientId, subject.clientId));
        return res?.count ?? 0;
      }
      return 0;
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clientAddresses)
          .where(eq(clientAddresses.clientId, subject.clientId))
          .returning({ id: clientAddresses.id });
        return deleted.length;
      }
      return 0;
    },
  },
  {
    id: 'contacts',
    category: 'contacts',
    coveredTables: ['client_contacts'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientContacts)
          .where(eq(clientContacts.clientId, subject.clientId));
        return res?.count ?? 0;
      } else {
        const [res] = await tx
          .select({ count: count() })
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.id, subject.contactId),
              eq(clientContacts.clientId, subject.clientId),
            ),
          );
        return res?.count ?? 0;
      }
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clientContacts)
          .where(eq(clientContacts.clientId, subject.clientId))
          .returning({ id: clientContacts.id });
        return deleted.length;
      } else {
        // Check if contact was primary
        const [existing] = await tx
          .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.id, subject.contactId),
              eq(clientContacts.clientId, subject.clientId),
            ),
          )
          .limit(1);

        if (!existing) return 0;

        const deleted = await tx
          .delete(clientContacts)
          .where(
            and(
              eq(clientContacts.id, subject.contactId),
              eq(clientContacts.clientId, subject.clientId),
            ),
          )
          .returning({ id: clientContacts.id });

        if (existing.isPrimary) {
          // Promote oldest remaining contact
          const [oldest] = await tx
            .select({ id: clientContacts.id })
            .from(clientContacts)
            .where(eq(clientContacts.clientId, subject.clientId))
            .orderBy(asc(clientContacts.createdAt), asc(clientContacts.id))
            .limit(1);

          if (oldest) {
            await tx
              .update(clientContacts)
              .set({ isPrimary: true, updatedAt: new Date() })
              .where(eq(clientContacts.id, oldest.id));
          }
        }

        // Bump client activity
        await tx
          .update(clients)
          .set({ lastActivityAt: new Date(), updatedAt: new Date() })
          .where(eq(clients.id, subject.clientId));

        return deleted.length;
      }
    },
  },
  {
    id: 'legal_hold',
    category: 'legal_hold',
    coveredTables: ['client_legal_holds'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clientLegalHolds)
          .where(eq(clientLegalHolds.clientId, subject.clientId));
        return res?.count ?? 0;
      }
      return 0;
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clientLegalHolds)
          .where(eq(clientLegalHolds.clientId, subject.clientId))
          .returning({ id: clientLegalHolds.id });
        return deleted.length;
      }
      return 0;
    },
  },
  {
    id: 'client',
    category: 'client',
    coveredTables: ['clients'],
    plan: async (subject, tx) => {
      if (subject.kind === 'client') {
        const [res] = await tx
          .select({ count: count() })
          .from(clients)
          .where(eq(clients.id, subject.clientId));
        return res?.count ?? 0;
      }
      return 0;
    },
    erase: async (subject, tx) => {
      if (subject.kind === 'client') {
        const deleted = await tx
          .delete(clients)
          .where(eq(clients.id, subject.clientId))
          .returning({ id: clients.id });
        return deleted.length;
      }
      return 0;
    },
  },
];

export const DEFAULT_HOLD_PROVIDERS: ErasureHoldProvider[] = [
  {
    id: 'client_legal_hold',
    holds: async (subject, tx) => {
      const clientId = subject.clientId;
      const [hold] = await tx
        .select()
        .from(clientLegalHolds)
        .where(eq(clientLegalHolds.clientId, clientId))
        .limit(1);

      if (!hold) return [];

      let timezone = 'UTC';
      try {
        const { getStudioSettings } = await import('@/server/settings/repo');
        const settings = await getStudioSettings(tx);
        timezone = settings.timezone;
      } catch {
        timezone = 'UTC';
      }

      if (!isHoldActive(hold.until, timezone)) {
        return [];
      }

      return [
        {
          reason: 'manual.' + hold.reason,
          retainUntil: hold.until ?? null,
        },
      ];
    },
  },
];

function initDefaultProviders(): void {
  for (const provider of DEFAULT_ERASURE_PROVIDERS) {
    erasureProviders.set(provider.id, provider);
  }
  for (const hp of DEFAULT_HOLD_PROVIDERS) {
    holdProviders.set(hp.id, hp);
  }
}

/**
 * Resets the erasure provider registry back to default initial providers.
 */
export function resetErasureProviders(): void {
  erasureProviders.clear();
  initDefaultProviders();
}

/**
 * Resets the hold provider registry back to default initial providers.
 */
export function resetErasureHoldProviders(): void {
  holdProviders.clear();
  for (const hp of DEFAULT_HOLD_PROVIDERS) {
    holdProviders.set(hp.id, hp);
  }
}

// Initialise default providers
initDefaultProviders();

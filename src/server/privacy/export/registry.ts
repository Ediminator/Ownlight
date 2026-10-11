import { eq, and, or, inArray, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import { clientNotes } from '@/server/db/schema/timeline';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { auditEvents } from '@/server/db/schema/audit';
import { clientLegalHolds } from '@/server/db/schema/client-legal-holds';
import { getStudioSettings } from '@/server/settings/repo';
import type {
  ExportProvider,
  ExportSubject,
  ExportCollectedData,
  DsarSubjectExport,
} from './types';

const providerRegistry = new Map<string, ExportProvider>();

/**
 * Registers an export provider.
 */
export function registerExportProvider(provider: ExportProvider): void {
  providerRegistry.set(provider.id, provider);
}

/**
 * Returns all registered export providers.
 */
export function getExportProviders(): ExportProvider[] {
  return Array.from(providerRegistry.values());
}

/**
 * Clears all providers from the registry.
 */
export function clearExportProviders(): void {
  providerRegistry.clear();
}

/**
 * Resets the provider registry back to default initial providers.
 */
export function resetExportProviders(): void {
  providerRegistry.clear();
  initDefaultProviders();
}

/**
 * Default domain export providers for all current E1 personal data.
 */
const DEFAULT_PROVIDERS: ExportProvider[] = [
  {
    id: 'subject',
    category: 'subject',
    coveredTables: ['client_contacts'],
    collect: (subject) => {
      const c = subject.contact;
      const fullName =
        [c.givenName, c.familyName].filter(Boolean).join(' ') || subject.client.displayName;

      // Note: email_normalized is explicitly excluded (AC-1)
      return Promise.resolve([
        {
          id: c.id,
          display_name: fullName,
          first_name: c.givenName ?? null,
          last_name: c.familyName ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          role: c.isPrimary ? 'primary' : 'secondary',
          created_at: c.createdAt.toISOString(),
          updated_at: c.updatedAt.toISOString(),
        },
      ]);
    },
  },
  {
    id: 'client',
    category: 'client',
    coveredTables: ['clients'],
    collect: (subject) => {
      const cl = subject.client;
      return Promise.resolve([
        {
          display_name: cl.displayName,
          kind: cl.kind,
          preferred_language: cl.preferredLocale,
          created_at: cl.createdAt.toISOString(),
          last_activity_at: cl.lastActivityAt.toISOString(),
        },
      ]);
    },
  },
  {
    id: 'addresses',
    category: 'addresses',
    coveredTables: ['client_addresses'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select()
        .from(clientAddresses)
        .where(eq(clientAddresses.clientId, subject.clientId))
        .orderBy(asc(clientAddresses.type));

      return rows.map((addr) => ({
        type: addr.type,
        street: [addr.line1, addr.line2].filter(Boolean).join(', '),
        line1: addr.line1,
        line2: addr.line2 ?? null,
        postal_code: addr.postalCode,
        city: addr.city,
        state: addr.region ?? null,
        country: addr.countryCode,
        created_at: addr.createdAt.toISOString(),
      }));
    },
  },
  {
    id: 'tags',
    category: 'tags',
    coveredTables: ['client_tags'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select({ name: tags.name })
        .from(clientTags)
        .innerJoin(tags, eq(clientTags.tagId, tags.id))
        .where(eq(clientTags.clientId, subject.clientId))
        .orderBy(asc(tags.name));

      return rows.map((r) => ({
        name: r.name,
      }));
    },
  },
  {
    id: 'notes',
    category: 'notes',
    coveredTables: ['client_notes'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select()
        .from(clientNotes)
        .where(eq(clientNotes.clientId, subject.clientId))
        .orderBy(asc(clientNotes.createdAt));

      return rows.map((n) => ({
        id: n.id,
        body: n.body,
        created_at: n.createdAt.toISOString(),
        updated_at: n.updatedAt.toISOString(),
      }));
    },
  },
  {
    id: 'timeline',
    category: 'timeline',
    coveredTables: ['client_timeline_events'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select()
        .from(clientTimelineEvents)
        .where(eq(clientTimelineEvents.clientId, subject.clientId))
        .orderBy(asc(clientTimelineEvents.occurredAt));

      return rows.map((e) => ({
        type: e.type,
        occurred_at: e.occurredAt.toISOString(),
        actor_type: e.actorType,
        data: e.data,
      }));
    },
  },
  {
    id: 'consents',
    category: 'consents',
    coveredTables: ['consent_records'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.contactId, subject.contactId))
        .orderBy(asc(consentRecords.effectiveOn), asc(consentRecords.createdAt));

      return rows.map((c) => ({
        purpose: c.purpose,
        status: c.status,
        effective_on: c.effectiveOn,
        method: c.method,
        scope: c.scope ?? null,
        evidence_note: c.evidenceNote ?? null,
        created_at: c.createdAt.toISOString(),
      }));
    },
  },
  {
    id: 'audit',
    category: 'audit',
    coveredTables: [],
    collect: async (subject, tx) => {
      const rows = await tx
        .select({
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
          outcome: auditEvents.outcome,
        })
        .from(auditEvents)
        .where(
          or(
            and(eq(auditEvents.targetType, 'client'), eq(auditEvents.targetId, subject.clientId)),
            and(
              inArray(auditEvents.targetType, ['contact', 'client_contact']),
              eq(auditEvents.targetId, subject.contactId),
            ),
          ),
        )
        .orderBy(asc(auditEvents.occurredAt));

      // Action, occurred_at, outcome only (AC-1, ADR-0012)
      return rows.map((a) => ({
        action: a.action,
        occurred_at: a.occurredAt.toISOString(),
        outcome: a.outcome,
      }));
    },
  },
  {
    id: 'legal_hold',
    category: 'legal_hold',
    coveredTables: ['client_legal_holds'],
    collect: async (subject, tx) => {
      const rows = await tx
        .select()
        .from(clientLegalHolds)
        .where(eq(clientLegalHolds.clientId, subject.clientId))
        .limit(1);

      return rows.map((h) => ({
        reason: h.reason,
        note: h.note ?? null,
        until: h.until ?? null,
        created_at: h.createdAt.toISOString(),
        updated_at: h.updatedAt.toISOString(),
      }));
    },
  },
];

function initDefaultProviders(): void {
  for (const p of DEFAULT_PROVIDERS) {
    providerRegistry.set(p.id, p);
  }
}

initDefaultProviders();

/**
 * Collects and aggregates personal data for one subject contact across all registered providers.
 */
export async function collectExportData(
  contactId: string,
  client: DbClient = defaultDb,
): Promise<{ exportData: ExportCollectedData; subject: ExportSubject } | null> {
  // 1. Fetch contact
  const [contactRow] = await client
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, contactId))
    .limit(1);

  if (!contactRow) {
    return null;
  }

  // 2. Fetch client
  const [clientRow] = await client
    .select()
    .from(clients)
    .where(eq(clients.id, contactRow.clientId))
    .limit(1);

  if (!clientRow) {
    return null;
  }

  const exportSubject: ExportSubject = {
    contactId: contactRow.id,
    clientId: clientRow.id,
    contact: contactRow,
    client: clientRow,
  };

  // 3. Studio settings
  const settings = await getStudioSettings(client);

  // 4. Collect data from all registered providers
  const categories: Record<string, unknown[]> = {};
  const providers = getExportProviders();

  for (const provider of providers) {
    const rawData = await provider.collect(exportSubject, client);
    const items = Array.isArray(rawData) ? rawData : [rawData];
    const existing = categories[provider.category] ?? [];
    existing.push(...items);
    categories[provider.category] = existing;
  }

  const fullName =
    [contactRow.givenName, contactRow.familyName].filter(Boolean).join(' ') ||
    clientRow.displayName;

  const subjectExport: DsarSubjectExport = {
    id: contactRow.id,
    display_name: fullName,
    first_name: contactRow.givenName ?? null,
    last_name: contactRow.familyName ?? null,
    email: contactRow.email ?? null,
    phone: contactRow.phone ?? null,
    role: contactRow.isPrimary ? 'primary' : 'secondary',
    created_at: contactRow.createdAt.toISOString(),
    updated_at: contactRow.updatedAt.toISOString(),
  };

  const exportData: ExportCollectedData = {
    schema: 'ownlight.dsar.v1',
    generated_at: new Date().toISOString(),
    studio: {
      name: settings.studio_name,
    },
    subject: subjectExport,
    categories,
  };

  return {
    exportData,
    subject: exportSubject,
  };
}

import { eq, and, or, inArray, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import { clientNotes } from '@/server/db/schema/timeline';
import { clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { auditEvents } from '@/server/db/schema/audit';
import { clientLegalHolds } from '@/server/db/schema/client-legal-holds';
import { leads } from '@/server/db/schema/leads';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { getStudioSettings } from '@/server/settings/repo';
import type {
  ExportProvider,
  ExportSubject,
  ExportCollectedData,
  DsarSubjectExport,
} from './types';
import { googleContactsExportProvider } from '@/server/integrations/google/export-provider';

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
export const DEFAULT_PROVIDERS: ExportProvider[] = [
  {
    id: 'subject',
    category: 'subject',
    coveredTables: ['client_contacts'],
    subjectKinds: ['client', 'contact'] as const,
    collect: (subject) => {
      if (subject.kind === 'lead') return Promise.resolve([]);
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
    subjectKinds: ['client', 'contact'] as const,
    collect: (subject) => {
      if (subject.kind === 'lead') return Promise.resolve([]);
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
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
  googleContactsExportProvider,
  {
    id: 'leads',
    category: 'leads',
    coveredTables: [],
    subjectKinds: ['lead'] as const,
    collect: async (subject, tx) => {
      if (subject.kind !== 'lead') return [];
      const lead = subject.lead;

      // 1. Fetch form name
      const [form] = await tx
        .select({ name: inquiryForms.name })
        .from(inquiryForms)
        .where(eq(inquiryForms.id, lead.formId))
        .limit(1);

      // 2. Fetch notice version
      const [noticeVersion] = await tx
        .select({
          version: inquiryFormNoticeVersions.version,
          acknowledgementTextEn: inquiryFormNoticeVersions.acknowledgementTextEn,
          acknowledgementTextDe: inquiryFormNoticeVersions.acknowledgementTextDe,
          privacyPolicyUrl: inquiryFormNoticeVersions.privacyPolicyUrl,
        })
        .from(inquiryFormNoticeVersions)
        .where(eq(inquiryFormNoticeVersions.id, lead.noticeVersionId))
        .limit(1);

      // 3. Fetch audit actions targeting this lead
      const audits = await tx
        .select({
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
          outcome: auditEvents.outcome,
        })
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, 'lead'), eq(auditEvents.targetId, lead.id)))
        .orderBy(asc(auditEvents.occurredAt));

      return [
        {
          id: lead.id,
          status: lead.status,
          verification: lead.verification,
          delivery_mode: lead.deliveryMode,
          locale: lead.locale,
          given_name: lead.givenName,
          family_name: lead.familyName,
          email: lead.email,
          phone: lead.phone,
          event_type_key: lead.eventTypeKey,
          event_date: lead.eventDate,
          event_location: lead.eventLocation,
          message: lead.message,
          form_name: form?.name ?? 'Inquiry form',
          notice_version: noticeVersion?.version ?? null,
          notice_acknowledged_at: lead.noticeAcknowledgedAt.toISOString(),
          notice_acknowledgement_text_en: noticeVersion?.acknowledgementTextEn ?? null,
          notice_acknowledgement_text_de: noticeVersion?.acknowledgementTextDe ?? null,
          notice_privacy_policy_url: noticeVersion?.privacyPolicyUrl ?? null,
          auto_reply_status: lead.autoReplyStatus,
          received_at: lead.receivedAt.toISOString(),
          last_activity_at: lead.lastActivityAt.toISOString(),
          created_at: lead.createdAt.toISOString(),
          updated_at: lead.updatedAt.toISOString(),
          audit_actions: audits.map((a) => ({
            action: a.action,
            occurred_at: a.occurredAt.toISOString(),
            outcome: a.outcome,
          })),
        },
      ];
    },
  },
  {
    id: 'converted-leads',
    category: 'converted_leads',
    coveredTables: ['leads'],
    subjectKinds: ['client', 'contact'] as const,
    collect: async (subject, tx) => {
      if (subject.kind === 'lead') return [];
      const clientId = subject.clientId;

      const rows = await tx
        .select({
          receivedAt: leads.receivedAt,
          formName: inquiryForms.name,
          eventTypeKey: leads.eventTypeKey,
          eventDate: leads.eventDate,
          eventLocation: leads.eventLocation,
        })
        .from(leads)
        .innerJoin(inquiryForms, eq(leads.formId, inquiryForms.id))
        .where(eq(leads.clientId, clientId))
        .orderBy(asc(leads.receivedAt));

      return rows.map((r) => ({
        received_at: r.receivedAt.toISOString(),
        form_name: r.formName,
        event_type_key: r.eventTypeKey ?? null,
        event_date: r.eventDate ?? null,
        event_location: r.eventLocation ?? null,
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
 * Collects and aggregates personal data for one subject (contact or lead) across registered providers.
 */
export async function collectExportData(
  target: string | { contactId?: string; leadId?: string },
  client: DbClient = defaultDb,
): Promise<{ exportData: ExportCollectedData; subject: ExportSubject } | null> {
  const targetObj = typeof target === 'string' ? { contactId: target } : target;

  if (targetObj.leadId) {
    // Lead export path (TASK-0026 / ADR-0015 §10)
    const [leadRow] = await client
      .select()
      .from(leads)
      .where(eq(leads.id, targetObj.leadId))
      .limit(1);

    if (!leadRow) {
      return null;
    }

    const exportSubject: ExportSubject = {
      kind: 'lead',
      leadId: leadRow.id,
      lead: leadRow,
    };

    const settings = await getStudioSettings(client);
    const categories: Record<string, unknown[]> = {};
    const providers = getExportProviders().filter(
      (p) => !p.subjectKinds || p.subjectKinds.includes('lead'),
    );

    for (const provider of providers) {
      const rawData = await provider.collect(exportSubject, client);
      const items = Array.isArray(rawData) ? rawData : [rawData];
      const existing = categories[provider.category] ?? [];
      existing.push(...items);
      categories[provider.category] = existing;
    }

    const joinedName = [leadRow.givenName, leadRow.familyName].filter(Boolean).join(' ');
    const fullName = joinedName.length > 0 ? joinedName : (leadRow.email ?? 'Lead');

    const subjectExport: DsarSubjectExport = {
      id: leadRow.id,
      display_name: fullName,
      first_name: leadRow.givenName ?? null,
      last_name: leadRow.familyName ?? null,
      email: leadRow.email ?? null,
      phone: leadRow.phone ?? null,
      role: 'lead',
      created_at: leadRow.createdAt.toISOString(),
      updated_at: leadRow.updatedAt.toISOString(),
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

  // Contact export path
  const contactId = targetObj.contactId;
  if (!contactId) {
    return null;
  }

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
    kind: 'contact',
    contactId: contactRow.id,
    clientId: clientRow.id,
    contact: contactRow,
    client: clientRow,
  };

  // 3. Studio settings
  const settings = await getStudioSettings(client);

  // 4. Collect data from registered providers
  const categories: Record<string, unknown[]> = {};
  const providers = getExportProviders().filter(
    (p) =>
      !p.subjectKinds || p.subjectKinds.includes('contact') || p.subjectKinds.includes('client'),
  );

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

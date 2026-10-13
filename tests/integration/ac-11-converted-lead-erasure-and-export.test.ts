import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { planErasure, eraseSubject } from '@/server/privacy/erasure/service';
import { collectExportData } from '@/server/privacy/export/registry';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import type { DbClient } from '@/server/db/client';

describe('TASK-0026: Converted Lead Erasure and Export (AC-11)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let testClientId: string;
  let testContactId: string;
  let testLeadId: string;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    // 1. Seed studio owner
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@studio-lumiere.test',
      role: 'owner',
    };
    await dbClient.insert(user).values({
      id: ownerUser.id,
      name: ownerUser.name,
      email: ownerUser.email,
      emailVerified: true,
      role: ownerUser.role,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 2. Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Lumière',
      currency: 'EUR',
      default_locale: 'de',
      timezone: 'Europe/Berlin',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // 3. Seed inquiry form and notice version
    formId = '018f0000-0000-7000-8000-000000000010';
    noticeVersionId = '018f0000-0000-7000-8000-000000000011';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'Wedding Inquiry Form',
      slug: 'wedding-form',
      status: 'published',
      defaultLocale: 'de',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'email', enabled: true, required: true, order: 1 },
      ],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId: formId,
      version: 1,
      acknowledgementTextEn: 'Privacy notice v1',
      acknowledgementTextDe: 'Datenschutzerklärung v1',
      privacyPolicyUrl: 'https://example.com/privacy',
      createdByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));

    // 4. Seed client
    testClientId = '018f0000-0000-7000-8000-000000000020';
    await dbClient.insert(clients).values({
      id: testClientId,
      displayName: 'Alice & Bob Wedding',
      kind: 'person',
      preferredLocale: 'de',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      lastActivityAt: new Date('2026-01-15T12:00:00Z'),
    });

    // 5. Seed client contact
    testContactId = '018f0000-0000-7000-8000-000000000021';
    await dbClient.insert(clientContacts).values({
      id: testContactId,
      clientId: testClientId,
      isPrimary: true,
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice.smith@example.com',
      emailNormalized: 'alice.smith@example.com',
      phone: '+49 30 111111',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      updatedAt: new Date('2026-01-15T12:00:00Z'),
    });

    // 6. Seed converted lead linked to client
    testLeadId = '018f0000-0000-7000-8000-000000000099';
    await dbClient.insert(leads).values({
      id: testLeadId,
      clientId: testClientId,
      status: 'converted',
      formId: formId,
      noticeVersionId: noticeVersionId,
      noticeAcknowledgedAt: new Date('2026-01-10T10:00:00Z'),
      locale: 'de',
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice.smith@example.com',
      emailNormalized: 'alice.smith@example.com',
      phone: '+49 30 111111',
      eventTypeKey: 'wedding',
      eventDate: '2026-09-20',
      eventLocation: 'Potsdam',
      message: 'Looking for a full-day wedding photographer in Potsdam.',
      verification: 'verified',
      deliveryMode: 'hosted',
      autoReplyStatus: 'not_applicable',
      receivedAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-10T10:00:00Z'),
      convertedAt: new Date('2026-01-15T12:00:00Z'),
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-15T12:00:00Z'),
    });
  });

  afterEach(async () => {
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  it('AC-11: given a contact export for the client, the export lists the converted lead details', async () => {
    const exportResult = await collectExportData({ contactId: testContactId }, dbClient);

    expect(exportResult).toBeDefined();
    expect(exportResult?.exportData).toBeDefined();

    const convertedLeads = exportResult?.exportData.categories.converted_leads as
      | {
          received_at: string;
          form_name: string;
          event_type_key: string | null;
          event_date: string | null;
          event_location: string | null;
        }[]
      | undefined;

    expect(convertedLeads).toBeDefined();
    if (!convertedLeads || convertedLeads.length === 0) {
      throw new Error('Expected convertedLeads to have entries');
    }
    expect(convertedLeads).toHaveLength(1);

    const leadEntry = convertedLeads[0];
    expect(leadEntry).toBeDefined();
    if (!leadEntry) {
      throw new Error('Expected leadEntry to be defined');
    }
    expect(leadEntry.received_at).toBe(new Date('2026-01-10T10:00:00Z').toISOString());
    expect(leadEntry.form_name).toBe('Wedding Inquiry Form');
    expect(leadEntry.event_type_key).toBe('wedding');
    expect(leadEntry.event_date).toBe('2026-09-20');
    expect(leadEntry.event_location).toBe('Potsdam');
  });

  it('AC-11: when client is erased via erasure service, lead row is gone and plan reports converted-leads count of 1', async () => {
    // 1. Plan erasure
    const plan = await planErasure({ kind: 'client', clientId: testClientId }, dbClient);
    expect(plan).toBeDefined();
    expect(plan?.categoryCounts['converted-leads']).toBe(1);

    // 2. Execute erasure
    const erasureResult = await eraseSubject(
      { kind: 'client', clientId: testClientId },
      { actor: { actorType: 'owner', actorId: ownerUser.id } },
      dbClient,
    );

    expect(erasureResult.success).toBe(true);
    if (!erasureResult.success) throw new Error('Expected erasure to succeed');
    expect(erasureResult.categoryCounts['converted-leads']).toBe(1);

    // 3. Verify lead row is hard-deleted from database
    const [remainingLead] = await dbClient
      .select()
      .from(leads)
      .where(eq(leads.id, testLeadId))
      .limit(1);

    expect(remainingLead).toBeUndefined();
  });
});

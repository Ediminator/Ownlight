import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { logger } from '@/server/log';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { auditEvents } from '@/server/db/schema/audit';
import {
  createLead,
  changeLeadStatus,
  deleteLeads,
  getLead,
  listLeads,
} from '@/server/leads/service';
import { planErasure } from '@/server/privacy/erasure/service';
import { generateExport } from '@/server/privacy/export/service';
import type { DbClient } from '@/server/db/client';

describe('TASK-0026: Privacy Logging Verification (AC-14)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let formId: string;
  let noticeVersionId: string;

  const CANARY = {
    givenName: 'CanaryGivenName123',
    familyName: 'CanaryFamilyName456',
    email: 'canary.privacy.test@example.com',
    phone: '+49 30 99887766',
    message: 'CanarySecretInquiryMessage789',
    eventLocation: 'CanarySecretVenueLocationBerlin',
  };

  const loggedPayloads: string[] = [];

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    loggedPayloads.length = 0;

    vi.spyOn(logger, 'info').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    vi.spyOn(logger, 'warn').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    vi.spyOn(logger, 'error').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });
    vi.spyOn(logger, 'debug').mockImplementation((...args) => {
      loggedPayloads.push(JSON.stringify(args));
    });

    // Seed studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Privacy Studio',
      currency: 'EUR',
      default_locale: 'de',
      timezone: 'Europe/Berlin',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    // Seed form and notice version
    formId = '018f0000-0000-7000-8000-000000000010';
    noticeVersionId = '018f0000-0000-7000-8000-000000000011';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'Privacy Test Form',
      slug: 'privacy-form',
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
      createdByActorId: '018f0000-0000-7000-8000-000000000001',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterEach(async () => {
    await testDb.destroy();
    vi.restoreAllMocks();
  });

  it('AC-14: zero PII (name, email, phone, message, location) in logs and audit metadata across leads operations', async () => {
    // 1. createLead
    const lead = await createLead(
      {
        formId,
        noticeVersionId,
        givenName: CANARY.givenName,
        familyName: CANARY.familyName,
        email: CANARY.email,
        phone: CANARY.phone,
        message: CANARY.message,
        eventLocation: CANARY.eventLocation,
        locale: 'de',
      },
      undefined,
      dbClient,
    );
    if (!lead.success) throw new Error(lead.error);

    // 2. changeLeadStatus
    await changeLeadStatus(
      lead.id,
      'contacted',
      { actorType: 'owner', actorId: '018f0000-0000-7000-8000-000000000001' },
      dbClient,
    );

    // 3. getLead & listLeads
    await getLead(lead.id, dbClient);
    await listLeads({ emailQuery: 'canary' }, dbClient);

    // 4. planErasure & eraseSubject
    await planErasure({ kind: 'lead', leadId: lead.id }, dbClient);

    // 5. DSAR export
    await generateExport({
      leadId: lead.id,
      format: 'json',
      locale: 'de',
      actorId: '018f0000-0000-7000-8000-000000000001',
      client: dbClient,
    });

    // 6. deleteLeads
    await deleteLeads(
      [lead.id],
      { actorType: 'owner', actorId: '018f0000-0000-7000-8000-000000000001' },
      dbClient,
    );

    // Assert that NONE of the logged messages contain ANY of the canary PII
    const allLogs = loggedPayloads.join('\n');
    for (const [field, canaryVal] of Object.entries(CANARY)) {
      expect(
        allLogs,
        `Canary value for "${field}" (${canaryVal}) was leaked in application logs!`,
      ).not.toContain(canaryVal);
    }

    // Inspect all audit events metadata
    const auditRows = await dbClient.select().from(auditEvents);
    for (const row of auditRows) {
      const metaStr = JSON.stringify(row.metadata ?? {});
      for (const [field, canaryVal] of Object.entries(CANARY)) {
        expect(
          metaStr,
          `Canary value for "${field}" (${canaryVal}) was leaked in audit metadata for action "${row.action}"!`,
        ).not.toContain(canaryVal);
      }
    }
  });
});

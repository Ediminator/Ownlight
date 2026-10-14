import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCookiesStore = new Map<string, string>();
const mockHeadersStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const val = mockCookiesStore.get(name);
        return val ? { name, value: val } : undefined;
      },
      set: (name: string, value: string) => {
        mockCookiesStore.set(name, value);
      },
      delete: (name: string) => {
        mockCookiesStore.delete(name);
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeadersStore.get(name.toLowerCase()) ?? null,
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { convertLeadToClientAction, getLeadDuplicatesAction } from '@/server/leads/actions';
import { convertLeadToClient } from '@/server/leads/convert';
import {
  registerLeadConversionStep,
  getLeadConversionSteps,
  resetLeadConversionSteps,
} from '@/server/leads/conversion-steps';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { leads, type Lead } from '@/server/db/schema/leads';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { auditEvents } from '@/server/db/schema/audit';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { generateUuidV7 } from '@/lib/id';

describe('TASK-0032: Lead to Client Conversion Integration Tests (AC-1 to AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;
  let formId: string;
  let noticeVersionId: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetLeadConversionSteps();

    // 1. Seed owner user
    ownerUser = {
      id: generateUuidV7(),
      name: 'Studio Owner',
      email: 'owner@example.org',
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

    // 2. Active owner web session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 3. Create test form & notice version
    formId = generateUuidV7();
    noticeVersionId = generateUuidV7();

    await dbClient.insert(inquiryForms).values({
      id: formId,
      slug: 'contact-studio',
      name: 'Wedding Inquiries 2026',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'family_name', enabled: true, required: false, order: 1 },
        { key: 'email', enabled: true, required: true, order: 2 },
      ],
      eventTypes: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId,
      version: 1,
      acknowledgementTextEn: 'I acknowledge the privacy notice.',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
      privacyPolicyUrl: 'https://example.org/privacy',
      createdByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  }, 30000);

  afterEach(async () => {
    resetLeadConversionSteps();
    await testDb.destroy();
  });

  // Helper to insert a fresh lead
  async function seedTestLead(overrides: Partial<typeof leads.$inferInsert> = {}): Promise<Lead> {
    const leadId = generateUuidV7();
    const now = new Date();
    const [row] = await dbClient
      .insert(leads)
      .values({
        id: leadId,
        formId,
        noticeVersionId,
        noticeAcknowledgedAt: now,
        status: 'new',
        verification: 'verified',
        deliveryMode: 'hosted',
        locale: 'en',
        givenName: 'Alice',
        familyName: 'Wonder',
        email: 'alice@example.com',
        emailNormalized: 'alice@example.com',
        phone: '+49 30 112233',
        eventTypeKey: 'wedding',
        eventDate: '2026-08-15',
        eventLocation: 'Berlin Castle',
        message: 'Looking for a wedding photographer in Berlin',
        autoReplyStatus: 'sent',
        receivedAt: new Date('2026-06-01T10:00:00Z'),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      })
      .returning();
    if (!row) {
      throw new Error('Failed to seed test lead');
    }
    return row;
  }

  it('AC-1: converts unconverted lead to new client and primary contact', async () => {
    const lead = await seedTestLead();

    const result = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.clientId).toBeDefined();
    const clientId = result.clientId;

    // 1. Client record verified
    const [clientRow] = await dbClient
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    expect(clientRow).toBeDefined();
    expect(clientRow?.displayName).toBe('Alice Wonder');
    expect(clientRow?.kind).toBe('person');
    expect(clientRow?.preferredLocale).toBe('en');
    expect(clientRow?.googleContactsSyncEnabled).toBe(false);

    // 2. Primary contact verified
    const [contactRow] = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId))
      .limit(1);

    expect(contactRow).toBeDefined();
    expect(contactRow?.givenName).toBe('Alice');
    expect(contactRow?.familyName).toBe('Wonder');
    expect(contactRow?.email).toBe('alice@example.com');
    expect(contactRow?.emailNormalized).toBe('alice@example.com');
    expect(contactRow?.phone).toBe('+49 30 112233');
    expect(contactRow?.isPrimary).toBe(true);

    // 3. Lead row updated to converted
    const [updatedLead] = await dbClient.select().from(leads).where(eq(leads.id, lead.id)).limit(1);

    expect(updatedLead?.status).toBe('converted');
    expect(updatedLead?.clientId).toBe(clientId);
    expect(updatedLead?.convertedAt).toBeDefined();
  });

  it('AC-2: duplicate email detection displays matching client and existing_client mode links without duplicate contacts', async () => {
    // 1. Seed existing client with contact matching email
    const existingClientId = generateUuidV7();
    const existingContactId = generateUuidV7();
    const now = new Date();

    await dbClient.insert(clients).values({
      id: existingClientId,
      kind: 'person',
      displayName: 'Alice Original',
      preferredLocale: 'en',
      createdAt: now,
      updatedAt: now,
    });

    await dbClient.insert(clientContacts).values({
      id: existingContactId,
      clientId: existingClientId,
      givenName: 'Alice',
      familyName: 'Original',
      email: 'alice@example.com',
      emailNormalized: 'alice@example.com',
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Seed lead with same normalized email
    const lead = await seedTestLead({
      email: 'ALICE@example.com',
      emailNormalized: 'alice@example.com',
    });

    // 3. Test getLeadDuplicatesAction finds existing client
    const dupRes = await getLeadDuplicatesAction({ leadId: lead.id }, dbClient);
    expect(dupRes.success).toBe(true);
    if (!dupRes.success) return;
    expect(dupRes.duplicates.length).toBe(1);
    expect(dupRes.duplicates[0]?.clientId).toBe(existingClientId);
    expect(dupRes.duplicates[0]?.displayName).toBe('Alice Original');

    // 4. Convert with mode = existing_client
    const convertRes = await convertLeadToClientAction(
      lead.id,
      {
        mode: 'existing_client',
        existingClientId,
      },
      dbClient,
    );

    expect(convertRes.success).toBe(true);
    if (!convertRes.success) return;
    expect(convertRes.clientId).toBe(existingClientId);

    // 5. Verify no duplicate contacts created on existing client
    const contactsOnClient = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, existingClientId));

    expect(contactsOnClient.length).toBe(1);
    expect(contactsOnClient[0]?.givenName).toBe('Alice');
    expect(contactsOnClient[0]?.familyName).toBe('Original');

    // 6. Verify lead linked to existing client
    const [updatedLead] = await dbClient.select().from(leads).where(eq(leads.id, lead.id)).limit(1);

    expect(updatedLead?.status).toBe('converted');
    expect(updatedLead?.clientId).toBe(existingClientId);
  });

  it('AC-3: creates client note titled "Inquiry message ({formName}, {receivedDate})" with verbatim message', async () => {
    const rawMessage = 'Looking for a wedding photographer in Berlin';
    const receivedDate = new Date('2026-07-20T14:30:00Z');
    const lead = await seedTestLead({
      message: rawMessage,
      receivedAt: receivedDate,
    });

    const result = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const clientId = result.clientId;

    // Check client note created on client record
    const [note] = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, clientId))
      .limit(1);

    expect(note).toBeDefined();
    // Title containing formName and receivedDate
    expect(note?.body).toContain('Inquiry message (Wedding Inquiries 2026, 2026-07-20)');
    // Verbatim message body
    expect(note?.body).toContain(rawMessage);

    // Check note.created timeline event was emitted
    const [noteTimelineEvent] = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId))
      .limit(1);

    expect(noteTimelineEvent).toBeDefined();
  });

  it('AC-4: nulls lead PII while retaining shoot metadata on converted lead row', async () => {
    const lead = await seedTestLead({
      givenName: 'Bob',
      familyName: 'Marley',
      email: 'bob@example.com',
      emailNormalized: 'bob@example.com',
      phone: '+49 170 998877',
      message: 'Reggae festival photography inquiry',
      eventTypeKey: 'commercial',
      eventDate: '2026-09-01',
      eventLocation: 'Treptower Park',
    });

    const result = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const [convertedLead] = await dbClient
      .select()
      .from(leads)
      .where(eq(leads.id, lead.id))
      .limit(1);

    expect(convertedLead).toBeDefined();
    expect(convertedLead?.status).toBe('converted');
    expect(convertedLead?.clientId).toBe(result.clientId);

    // PII fields MUST be null
    expect(convertedLead?.givenName).toBeNull();
    expect(convertedLead?.familyName).toBeNull();
    expect(convertedLead?.email).toBeNull();
    expect(convertedLead?.emailNormalized).toBeNull();
    expect(convertedLead?.phone).toBeNull();
    expect(convertedLead?.message).toBeNull();

    // Shoot metadata and form references MUST be retained
    expect(convertedLead?.eventTypeKey).toBe('commercial');
    expect(convertedLead?.eventDate).toBe('2026-09-01');
    expect(convertedLead?.eventLocation).toBe('Treptower Park');
    expect(convertedLead?.formId).toBe(formId);
    expect(convertedLead?.noticeVersionId).toBe(noticeVersionId);
    expect(convertedLead?.locale).toBe('en');
    expect(convertedLead?.receivedAt).toBeDefined();
  });

  it('AC-5: emits inquiry.received and lead.converted timeline events with correct timestamps and actor attribution', async () => {
    const receivedDate = new Date('2026-05-10T12:00:00Z');
    const lead = await seedTestLead({ receivedAt: receivedDate });

    const result = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const clientId = result.clientId;

    const events = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientId));

    // Find inquiry.received
    const inquiryEvent = events.find((e) => e.type === 'inquiry.received');
    expect(inquiryEvent).toBeDefined();
    expect(inquiryEvent?.actorType).toBe('system');
    expect(inquiryEvent?.subjectType).toBe('lead');
    expect(inquiryEvent?.subjectId).toBe(lead.id);
    expect(inquiryEvent?.occurredAt.toISOString()).toBe(receivedDate.toISOString());
    expect(inquiryEvent?.data).toEqual({});

    // Find lead.converted
    const convertedEvent = events.find((e) => e.type === 'lead.converted');
    expect(convertedEvent).toBeDefined();
    expect(convertedEvent?.actorType).toBe('owner');
    expect(convertedEvent?.subjectType).toBe('lead');
    expect(convertedEvent?.subjectId).toBe(lead.id);
    expect(convertedEvent?.data).toEqual({ mode: 'new_client' });

    // Verify audit event lead.converted
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.converted'))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(lead.id);
    expect(auditLog?.metadata).toEqual({
      client_id: clientId,
      mode: 'new_client',
    });
  });

  it('AC-6: rejects conversion with INVALID_TRANSITION for spam, archived, or already converted leads', async () => {
    const spamLead = await seedTestLead({ status: 'spam' });
    const spamRes = await convertLeadToClientAction(spamLead.id, { mode: 'new_client' }, dbClient);
    expect(spamRes.success).toBe(false);
    if (!spamRes.success) {
      expect(spamRes.code).toBe('INVALID_TRANSITION');
    }

    const archivedLead = await seedTestLead({ status: 'archived' });
    const archRes = await convertLeadToClientAction(
      archivedLead.id,
      { mode: 'new_client' },
      dbClient,
    );
    expect(archRes.success).toBe(false);
    if (!archRes.success) {
      expect(archRes.code).toBe('INVALID_TRANSITION');
    }

    // Create converted lead
    const dummyClientId = generateUuidV7();
    await dbClient.insert(clients).values({
      id: dummyClientId,
      kind: 'person',
      displayName: 'Prior Client',
      preferredLocale: 'en',
    });

    const convertedLead = await seedTestLead({
      status: 'converted',
      clientId: dummyClientId,
      givenName: null,
      email: null,
    });
    const convRes = await convertLeadToClientAction(
      convertedLead.id,
      { mode: 'new_client' },
      dbClient,
    );
    expect(convRes.success).toBe(false);
    if (!convRes.success) {
      expect(convRes.code).toBe('INVALID_TRANSITION');
    }
  });

  it('AC-7: invokes registered conversion step; rolls back entire conversion if step throws', async () => {
    let stepInvoked = false;
    let stepLeadId: string | null = null;
    let stepClientId: string | null = null;

    // 1. Success case step
    registerLeadConversionStep({
      id: 'e3-project-creation-mock',
      run: async (lead, cId) => {
        await Promise.resolve();
        stepInvoked = true;
        stepLeadId = lead.id;
        stepClientId = cId;
      },
    });

    const lead1 = await seedTestLead();
    const res1 = await convertLeadToClient(
      lead1.id,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );

    expect(res1.success).toBe(true);
    expect(stepInvoked).toBe(true);
    expect(stepLeadId).toBe(lead1.id);
    if (res1.success) {
      expect(stepClientId).toBe(res1.clientId);
    }

    // 2. Failure rollback case step
    resetLeadConversionSteps();
    registerLeadConversionStep({
      id: 'failing-step',
      run: async () => {
        await Promise.resolve();
        throw new Error('Step failed deliberately to test rollback');
      },
    });

    const lead2 = await seedTestLead();
    await expect(
      convertLeadToClient(lead2.id, { mode: 'new_client' }, ownerUser.id, dbClient),
    ).rejects.toThrow('Step failed deliberately to test rollback');

    // Verify lead2 is still unconverted in database (rollback verification)
    const [lead2InDb] = await dbClient.select().from(leads).where(eq(leads.id, lead2.id)).limit(1);

    expect(lead2InDb?.status).toBe('new');
    expect(lead2InDb?.clientId).toBeNull();
    expect(lead2InDb?.givenName).toBe(lead2.givenName);
    expect(lead2InDb?.email).toBe(lead2.email);
  });

  it('AC-8: denies unauthenticated with UNAUTHENTICATED and API key with UNAUTHORIZED', async () => {
    const lead = await seedTestLead();

    // 1. Unauthenticated (no session cookie)
    mockCookiesStore.clear();
    const unauthRes = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);
    expect(unauthRes.success).toBe(false);
    if (!unauthRes.success) {
      expect(unauthRes.code).toBe('UNAUTHENTICATED');
    }

    // 2. API Key / Bearer token provided (API keys denied on owner web actions)
    mockHeadersStore.set('authorization', 'Bearer ownlight_test_apikey_secret_value');
    const apiKeyRes = await convertLeadToClientAction(lead.id, { mode: 'new_client' }, dbClient);
    expect(apiKeyRes.success).toBe(false);
    if (!apiKeyRes.success) {
      expect(apiKeyRes.code).toBe('UNAUTHORIZED');
    }
  });

  it('handles edge cases: missing lead, missing/invalid existing client, empty message, validation errors', async () => {
    // 1. Non-existent lead returns NOT_FOUND
    const fakeLeadId = generateUuidV7();
    const notFoundRes = await convertLeadToClient(
      fakeLeadId,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );
    expect(notFoundRes.success).toBe(false);
    if (!notFoundRes.success) {
      expect(notFoundRes.code).toBe('NOT_FOUND');
    }

    // 2. existing_client mode without existingClientId returns VALIDATION_FAILED
    const lead1 = await seedTestLead();
    const noClientRes = await convertLeadToClient(
      lead1.id,
      { mode: 'existing_client' },
      ownerUser.id,
      dbClient,
    );
    expect(noClientRes.success).toBe(false);
    if (!noClientRes.success) {
      expect(noClientRes.code).toBe('VALIDATION_FAILED');
    }

    // 3. existing_client mode with non-existent existingClientId returns CLIENT_NOT_FOUND
    const fakeClientId = generateUuidV7();
    const badClientRes = await convertLeadToClient(
      lead1.id,
      { mode: 'existing_client', existingClientId: fakeClientId },
      ownerUser.id,
      dbClient,
    );
    expect(badClientRes.success).toBe(false);
    if (!badClientRes.success) {
      expect(badClientRes.code).toBe('CLIENT_NOT_FOUND');
    }

    // 4. Lead with empty / null message does not create a note record
    const leadNoMsg = await seedTestLead({ message: '   ' });
    const noMsgRes = await convertLeadToClient(
      leadNoMsg.id,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );
    expect(noMsgRes.success).toBe(true);
    if (noMsgRes.success) {
      const notes = await dbClient
        .select()
        .from(clientNotes)
        .where(eq(clientNotes.clientId, noMsgRes.clientId));
      expect(notes).toHaveLength(0);
    }

    // 5. convertLeadToClientAction validation error on invalid payload
    const invalidActionRes = await convertLeadToClientAction({ leadId: 'not-a-uuid' }, dbClient);
    expect(invalidActionRes.success).toBe(false);
    if (!invalidActionRes.success) {
      expect(invalidActionRes.code).toBe('VALIDATION_FAILED');
    }

    // 6. getLeadDuplicatesAction with non-existent lead returns empty list
    const dupRes = await getLeadDuplicatesAction(fakeLeadId, dbClient);
    expect(dupRes.success).toBe(true);
    if (dupRes.success) {
      expect(dupRes.duplicates).toHaveLength(0);
    }

    // 7. getLeadDuplicatesAction unauthenticated returns UNAUTHORIZED
    mockCookiesStore.clear();
    const dupUnauthRes = await getLeadDuplicatesAction(fakeLeadId, dbClient);
    expect(dupUnauthRes.success).toBe(false);
    if (!dupUnauthRes.success) {
      expect(dupUnauthRes.code).toBe('UNAUTHORIZED');
    }

    // 8. getLeadDuplicatesAction with invalid payload returns VALIDATION_FAILED
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    const dupInvalidRes = await getLeadDuplicatesAction({ leadId: 'invalid-id' }, dbClient);
    expect(dupInvalidRes.success).toBe(false);
    if (!dupInvalidRes.success) {
      expect(dupInvalidRes.code).toBe('VALIDATION_FAILED');
    }

    // 9. Converted lead with null emailNormalized returns empty duplicates list
    const convertedRes = await convertLeadToClient(
      lead1.id,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );
    expect(convertedRes.success).toBe(true);
    const noEmailDupRes = await getLeadDuplicatesAction(lead1.id, dbClient);
    expect(noEmailDupRes.success).toBe(true);
    if (noEmailDupRes.success) {
      expect(noEmailDupRes.duplicates).toHaveLength(0);
    }

    // 10. getLeadDuplicatesAction with Bearer token is rejected with UNAUTHORIZED
    mockHeadersStore.set('authorization', 'Bearer token_not_allowed');
    const bearerDupRes = await getLeadDuplicatesAction(lead1.id, dbClient);
    expect(bearerDupRes.success).toBe(false);
    if (!bearerDupRes.success) {
      expect(bearerDupRes.code).toBe('UNAUTHORIZED');
    }
    mockHeadersStore.clear();

    // 11. registerLeadConversionStep replaces step with identical ID
    resetLeadConversionSteps();
    let stepVersion = 1;
    registerLeadConversionStep({
      id: 'step-a',
      run: async () => {
        await Promise.resolve();
        stepVersion = 1;
      },
    });
    registerLeadConversionStep({
      id: 'step-a',
      run: async () => {
        await Promise.resolve();
        stepVersion = 2;
      },
    });
    const allSteps = getLeadConversionSteps();
    expect(allSteps).toHaveLength(1);
    const firstStep = allSteps[0];
    expect(firstStep).toBeDefined();
    if (firstStep) {
      await firstStep.run(lead1, fakeClientId, dbClient);
    }
    expect(stepVersion).toBe(2);

    // 12. Lead with locale 'de', null familyName, null phone
    const leadDe = await seedTestLead({
      locale: 'de',
      givenName: 'Hans',
      familyName: null,
      phone: null,
    });
    const deRes = await convertLeadToClient(
      leadDe.id,
      { mode: 'new_client' },
      ownerUser.id,
      dbClient,
    );
    expect(deRes.success).toBe(true);
    if (deRes.success) {
      const [clientRow] = await dbClient
        .select()
        .from(clients)
        .where(eq(clients.id, deRes.clientId))
        .limit(1);
      expect(clientRow?.preferredLocale).toBe('de');
      expect(clientRow?.displayName).toBe('Hans');
    }
  });
});

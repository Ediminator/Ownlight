import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, inArray, and } from 'drizzle-orm';

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
import { planErasureAction, executeErasureAction } from '@/server/privacy/erasure/actions';
import { eraseSubject } from '@/server/privacy/erasure/service';
import {
  registerErasureHoldProvider,
  resetErasureHoldProviders,
  registerErasureProvider,
  resetErasureProviders,
} from '@/server/privacy/erasure/registry';
import { user, session } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts, clientAddresses } from '@/server/db/schema/clients';
import { tags, clientTags } from '@/server/db/schema/tags';
import { clientNotes, clientTimelineEvents } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { logger } from '@/server/log';
import type { DbClient } from '@/server/db/client';

describe('TASK-0016: Erasure with retention-lock awareness integration', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetErasureProviders();
    resetErasureHoldProviders();

    // 1. Seed studio owner
    ownerUser = {
      id: '018f0000-0000-7000-8000-000000000001',
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

    // 2. Active owner session
    const sessionRes = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRes.token;

    // Set default cookies & headers for authenticated owner requests
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    // 3. Studio settings
    await dbClient.insert(studioSettings).values({
      studio_name: 'Studio Test',
      currency: 'EUR',
      default_locale: 'en',
      timezone: 'UTC',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterEach(async () => {
    resetErasureProviders();
    resetErasureHoldProviders();
    await testDb.destroy();
  });

  it('AC-1: plans erasure of a single-contact client reporting kind "client" with counts per category and no holds', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000010';
    const contactId = '018f0000-0000-7000-8000-000000000011';
    const tagId = '018f0000-0000-7000-8000-000000000012';

    // Seed client with 1 contact, address, tag, note, timeline event, consent record
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Single Contact Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      lastActivityAt: new Date('2026-01-15T15:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice@example.org',
      emailNormalized: 'alice@example.org',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientAddresses).values({
      id: '018f0000-0000-7000-8000-000000000013',
      clientId,
      type: 'billing',
      line1: '123 Main St',
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(tags).values({
      id: tagId,
      name: 'VIP',
      nameNormalized: 'vip',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientTags).values({
      clientId,
      tagId,
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientNotes).values({
      id: '018f0000-0000-7000-8000-000000000014',
      clientId,
      body: 'Important client note',
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(clientTimelineEvents).values({
      id: '018f0000-0000-7000-8000-000000000015',
      clientId,
      type: 'client.created',
      occurredAt: new Date('2026-01-10T10:00:00Z'),
      actorType: 'owner',
      actorId: ownerUser.id,
      data: {},
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    await dbClient.insert(consentRecords).values({
      id: '018f0000-0000-7000-8000-000000000016',
      contactId,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-01-10',
      method: 'email',
      recordedByActorType: 'owner',
      recordedByActorId: ownerUser.id,
      createdAt: new Date('2026-01-10T10:00:00Z'),
    });

    // Plan erasure of the single contact
    const planRes = await planErasureAction({
      subject: { kind: 'contact', clientId, contactId },
    });

    expect(planRes.success).toBe(true);
    if (!planRes.success) return;

    expect(planRes.plan.subjectKind).toBe('client'); // Promoted to client!
    expect(planRes.plan.holds).toEqual([]);
    expect(planRes.plan.notesMayMentionPerson).toBe(false);

    expect(planRes.plan.categoryCounts).toEqual({
      client: 1,
      contacts: 1,
      addresses: 1,
      tags: 1,
      notes: 1,
      timeline: 1,
      consents: 1,
      google_contacts: 0,
      projects: 0,
      appointments: 0,
    });
  });

  it('AC-2: executes erasure completely, retains shared tag rows, emits audit event, and export returns 404', async () => {
    const clientIdA = '018f0000-0000-7000-8000-000000000020';
    const contactIdA = '018f0000-0000-7000-8000-000000000021';
    const clientIdB = '018f0000-0000-7000-8000-000000000022';
    const contactIdB = '018f0000-0000-7000-8000-000000000023';
    const tagId = '018f0000-0000-7000-8000-000000000024';

    // Seed shared tag
    await dbClient.insert(tags).values({
      id: tagId,
      name: 'Commercial',
      nameNormalized: 'commercial',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Seed Client A
    await dbClient.insert(clients).values({
      id: clientIdA,
      displayName: 'Client Alpha',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactIdA,
      clientId: clientIdA,
      isPrimary: true,
      givenName: 'Alpha',
      familyName: 'One',
      email: 'alpha@example.org',
      emailNormalized: 'alpha@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientAddresses).values({
      id: '018f0000-0000-7000-8000-000000000025',
      clientId: clientIdA,
      type: 'billing',
      line1: 'Alpha Street 1',
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientTags).values({
      clientId: clientIdA,
      tagId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientNotes).values({
      id: '018f0000-0000-7000-8000-000000000026',
      clientId: clientIdA,
      body: 'Alpha client note',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientTimelineEvents).values({
      id: '018f0000-0000-7000-8000-000000000027',
      clientId: clientIdA,
      type: 'client.created',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      actorType: 'owner',
      actorId: ownerUser.id,
      data: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(consentRecords).values({
      id: '018f0000-0000-7000-8000-000000000028',
      contactId: contactIdA,
      purpose: 'marketing',
      status: 'granted',
      effectiveOn: '2026-01-01',
      method: 'in_person',
      recordedByActorType: 'owner',
      recordedByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Seed Client B (also using Commercial tag)
    await dbClient.insert(clients).values({
      id: clientIdB,
      displayName: 'Client Beta',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactIdB,
      clientId: clientIdB,
      isPrimary: true,
      givenName: 'Beta',
      familyName: 'Two',
      email: 'beta@example.org',
      emailNormalized: 'beta@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientTags).values({
      clientId: clientIdB,
      tagId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Execute erasure of Client A
    const execRes = await executeErasureAction({
      subject: { kind: 'client', clientId: clientIdA },
      confirmation: 'Client Alpha',
    });

    expect(execRes.success).toBe(true);

    // Verify all Client A rows are gone
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientIdA));
    expect(clientRows).toHaveLength(0);

    const contactRows = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientIdA));
    expect(contactRows).toHaveLength(0);

    const addrRows = await dbClient
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, clientIdA));
    expect(addrRows).toHaveLength(0);

    const tagAssignRows = await dbClient
      .select()
      .from(clientTags)
      .where(eq(clientTags.clientId, clientIdA));
    expect(tagAssignRows).toHaveLength(0);

    const noteRows = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, clientIdA));
    expect(noteRows).toHaveLength(0);

    const timelineRows = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.clientId, clientIdA));
    expect(timelineRows).toHaveLength(0);

    const consentRows = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactIdA));
    expect(consentRows).toHaveLength(0);

    // Verify tag row in `tags` remains! (Used by Client B)
    const tagRows = await dbClient.select().from(tags).where(eq(tags.id, tagId));
    expect(tagRows).toHaveLength(1);

    // Exactly one privacy.erasure.completed audit event
    const auditRows = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.completed'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetId).toBe(clientIdA);
    expect(auditRows[0]?.targetType).toBe('client');
    expect(auditRows[0]?.metadata).toEqual({
      subject_kind: 'client',
      category_counts: {
        client: 1,
        contacts: 1,
        addresses: 1,
        tags: 1,
        notes: 1,
        timeline: 1,
        consents: 1,
        google_contacts: 0,
        projects: 0,
        appointments: 0,
      },
    });

    // Subsequent plan/export request for erased contact returns 404
    const subsequentPlan = await planErasureAction({
      subject: { kind: 'contact', clientId: clientIdA, contactId: contactIdA },
    });
    expect(subsequentPlan.success).toBe(false);
    expect((subsequentPlan as { code: string }).code).toBe('NOT_FOUND');
  });

  it('AC-3: erases single contact from multi-contact client, leaves partner and client-level data, warns notes may mention person', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000030';
    const contactS = '018f0000-0000-7000-8000-000000000031';
    const contactP = '018f0000-0000-7000-8000-000000000032';
    const consentS = '018f0000-0000-7000-8000-000000000033';
    const consentP = '018f0000-0000-7000-8000-000000000034';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Couple Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientContacts).values([
      {
        id: contactS,
        clientId,
        isPrimary: true,
        givenName: 'Sam',
        familyName: 'Taylor',
        email: 'sam@example.org',
        emailNormalized: 'sam@example.org',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: contactP,
        clientId,
        isPrimary: false,
        givenName: 'Pat',
        familyName: 'Taylor',
        email: 'pat@example.org',
        emailNormalized: 'pat@example.org',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    await dbClient.insert(consentRecords).values([
      {
        id: consentS,
        contactId: contactS,
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2026-01-01',
        method: 'in_person',
        recordedByActorType: 'owner',
        recordedByActorId: ownerUser.id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: consentP,
        contactId: contactP,
        purpose: 'image_usage',
        status: 'granted',
        effectiveOn: '2026-01-02',
        method: 'email',
        recordedByActorType: 'owner',
        recordedByActorId: ownerUser.id,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    await dbClient.insert(clientNotes).values({
      id: '018f0000-0000-7000-8000-000000000035',
      clientId,
      body: 'Met Sam and Pat at the studio.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientTimelineEvents).values([
      {
        id: '018f0000-0000-7000-8000-000000000036',
        clientId,
        type: 'client.contact.added',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        actorType: 'owner',
        actorId: ownerUser.id,
        subjectType: 'contact',
        subjectId: contactS,
        data: {},
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: '018f0000-0000-7000-8000-000000000037',
        clientId,
        type: 'consent.granted',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        actorType: 'owner',
        actorId: ownerUser.id,
        subjectType: 'consent_record',
        subjectId: consentS,
        data: {},
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: '018f0000-0000-7000-8000-000000000038',
        clientId,
        type: 'client.contact.added',
        occurredAt: new Date('2026-01-02T00:00:00Z'),
        actorType: 'owner',
        actorId: ownerUser.id,
        subjectType: 'contact',
        subjectId: contactP,
        data: {},
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    // Plan erasure of S
    const planRes = await planErasureAction({
      subject: { kind: 'contact', clientId, contactId: contactS },
    });

    expect(planRes.success).toBe(true);
    if (!planRes.success) return;

    expect(planRes.plan.subjectKind).toBe('contact');
    expect(planRes.plan.notesMayMentionPerson).toBe(true);
    expect(planRes.plan.categoryCounts.contacts).toBe(1);
    expect(planRes.plan.categoryCounts.consents).toBe(1);
    expect(planRes.plan.categoryCounts.timeline).toBe(2); // contactS event + consentS event

    // Execute erasure of S
    const execRes = await executeErasureAction({
      subject: { kind: 'contact', clientId, contactId: contactS },
      confirmation: 'Couple Client',
    });

    expect(execRes.success).toBe(true);

    // Verify S, S's consent, S's timeline events are gone
    const contactSRows = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, contactS));
    expect(contactSRows).toHaveLength(0);

    const consentSRows = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.id, consentS));
    expect(consentSRows).toHaveLength(0);

    const sTimelineRows = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(
        inArray(clientTimelineEvents.id, [
          '018f0000-0000-7000-8000-000000000036',
          '018f0000-0000-7000-8000-000000000037',
        ]),
      );
    expect(sTimelineRows).toHaveLength(0);

    // Verify client, contact P, P's consent, P's timeline, client note all REMAIN
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);

    const contactPRows = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, contactP));
    expect(contactPRows).toHaveLength(1);
    expect(contactPRows[0]?.isPrimary).toBe(true); // P promoted to primary!

    const consentPRows = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.id, consentP));
    expect(consentPRows).toHaveLength(1);

    const pTimelineRows = await dbClient
      .select()
      .from(clientTimelineEvents)
      .where(eq(clientTimelineEvents.id, '018f0000-0000-7000-8000-000000000038'));
    expect(pTimelineRows).toHaveLength(1);

    const noteRows = await dbClient
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, clientId));
    expect(noteRows).toHaveLength(1);
  });

  it('AC-4: given a test-only hold provider returning a hold, plan lists hold, execute returns ERASURE_BLOCKED, nothing deleted, audit privacy.erasure.blocked recorded', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000040';
    const contactId = '018f0000-0000-7000-8000-000000000041';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Held Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Held',
      familyName: 'Person',
      email: 'held@example.org',
      emailNormalized: 'held@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const retainDate = '2030-06-15T00:00:00Z';
    registerErasureHoldProvider({
      id: 'test-statutory-hold',
      holds: () => Promise.resolve([{ reason: 'test.hold', retainUntil: retainDate }]),
    });

    // Plan lists hold
    const planRes = await planErasureAction({
      subject: { kind: 'client', clientId },
    });
    expect(planRes.success).toBe(true);
    if (!planRes.success) return;
    expect(planRes.plan.holds).toHaveLength(1);
    expect(planRes.plan.holds[0]?.reason).toBe('test.hold');

    // Execute returns ERASURE_BLOCKED
    const execRes = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Held Client',
    });

    expect(execRes.success).toBe(false);
    expect((execRes as { code: string }).code).toBe('ERASURE_BLOCKED');
    expect((execRes as { holds: unknown[] }).holds).toHaveLength(1);

    // Nothing deleted
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);

    // Exactly one privacy.erasure.blocked audit event
    const blockedAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.blocked'));
    expect(blockedAudits).toHaveLength(1);
    expect(blockedAudits[0]?.targetId).toBe(clientId);
    expect(blockedAudits[0]?.outcome).toBe('denied');
    expect(blockedAudits[0]?.metadata).toEqual({
      subject_kind: 'client',
      hold_count: 1,
    });
  });

  it('AC-5: hold provider returning hold after planning re-checks inside transaction and blocks erasure (TOCTOU)', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000050';
    const contactId = '018f0000-0000-7000-8000-000000000051';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Toctou Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Toctou',
      familyName: 'Target',
      email: 'toctou@example.org',
      emailNormalized: 'toctou@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // 1. Plan when no hold exists
    const planRes = await planErasureAction({
      subject: { kind: 'client', clientId },
    });
    expect(planRes.success).toBe(true);
    if (!planRes.success) return;
    expect(planRes.plan.holds).toHaveLength(0);

    // 2. Register hold provider right before execution
    registerErasureHoldProvider({
      id: 'toctou-late-hold',
      holds: () => Promise.resolve([{ reason: 'test.hold', retainUntil: '2030-01-01T00:00:00Z' }]),
    });

    // 3. Execute erasure: re-evaluates inside transaction and blocks!
    const execRes = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Toctou Client',
    });

    expect(execRes.success).toBe(false);
    expect((execRes as { code: string }).code).toBe('ERASURE_BLOCKED');

    // Data remains
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);
  });

  it('AC-6: rolls back completely and keeps all data when an erasure provider throws midway', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000060';
    const contactId = '018f0000-0000-7000-8000-000000000061';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Rollback Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Roll',
      familyName: 'Back',
      email: 'rollback@example.org',
      emailNormalized: 'rollback@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Register a faulty provider that throws midway through erase
    registerErasureProvider({
      id: 'faulty_provider',
      category: 'faulty',
      coveredTables: [],
      plan: () => Promise.resolve(1),
      erase: () => {
        throw new Error('Simulated database deadlock during erasure');
      },
    });

    await expect(
      eraseSubject(
        { kind: 'client', clientId },
        { actor: { actorType: 'owner', actorId: ownerUser.id } },
        dbClient,
      ),
    ).rejects.toThrow('Simulated database deadlock during erasure');

    // Verify all rows remain intact!
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(1);

    const contactRows = await dbClient
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId));
    expect(contactRows).toHaveLength(1);

    // No privacy.erasure.completed audit event exists
    const completedAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'privacy.erasure.completed'));
    expect(completedAudits).toHaveLength(0);
  });

  it('AC-7: rejects wrong confirmation, stale reauth, unauthenticated, API key with *, and unknown client / cross-client contact', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000070';
    const contactId = '018f0000-0000-7000-8000-000000000071';
    const otherClientId = '018f0000-0000-7000-8000-000000000072';
    const otherContactId = '018f0000-0000-7000-8000-000000000073';

    await dbClient.insert(clients).values([
      {
        id: clientId,
        displayName: 'Target Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: otherClientId,
        displayName: 'Other Client',
        kind: 'person',
        preferredLocale: 'en',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    await dbClient.insert(clientContacts).values([
      {
        id: contactId,
        clientId,
        isPrimary: true,
        givenName: 'Target',
        familyName: 'Person',
        email: 'target@example.org',
        emailNormalized: 'target@example.org',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: otherContactId,
        clientId: otherClientId,
        isPrimary: true,
        givenName: 'Other',
        familyName: 'Person',
        email: 'other@example.org',
        emailNormalized: 'other@example.org',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    // 1. Wrong confirmation text
    const wrongConf = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Wrong Display Name',
    });
    expect(wrongConf.success).toBe(false);
    expect((wrongConf as { code: string }).code).toBe('CONFIRMATION_MISMATCH');

    // 2. Stale re-authentication (> 5 minutes)
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(session.token, sessionToken));

    const staleReauth = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Target Client',
    });
    expect(staleReauth.success).toBe(false);
    expect((staleReauth as { code: string }).code).toBe('REAUTH_REQUIRED');

    // Reset fresh reauth for next checks
    await dbClient
      .update(session)
      .set({ lastReauthenticatedAt: new Date() })
      .where(eq(session.token, sessionToken));

    // 3. No session (unauthenticated)
    mockCookiesStore.clear();
    const noSession = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Target Client',
    });
    expect(noSession.success).toBe(false);
    expect((noSession as { code: string }).code).toBe('UNAUTHORIZED');

    // 4. API key with wildcard scope '*' -> FORBIDDEN
    const apiKeyRes = await createApiKey({
      userId: ownerUser.id,
      name: 'Wildcard Key',
      scopes: ['*'],
      client: dbClient,
    });
    mockHeadersStore.set('authorization', `Bearer ${apiKeyRes.apiKey}`);
    const apiKeyAttempt = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Target Client',
    });
    expect(apiKeyAttempt.success).toBe(false);
    expect((apiKeyAttempt as { code: string }).code).toBe('FORBIDDEN');

    // Restore session cookie and remove Bearer header
    mockHeadersStore.delete('authorization');
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // 5. Unknown clientId -> NOT_FOUND
    const unknownClient = await executeErasureAction({
      subject: { kind: 'client', clientId: '018f0000-0000-7000-8000-000000000099' },
      confirmation: 'Target Client',
    });
    expect(unknownClient.success).toBe(false);
    expect((unknownClient as { code: string }).code).toBe('NOT_FOUND');

    // 6. Cross-client contactId (IDOR: otherContactId does not belong to clientId) -> NOT_FOUND
    const idorAttempt = await executeErasureAction({
      subject: { kind: 'contact', clientId, contactId: otherContactId },
      confirmation: 'Target Client',
    });
    expect(idorAttempt.success).toBe(false);
    expect((idorAttempt as { code: string }).code).toBe('NOT_FOUND');

    // Verify nothing was deleted
    const finalClientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(finalClientRows).toHaveLength(1);
  });

  it('AC-9: captured logs and audit metadata contain zero names, emails, phones, addresses, note text, or consent scope', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000080';
    const contactId = '018f0000-0000-7000-8000-000000000081';

    const secretName = 'VerySecretClientName';
    const secretEmail = 'superprivate@example.org';
    const secretPhone = '+493012345678';
    const secretAddress = 'Secret Street 42';
    const secretNote = 'Secret internal memo about client finances';
    const secretScope = 'Full portfolio publication on secret magazine';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: secretName,
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Secret',
      familyName: 'Client',
      email: secretEmail,
      emailNormalized: secretEmail,
      phone: secretPhone,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientAddresses).values({
      id: '018f0000-0000-7000-8000-000000000082',
      clientId,
      type: 'billing',
      line1: secretAddress,
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientNotes).values({
      id: '018f0000-0000-7000-8000-000000000083',
      clientId,
      body: secretNote,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(consentRecords).values({
      id: '018f0000-0000-7000-8000-000000000084',
      contactId,
      purpose: 'image_usage',
      status: 'granted',
      effectiveOn: '2026-01-01',
      method: 'in_person',
      scope: secretScope,
      recordedByActorType: 'owner',
      recordedByActorId: ownerUser.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const capturedLogStrings: string[] = [];
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      capturedLogStrings.push(JSON.stringify(args));
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      capturedLogStrings.push(JSON.stringify(args));
    });

    // 1. Plan erasure
    await planErasureAction({
      subject: { kind: 'client', clientId },
    });

    // 2. Execute erasure
    await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: secretName,
    });

    infoSpy.mockRestore();
    warnSpy.mockRestore();

    // Check all captured logs for PII
    for (const logStr of capturedLogStrings) {
      expect(logStr).not.toContain(secretName);
      expect(logStr).not.toContain(secretEmail);
      expect(logStr).not.toContain(secretPhone);
      expect(logStr).not.toContain(secretAddress);
      expect(logStr).not.toContain(secretNote);
      expect(logStr).not.toContain(secretScope);
    }

    // Check all audit events for PII
    const allAudits = await dbClient.select().from(auditEvents);
    for (const audit of allAudits) {
      const metaStr = JSON.stringify(audit.metadata ?? {});
      expect(metaStr).not.toContain(secretName);
      expect(metaStr).not.toContain(secretEmail);
      expect(metaStr).not.toContain(secretPhone);
      expect(metaStr).not.toContain(secretAddress);
      expect(metaStr).not.toContain(secretNote);
      expect(metaStr).not.toContain(secretScope);
    }
  });

  it('AC-14: given consent records and consent.* audit events, contact erasure deletes consent records while audit events remain intact', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000090';
    const contactId = '018f0000-0000-7000-8000-000000000091';
    const consentGrantedId = '018f0000-0000-7000-8000-000000000092';
    const consentWithdrawnId = '018f0000-0000-7000-8000-000000000093';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Consent Test Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Consent',
      familyName: 'Subject',
      email: 'consent@example.org',
      emailNormalized: 'consent@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Insert granted and withdrawn consent records
    await dbClient.insert(consentRecords).values([
      {
        id: consentGrantedId,
        contactId,
        purpose: 'marketing',
        status: 'granted',
        effectiveOn: '2026-01-01',
        method: 'in_person',
        recordedByActorType: 'owner',
        recordedByActorId: ownerUser.id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: consentWithdrawnId,
        contactId,
        purpose: 'marketing',
        status: 'withdrawn',
        effectiveOn: '2026-01-05',
        method: 'email',
        recordedByActorType: 'owner',
        recordedByActorId: ownerUser.id,
        createdAt: new Date('2026-01-05T00:00:00Z'),
      },
    ]);

    // Insert matching pre-existing audit events
    await dbClient.insert(auditEvents).values([
      {
        action: 'consent.granted',
        actorType: 'owner',
        actorId: ownerUser.id,
        targetType: 'contact',
        targetId: contactId,
        outcome: 'success',
        metadata: { contact_id: contactId, purpose: 'marketing', method: 'in_person' },
      },
      {
        action: 'consent.withdrawn',
        actorType: 'owner',
        actorId: ownerUser.id,
        targetType: 'contact',
        targetId: contactId,
        outcome: 'success',
        metadata: { contact_id: contactId, purpose: 'marketing', method: 'email' },
      },
    ]);

    // Erase client and contact
    const res = await executeErasureAction({
      subject: { kind: 'client', clientId },
      confirmation: 'Consent Test Client',
    });
    expect(res.success).toBe(true);

    // Verify consent_records are DELETED
    const remainingConsents = await dbClient
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactId));
    expect(remainingConsents).toHaveLength(0);

    // Verify audit events STILL EXIST AND ARE UNCHANGED (24-month retention)
    const consentAudits = await dbClient
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.action, ['consent.granted', 'consent.withdrawn']));
    expect(consentAudits).toHaveLength(2);
    expect(consentAudits.map((a) => a.action)).toContain('consent.granted');
    expect(consentAudits.map((a) => a.action)).toContain('consent.withdrawn');
  });

  it('AC-15: system actor can call eraseSubject directly from server code without web session', async () => {
    const clientId = '018f0000-0000-7000-8000-000000000100';
    const contactId = '018f0000-0000-7000-8000-000000000101';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'System Actor Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    });
    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      isPrimary: true,
      givenName: 'Sys',
      familyName: 'Item',
      email: 'sys@example.org',
      emailNormalized: 'sys@example.org',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Clear all cookies / web session
    mockCookiesStore.clear();

    // Call eraseSubject directly as retention-worker system actor
    const sysResult = await eraseSubject(
      { kind: 'client', clientId },
      { actor: { actorType: 'system', actorId: 'retention-worker' } },
      dbClient,
    );

    expect(sysResult.success).toBe(true);

    // Verify client is deleted
    const clientRows = await dbClient.select().from(clients).where(eq(clients.id, clientId));
    expect(clientRows).toHaveLength(0);

    // Verify audit event has actor_type = 'system' and actor_id = 'retention-worker'
    const auditRow = await dbClient
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'privacy.erasure.completed'),
          eq(auditEvents.targetId, clientId),
        ),
      )
      .limit(1);

    expect(auditRow).toHaveLength(1);
    expect(auditRow[0]?.actorType).toBe('system');
    expect(auditRow[0]?.actorId).toBe('retention-worker');
  });
});

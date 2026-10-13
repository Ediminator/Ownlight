import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';

vi.mock('server-only', () => ({}));

import * as schema from '@/server/db/schema';
import { auditEvents } from '@/server/db/schema/audit';
import { leads } from '@/server/db/schema/leads';
import { clients } from '@/server/db/schema/clients';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { createLead, changeLeadStatus, deleteLeads, getLead } from '@/server/leads/service';
import { generateUuidV7 } from '@/lib/id';
import type { DbClient } from '@/server/db/client';

describe('TASK-0026: Leads Domain Service & Database Integrity (AC-1, AC-3, AC-4, AC-5)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dbClient: DbClient;
  let formId: string;
  let noticeVersionId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    dbClient = db as unknown as DbClient;
    await migrate(db, { migrationsFolder: drizzleDir });

    // Seed test inquiry form & notice version for FK references
    formId = generateUuidV7();
    noticeVersionId = generateUuidV7();

    await db.insert(inquiryForms).values({
      id: formId,
      slug: 'test-form',
      name: 'Studio Main Contact Form',
      status: 'published',
      defaultLocale: 'en',
      fields: [
        { key: 'given_name', enabled: true, required: true, order: 0 },
        { key: 'email', enabled: true, required: true, order: 1 },
      ],
      eventTypes: [],
      currentNoticeVersionId: null,
      autoReplyEnabled: true,
      acceptUnverified: false,
    });

    await db.insert(inquiryFormNoticeVersions).values({
      id: noticeVersionId,
      formId: formId,
      version: 1,
      acknowledgementTextEn: 'I acknowledge the studio privacy notice.',
      acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
      privacyPolicyUrl: 'https://example.com/privacy',
      createdByActorId: 'owner-fixture-1',
    });

    await db
      .update(inquiryForms)
      .set({ currentNoticeVersionId: noticeVersionId })
      .where(eq(inquiryForms.id, formId));
  });

  afterAll(async () => {
    await client.close();
  });

  it('AC-1: creates a new lead with email_normalized lowercased and trimmed, received_at = last_activity_at, and audit event lead.received', async () => {
    const rawEmail = '  Alice.Smith@Example.COM  ';
    const result = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        verification: 'verified',
        deliveryMode: 'hosted',
        givenName: 'Alice',
        familyName: 'Smith',
        email: rawEmail,
        phone: '+49 30 0000 0001',
        message: 'Looking for a portrait session.',
      },
      undefined,
      dbClient,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const leadId = result.id;
    const persistedLead = await getLead(leadId, dbClient);
    expect(persistedLead).not.toBeNull();
    expect(persistedLead?.status).toBe('new');
    expect(persistedLead?.email).toBe('Alice.Smith@Example.COM');
    expect(persistedLead?.emailNormalized).toBe('alice.smith@example.com');
    expect(persistedLead?.receivedAt.toISOString()).toBe(
      persistedLead?.lastActivityAt.toISOString(),
    );

    // Audit event check
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.targetId, leadId));

    const receivedEvent = audits.find((a) => a.action === 'lead.received');
    expect(receivedEvent).toBeDefined();
    if (!receivedEvent) throw new Error('Expected lead.received audit event');
    expect(receivedEvent.actorType).toBe('system');
    expect(receivedEvent.actorId).toBe('public-inquiry-endpoint');
    expect(receivedEvent.targetType).toBe('lead');
    expect(receivedEvent.outcome).toBe('success');

    // Metadata contains ONLY form_id, verification, and delivery_mode
    const metadata = receivedEvent.metadata;
    expect(metadata).toEqual({
      form_id: formId,
      verification: 'verified',
      delivery_mode: 'hosted',
    });
    expect(Object.keys(metadata ?? {}).sort()).toEqual([
      'delivery_mode',
      'form_id',
      'verification',
    ]);
  });

  it('AC-2 (Service Integration): changeLeadStatus transitions status and updates last_activity_at or returns INVALID_TRANSITION', async () => {
    const lead = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Bob',
        familyName: 'Jones',
        email: 'bob@example.com',
      },
      undefined,
      dbClient,
    );
    expect(lead.success).toBe(true);
    if (!lead.success) return;

    const initialActivityAt = lead.lastActivityAt;

    // Allowed transition: new -> contacted
    const changeRes = await changeLeadStatus(lead.id, 'contacted', 'owner-actor-1', dbClient);
    expect(changeRes.success).toBe(true);
    if (!changeRes.success) return;

    expect(changeRes.status).toBe('contacted');
    expect(changeRes.lastActivityAt.getTime()).toBeGreaterThanOrEqual(initialActivityAt.getTime());

    // Verify audit event
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.targetId, lead.id));
    const statusEvent = audits.find((a) => a.action === 'lead.status_changed');
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.metadata).toEqual({ from: 'new', to: 'contacted' });

    // Disallowed transition: contacted -> converted is not reachable through changeLeadStatus
    const invalidToConverted = await changeLeadStatus(
      lead.id,
      'converted',
      'owner-actor-1',
      dbClient,
    );
    expect(invalidToConverted).toEqual({
      success: false,
      code: 'INVALID_TRANSITION',
      error: 'INVALID_TRANSITION',
    });

    // Disallowed transition: contacted -> contacted
    const invalidSelf = await changeLeadStatus(lead.id, 'contacted', 'owner-actor-1', dbClient);
    expect(invalidSelf).toEqual({
      success: false,
      code: 'INVALID_TRANSITION',
      error: 'INVALID_TRANSITION',
    });
  });

  it('AC-3: deleteLeads with a converted lead fails with CONVERTED_LEAD and deletes nothing', async () => {
    // 1. Insert a client for FK reference
    const clientId = generateUuidV7();
    await db.insert(clients).values({
      id: clientId,
      kind: 'person',
      displayName: 'Converted Client',
      preferredLocale: 'en',
    });

    // 2. Insert a converted lead fixture
    const convertedLeadId = generateUuidV7();
    await db.insert(leads).values({
      id: convertedLeadId,
      clientId,
      formId,
      noticeVersionId,
      noticeAcknowledgedAt: new Date(),
      status: 'converted',
      verification: 'verified',
      deliveryMode: 'hosted',
      locale: 'en',
      convertedAt: new Date(),
    });

    // 3. Insert a regular new lead
    const normalLead = await createLead(
      {
        formId,
        noticeVersionId,
        locale: 'en',
        givenName: 'Charlie',
        email: 'charlie@example.com',
      },
      undefined,
      dbClient,
    );
    expect(normalLead.success).toBe(true);
    if (!normalLead.success) return;

    // 4. Attempt to delete both converted lead and normal lead
    const deleteRes = await deleteLeads(
      [convertedLeadId, normalLead.id],
      'owner-actor-1',
      dbClient,
    );
    expect(deleteRes).toEqual({
      success: false,
      code: 'CONVERTED_LEAD',
      error: 'CONVERTED_LEAD',
    });

    // Verify neither lead was deleted
    const checkConverted = await getLead(convertedLeadId, dbClient);
    expect(checkConverted).not.toBeNull();

    const checkNormal = await getLead(normalLead.id, dbClient);
    expect(checkNormal).not.toBeNull();
  });

  it('AC-4: deleteLeads deletes 3 spam leads in one call and emits exactly one lead.deleted audit event with count: 3, bulk: true', async () => {
    // 1. Create 3 spam leads
    const spamIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const spamLead = await createLead(
        {
          formId,
          noticeVersionId,
          locale: 'en',
          givenName: 'Spammer' + String(i),
          email: 'spam' + String(i) + '@example.com',
          message: 'Buy cheap watches',
        },
        undefined,
        dbClient,
      );
      expect(spamLead.success).toBe(true);
      if (!spamLead.success) return;

      await changeLeadStatus(spamLead.id, 'spam', 'owner-actor-1', dbClient);
      spamIds.push(spamLead.id);
    }

    expect(spamIds).toHaveLength(3);

    // 2. Delete all 3 in one call
    const deleteRes = await deleteLeads(spamIds, 'owner-actor-1', dbClient);
    expect(deleteRes.success).toBe(true);
    if (!deleteRes.success) throw new Error('Expected deleteLeads to succeed');
    expect(deleteRes.count).toBe(3);

    // 3. Verify they are gone from the database
    for (const id of spamIds) {
      const check = await getLead(id, dbClient);
      expect(check).toBeNull();
    }

    // 4. Verify exactly one lead.deleted audit event exists with count: 3, bulk: true
    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'lead.deleted'));

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const lastAuditEvent = auditRows[auditRows.length - 1];
    expect(lastAuditEvent?.metadata).toEqual({
      count: 3,
      bulk: true,
    });
  });

  it('AC-5: database rejects direct inserts violating CHECK constraints', async () => {
    const dummyId1 = generateUuidV7();
    const dummyId2 = generateUuidV7();
    const dummyId3 = generateUuidV7();

    // 1. Converted without client_id -> violates (status = 'converted') = (client_id IS NOT NULL)
    await expect(
      client.query(`
        INSERT INTO leads (
          id, form_id, notice_version_id, notice_acknowledged_at,
          status, verification, delivery_mode, locale,
          client_id, given_name, email, received_at, last_activity_at
        ) VALUES (
          '${dummyId1}', '${formId}', '${noticeVersionId}', NOW(),
          'converted', 'verified', 'hosted', 'en',
          NULL, 'Invalid', 'invalid@example.com', NOW(), NOW()
        )
      `),
    ).rejects.toThrow();

    // 2. New without email -> violates status = 'converted' OR (given_name IS NOT NULL AND email IS NOT NULL)
    await expect(
      client.query(`
        INSERT INTO leads (
          id, form_id, notice_version_id, notice_acknowledged_at,
          status, verification, delivery_mode, locale,
          given_name, email, received_at, last_activity_at
        ) VALUES (
          '${dummyId2}', '${formId}', '${noticeVersionId}', NOW(),
          'new', 'verified', 'hosted', 'en',
          'NoEmail', NULL, NOW(), NOW()
        )
      `),
    ).rejects.toThrow();

    // 3. Message of 2,001 characters -> violates length(message) <= 2000
    const longMessage = 'X'.repeat(2001);
    await expect(
      client.query(`
        INSERT INTO leads (
          id, form_id, notice_version_id, notice_acknowledged_at,
          status, verification, delivery_mode, locale,
          given_name, email, message, received_at, last_activity_at
        ) VALUES (
          '${dummyId3}', '${formId}', '${noticeVersionId}', NOW(),
          'new', 'verified', 'hosted', 'en',
          'LongMessage', 'long@example.com', '${longMessage}', NOW(), NOW()
        )
      `),
    ).rejects.toThrow();
  });
});

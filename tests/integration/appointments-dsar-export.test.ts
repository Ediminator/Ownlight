import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import { collectExportData, resetExportProviders } from '@/server/privacy/export/registry';
import { generateExport } from '@/server/privacy/export/service';
import { exportClientDataAction } from '@/server/privacy/export/actions';
import { resetCategoryRegistry } from '@/server/privacy/export/categories';
import {
  appointmentsExportProvider,
  formatAppointmentsHtml,
} from '@/server/privacy/export/appointments';
import { user } from '@/server/db/schema/auth';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { inquiryForms, inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { appointments } from '@/server/db/schema/calendar';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import type { DbClient } from '@/server/db/client';

describe('TASK-0041: Appointments DSAR Export Integration Tests (AC-1)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUserId: string;

  beforeEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    resetExportProviders();
    resetCategoryRegistry();

    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
    (globalThis as unknown as { db: DbClient | undefined }).db = dbClient;

    mockHeadersStore.set('host', 'localhost:3000');
    mockHeadersStore.set('origin', 'http://localhost:3000');

    ownerUserId = '01920000-0000-7000-8000-000000000001';
    await dbClient.insert(user).values({
      id: ownerUserId,
      name: 'Studio Owner',
      email: 'owner@example.com',
      emailVerified: true,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(studioSettings).values({
      id: '01920000-0000-7000-8000-000000000002',
      studio_name: 'Starlight Studio',
      default_locale: 'en',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      mfa_required: false,
    });
  });

  afterEach(async () => {
    delete (globalThis as unknown as { db: DbClient | undefined }).db;
    await testDb.destroy();
  });

  async function authenticateAsOwner(): Promise<void> {
    const sessionRes = await createSession(ownerUserId, dbClient);
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionRes.token);
  }

  it('AC-1: exports scheduled and completed appointments for a client in JSON and HTML formats', async () => {
    const clientId = '01920000-0000-7000-8000-000000000010';
    const contactId = '01920000-0000-7000-8000-000000000011';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Alice Cooper',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Alice',
      familyName: 'Cooper',
      email: 'alice@example.com',
      isPrimary: true,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    });

    // 1. Completed consultation appointment
    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000020',
      clientId,
      title: 'Initial Consultation',
      status: 'completed',
      startsAt: new Date('2026-02-10T14:00:00Z'),
      endsAt: new Date('2026-02-10T14:45:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'google_meet',
      meetUrl: 'https://meet.google.com/xyz-abcd-efg',
      attendeeName: 'Alice Cooper',
      attendeeEmail: 'alice@example.com',
      attendeeNotes: 'Discussed album shoot requirements.',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      updatedAt: new Date('2026-02-10T15:00:00Z'),
    });

    // 2. Scheduled pre-shoot meeting appointment
    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000021',
      clientId,
      title: 'Pre-Shoot Location Walkthrough',
      status: 'scheduled',
      startsAt: new Date('2026-07-15T09:00:00Z'),
      endsAt: new Date('2026-07-15T10:00:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'in_person',
      locationDetails: 'Studio Berlin, Stage 3',
      attendeeName: 'Alice Cooper',
      attendeeEmail: 'alice@example.com',
      createdAt: new Date('2026-02-15T10:00:00Z'),
      updatedAt: new Date('2026-02-15T10:00:00Z'),
    });

    // Collect export data via collectExportData
    const res = await collectExportData({ clientId }, dbClient);
    expect(res).not.toBeNull();
    if (!res) return;
    const exportData = res.exportData;

    expect(exportData.schema).toBe('ownlight.dsar.v1');
    expect(exportData.subject.display_name).toBe('Alice Cooper');

    const apptCategory = exportData.categories.appointments as {
      id: string;
      title: string;
      status: string;
      starts_at: string;
      ends_at: string;
      duration_minutes: number;
      location_type: string;
      location_details: string | null;
      meet_url: string | null;
      attendee_name: string;
      attendee_email: string;
    }[];

    expect(apptCategory).toBeDefined();
    expect(apptCategory).toHaveLength(2);

    // Verify first appointment (completed)
    const completed = apptCategory.find((a) => a.title === 'Initial Consultation');
    expect(completed).toBeDefined();
    expect(completed?.status).toBe('completed');
    expect(completed?.duration_minutes).toBe(45);
    expect(completed?.location_type).toBe('google_meet');
    expect(completed?.meet_url).toBe('https://meet.google.com/xyz-abcd-efg');
    expect(completed?.attendee_name).toBe('Alice Cooper');
    expect(completed?.attendee_email).toBe('alice@example.com');

    // Verify second appointment (scheduled)
    const scheduled = apptCategory.find((a) => a.title === 'Pre-Shoot Location Walkthrough');
    expect(scheduled).toBeDefined();
    expect(scheduled?.status).toBe('scheduled');
    expect(scheduled?.duration_minutes).toBe(60);
    expect(scheduled?.location_type).toBe('in_person');
    expect(scheduled?.location_details).toBe('Studio Berlin, Stage 3');

    // Generate HTML export in English and German
    const htmlEn = await generateExport({
      clientId,
      format: 'html',
      locale: 'en',
      actorId: ownerUserId,
      client: dbClient,
    });

    expect(htmlEn).not.toBeNull();
    expect(htmlEn?.content).toContain('Appointments &amp; Consultations');
    expect(htmlEn?.content).toContain('Initial Consultation');
    expect(htmlEn?.content).toContain('Pre-Shoot Location Walkthrough');
    expect(htmlEn?.content).toContain('Starts At');
    expect(htmlEn?.content).toContain('Duration Minutes');
    expect(htmlEn?.content).toContain('Status');

    const htmlDe = await generateExport({
      clientId,
      format: 'html',
      locale: 'de',
      actorId: ownerUserId,
      client: dbClient,
    });

    expect(htmlDe).not.toBeNull();
    expect(htmlDe?.content).toContain('Termine &amp; Beratungsgespräche');
    expect(htmlDe?.content).toContain('Beginn');
    expect(htmlDe?.content).toContain('Dauer (Min.)');
    expect(htmlDe?.content).toContain('Status');
  });

  it('AC-1: exports appointments matching contact email even if clientId is unassociated or different', async () => {
    const clientId = '01920000-0000-7000-8000-000000000030';
    const contactId = '01920000-0000-7000-8000-000000000031';

    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Bob Dylan',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: 'Bob',
      familyName: 'Dylan',
      email: 'bob@example.org',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Appointment booked with Bob's email before client account was formally linked
    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000032',
      clientId: null,
      title: 'Discovery Call',
      status: 'scheduled',
      startsAt: new Date('2026-08-01T10:00:00Z'),
      endsAt: new Date('2026-08-01T10:30:00Z'),
      timezone: 'America/New_York',
      locationType: 'phone',
      attendeeName: 'Bob Dylan',
      attendeeEmail: 'bob@example.org',
      attendeePhone: '+1 212 555 0199',
    });

    const res = await collectExportData({ contactId }, dbClient);
    expect(res).not.toBeNull();
    if (!res) return;

    const appts = res.exportData.categories.appointments as {
      title: string;
      attendee_email: string;
      location_type: string;
    }[];

    expect(appts).toHaveLength(1);
    expect(appts[0]?.title).toBe('Discovery Call');
    expect(appts[0]?.attendee_email).toBe('bob@example.org');
    expect(appts[0]?.location_type).toBe('phone');
  });

  it('AC-1: exports appointments for a lead subject matched by leadId or email', async () => {
    const leadId = '01920000-0000-7000-8000-000000000040';
    const formId = '01920000-0000-7000-8000-000000000041';
    const noticeId = '01920000-0000-7000-8000-000000000042';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'Contact Form',
      slug: 'cf-dsar',
      fields: [],
      eventTypes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeId,
      formId,
      version: 1,
      acknowledgementTextEn: 'I agree',
      acknowledgementTextDe: 'Ich stimme zu',
      createdByActorId: ownerUserId,
      createdAt: new Date(),
    });

    await dbClient.insert(leads).values({
      id: leadId,
      formId,
      noticeVersionId: noticeId,
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      givenName: 'Charlie',
      familyName: 'Brown',
      email: 'charlie@example.com',
      emailNormalized: 'charlie@example.com',
      locale: 'en',
      message: 'Inquiring about consultation',
      noticeAcknowledgedAt: new Date(),
      receivedAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Appointment matched by leadId
    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000045',
      leadId,
      title: 'Introductory Phone Consultation',
      status: 'scheduled',
      startsAt: new Date('2026-09-01T14:00:00Z'),
      endsAt: new Date('2026-09-01T14:30:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'phone',
      attendeeName: 'Charlie Brown',
      attendeeEmail: 'charlie@example.com',
    });

    const res = await collectExportData({ leadId }, dbClient);
    expect(res).not.toBeNull();
    if (!res) return;

    const appts = res.exportData.categories.appointments as {
      title: string;
      attendee_name: string;
      attendee_email: string;
      duration_minutes: number;
    }[];

    expect(appts).toHaveLength(1);
    expect(appts[0]?.title).toBe('Introductory Phone Consultation');
    expect(appts[0]?.attendee_name).toBe('Charlie Brown');
    expect(appts[0]?.duration_minutes).toBe(30);

    // Test HTML generation for lead
    const htmlLead = await generateExport({
      leadId,
      format: 'html',
      locale: 'en',
      actorId: ownerUserId,
      client: dbClient,
    });

    expect(htmlLead).not.toBeNull();
    expect(htmlLead?.content).toContain('Introductory Phone Consultation');
    expect(htmlLead?.content).toContain('Charlie Brown');
  });

  it('AC-1 (R-A): executes export via exportClientDataAction server action with authz check', async () => {
    const clientId = '01920000-0000-7000-8000-000000000050';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Diana Prince',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000051',
      clientId,
      title: 'Studio Portrait Session Consultation',
      status: 'completed',
      startsAt: new Date('2026-05-01T11:00:00Z'),
      endsAt: new Date('2026-05-01T11:30:00Z'),
      timezone: 'Europe/Berlin',
      locationType: 'google_meet',
      attendeeName: 'Diana Prince',
      attendeeEmail: 'diana@example.com',
    });

    // 1. Unauthenticated call fails with UNAUTHORIZED
    const unauthResult = await exportClientDataAction({
      clientId,
      format: 'json',
      locale: 'en',
    });
    expect(unauthResult.success).toBe(false);

    // 2. Authenticated owner call succeeds
    await authenticateAsOwner();
    const authResult = await exportClientDataAction({
      clientId,
      format: 'json',
      locale: 'en',
    });

    expect(authResult.success).toBe(true);
    if (!authResult.success) return;

    const parsedJson = JSON.parse(authResult.data.content) as {
      categories: {
        appointments: { title: string }[];
      };
    };
    expect(parsedJson.categories.appointments).toHaveLength(1);
    expect(parsedJson.categories.appointments[0]?.title).toBe(
      'Studio Portrait Session Consultation',
    );
  });

  it('AC-1: formatAppointmentsHtml formats table and empty states in en and de', () => {
    // Empty state en
    const emptyEn = formatAppointmentsHtml([], 'en');
    expect(emptyEn).toContain('No records stored in this category.');

    // Empty state de
    const emptyDe = formatAppointmentsHtml([], 'de');
    expect(emptyDe).toContain('In dieser Kategorie sind derzeit keine Datensätze gespeichert.');

    // Table formatting en
    const tableEn = formatAppointmentsHtml(
      [
        {
          id: '01920000-0000-7000-8000-000000000060',
          title: 'Wedding Consultation',
          status: 'scheduled',
          starts_at: '2026-06-01T10:00:00.000Z',
          ends_at: '2026-06-01T11:00:00.000Z',
          duration_minutes: 60,
          timezone: 'Europe/Berlin',
          location_type: 'google_meet',
          location_details: 'Online',
          meet_url: 'https://meet.google.com/test-123',
          attendee_name: 'Grace Hopper',
          attendee_email: 'grace@example.com',
          attendee_phone: '+1 555 1234',
          attendee_notes: 'Discussion notes',
          cancellation_reason: null,
          cancelled_at: null,
          created_at: '2026-05-01T10:00:00.000Z',
        },
      ],
      'en',
    );
    expect(tableEn).toContain('Wedding Consultation');
    expect(tableEn).toContain('https://meet.google.com/test-123');
    expect(tableEn).toContain('Grace Hopper');

    // Table formatting de
    const tableDe = formatAppointmentsHtml(
      [
        {
          id: '01920000-0000-7000-8000-000000000061',
          title: 'Porträt-Shooting Vorgespräch',
          status: 'completed',
          starts_at: '2026-06-02T10:00:00.000Z',
          ends_at: '2026-06-02T10:30:00.000Z',
          duration_minutes: 30,
          timezone: 'Europe/Berlin',
          location_type: 'in_person',
          location_details: null,
          meet_url: null,
          attendee_name: 'Ada Lovelace',
          attendee_email: 'ada@example.com',
          attendee_phone: null,
          attendee_notes: null,
          cancellation_reason: null,
          cancelled_at: null,
          created_at: '2026-05-01T10:00:00.000Z',
        },
      ],
      'de',
    );
    expect(tableDe).toContain('Porträt-Shooting Vorgespräch');
    expect(tableDe).toContain('Dauer');
  });

  it('AC-1: exports appointments when client has no contact email or lead has no email', async () => {
    const clientId = '01920000-0000-7000-8000-000000000070';
    await dbClient.insert(clients).values({
      id: clientId,
      displayName: 'Anonymous Client',
      kind: 'person',
      preferredLocale: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000071',
      clientId,
      title: 'Anonymous Consultation',
      status: 'scheduled',
      startsAt: new Date('2026-11-01T10:00:00Z'),
      endsAt: new Date('2026-11-01T10:30:00Z'),
      attendeeName: 'Anonymous Client',
      attendeeEmail: 'anon@example.com',
    });

    // Client without contact
    const [clientRow] = await dbClient
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    expect(clientRow).toBeDefined();
    if (!clientRow) return;

    const fakeContact = {
      id: '01920000-0000-7000-8000-000000000076',
      clientId,
      givenName: 'Anon',
      familyName: null,
      email: null,
      emailNormalized: null,
      phone: null,
      role: null,
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const collected = (await appointmentsExportProvider.collect(
      {
        contactId: fakeContact.id,
        clientId,
        client: clientRow,
        contact: fakeContact,
      },
      dbClient,
    )) as { title: string }[];

    expect(collected).toHaveLength(1);
    expect(collected[0]?.title).toBe('Anonymous Consultation');

    // Lead without email
    const leadId = '01920000-0000-7000-8000-000000000072';
    const formId = '01920000-0000-7000-8000-000000000073';
    const noticeId = '01920000-0000-7000-8000-000000000074';

    await dbClient.insert(inquiryForms).values({
      id: formId,
      name: 'No Email Form',
      slug: 'no-email-form',
      fields: [],
      eventTypes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(inquiryFormNoticeVersions).values({
      id: noticeId,
      formId,
      version: 1,
      acknowledgementTextEn: 'Notice',
      acknowledgementTextDe: 'Hinweis',
      createdByActorId: ownerUserId,
      createdAt: new Date(),
    });

    await dbClient.insert(leads).values({
      id: leadId,
      clientId,
      formId,
      noticeVersionId: noticeId,
      status: 'converted',
      verification: 'verified',
      deliveryMode: 'hosted',
      locale: 'en',
      convertedAt: new Date(),
      noticeAcknowledgedAt: new Date(),
      receivedAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await dbClient.insert(appointments).values({
      id: '01920000-0000-7000-8000-000000000075',
      leadId,
      title: 'Phone Consultation Without Email',
      status: 'scheduled',
      startsAt: new Date('2026-12-01T10:00:00Z'),
      endsAt: new Date('2026-12-01T10:30:00Z'),
      attendeeName: 'Phone Only Attendee',
      attendeeEmail: 'fallback@example.com',
    });

    const [leadRow] = await dbClient.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    expect(leadRow).toBeDefined();
    if (leadRow) {
      const leadCollected = (await appointmentsExportProvider.collect(
        { kind: 'lead', leadId, lead: leadRow },
        dbClient,
      )) as { title: string }[];
      expect(leadCollected).toHaveLength(1);
      expect(leadCollected[0]?.title).toBe('Phone Consultation Without Email');
    }
  });
});

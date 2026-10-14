import { type PGlite } from '@electric-sql/pglite';
import { E2E_INQUIRY_PUBLISHED_ID, E2E_INQUIRY_PUBLISHED_NOTICE_ID } from './e2e-inquiry-helper';

export const E2E_LEAD_NEW_ID = '018f0000-0000-7000-8000-000000000060';
export const E2E_LEAD_CONTACTED_ID = '018f0000-0000-7000-8000-000000000061';
export const E2E_LEAD_CONVERTED_ID = '018f0000-0000-7000-8000-000000000062';
export const E2E_LEAD_ARCHIVED_ID = '018f0000-0000-7000-8000-000000000063';
export const E2E_LEAD_SPAM_ID = '018f0000-0000-7000-8000-000000000064';
export const E2E_LEAD_XSS_ID = '018f0000-0000-7000-8000-000000000065';
export const E2E_LEAD_CONVERT_TARGET_ID = '018f0000-0000-7000-8000-000000000066';
export const E2E_LEAD_DUPLICATE_ID = '018f0000-0000-7000-8000-000000000067';

export async function seedAllE2eLeads(pglite: PGlite): Promise<void> {
  const now = new Date().toISOString();

  const clientRes = await pglite.query<{ id: string }>('SELECT id FROM clients LIMIT 1');
  let convertedClientId = clientRes.rows[0]?.id;
  if (!convertedClientId) {
    convertedClientId = '018f0000-0000-7000-8000-000000000099';
    await pglite.query(
      `INSERT INTO clients (
        id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at
      ) VALUES ($1, 'person', 'Carol Danvers', 'en', $2, $2, $2)`,
      [convertedClientId, now],
    );
  }

  const leadsData = [
    {
      id: E2E_LEAD_NEW_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Alice',
      familyName: 'Wonderland',
      email: 'alice.wonderland@example.com',
      emailNormalized: 'alice.wonderland@example.com',
      phone: '+49 30 11111111',
      eventTypeKey: 'wedding',
      eventDate: '2026-07-20',
      eventLocation: 'Berlin',
      message: 'Looking forward to our photoshoot session in Berlin.',
      autoReplyStatus: 'sent',
    },
    {
      id: E2E_LEAD_CONTACTED_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'contacted',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Bob',
      familyName: 'Builder',
      email: 'bob.builder@example.com',
      emailNormalized: 'bob.builder@example.com',
      phone: '+49 30 22222222',
      eventTypeKey: 'portrait',
      eventDate: '2026-08-10',
      eventLocation: 'Hamburg',
      message: 'Can we schedule a call regarding corporate portraits?',
      autoReplyStatus: 'sent',
    },
    {
      id: E2E_LEAD_CONVERTED_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'converted',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: convertedClientId,
      convertedAt: now,
      givenName: 'Carol',
      familyName: 'Danvers',
      email: 'carol.danvers@example.com',
      emailNormalized: 'carol.danvers@example.com',
      phone: '+49 30 33333333',
      eventTypeKey: 'wedding',
      eventDate: '2026-09-01',
      eventLocation: 'Munich',
      message: 'Already converted lead for testing conversion and deletion guard.',
      autoReplyStatus: 'sent',
    },
    {
      id: E2E_LEAD_ARCHIVED_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'archived',
      verification: 'unverified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Dave',
      familyName: 'Diver',
      email: 'dave.diver@example.com',
      emailNormalized: 'dave.diver@example.com',
      phone: null,
      eventTypeKey: null,
      eventDate: null,
      eventLocation: null,
      message: 'Archived inquiry.',
      autoReplyStatus: 'not_applicable',
    },
    {
      id: E2E_LEAD_SPAM_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'spam',
      verification: 'unverified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Eve',
      familyName: 'Spambot',
      email: 'spam.bot@example.com',
      emailNormalized: 'spam.bot@example.com',
      phone: null,
      eventTypeKey: null,
      eventDate: null,
      eventLocation: null,
      message: 'Buy cheap crypto now at shady-link!',
      autoReplyStatus: 'not_applicable',
    },
    {
      id: E2E_LEAD_XSS_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Frank',
      familyName: 'XssProbe',
      email: 'frank.probe@example.com',
      emailNormalized: 'frank.probe@example.com',
      phone: '+49 30 55555555',
      eventTypeKey: 'portrait',
      eventDate: '2026-10-31',
      eventLocation: 'Frankfurt',
      message: '<script>alert(1)</script>',
      autoReplyStatus: 'sent',
    },
    {
      id: E2E_LEAD_CONVERT_TARGET_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Clara',
      familyName: 'Oswald',
      email: 'clara.oswald@example.com',
      emailNormalized: 'clara.oswald@example.com',
      phone: '+49 30 11223344',
      eventTypeKey: 'wedding',
      eventDate: '2026-11-15',
      eventLocation: 'Berlin',
      message: 'Looking for wedding package details.',
      autoReplyStatus: 'sent',
    },
    {
      id: E2E_LEAD_DUPLICATE_ID,
      formId: E2E_INQUIRY_PUBLISHED_ID,
      noticeVersionId: E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      locale: 'en',
      status: 'new',
      verification: 'verified',
      deliveryMode: 'hosted',
      clientId: null,
      convertedAt: null,
      givenName: 'Maci',
      familyName: 'WeimannDuplicate',
      email: 'maci.weimann.1.0@example.org',
      emailNormalized: 'maci.weimann.1.0@example.org',
      phone: '+49 30 99887766',
      eventTypeKey: 'wedding',
      eventDate: '2026-12-01',
      eventLocation: 'Berlin',
      message: 'Hello, need package details.',
      autoReplyStatus: 'sent',
    },
  ];

  for (const l of leadsData) {
    await pglite.query(
      `INSERT INTO leads (
        id, form_id, notice_version_id, notice_acknowledged_at, locale,
        status, verification, delivery_mode, client_id, converted_at,
        given_name, family_name, email, email_normalized, phone,
        event_type_key, event_date, event_location, message, auto_reply_status,
        received_at, last_activity_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $4, $4, $4, $4
      )
      ON CONFLICT (id) DO UPDATE SET
        status = $6,
        client_id = $9,
        converted_at = $10,
        updated_at = $4`,
      [
        l.id,
        l.formId,
        l.noticeVersionId,
        now,
        l.locale,
        l.status,
        l.verification,
        l.deliveryMode,
        l.clientId,
        l.convertedAt,
        l.givenName,
        l.familyName,
        l.email,
        l.emailNormalized,
        l.phone,
        l.eventTypeKey,
        l.eventDate,
        l.eventLocation,
        l.message,
        l.autoReplyStatus,
      ],
    );
  }
}

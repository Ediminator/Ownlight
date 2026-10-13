import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import crypto from 'node:crypto';

export interface E2eSeedFormOptions {
  slug: string;
  name: string;
  status?: 'published' | 'draft' | 'archived';
  acceptUnverified?: boolean;
  privacyPolicyUrl?: string;
  acknowledgementTextEn?: string;
  acknowledgementTextDe?: string;
  eventTypes?: { key: string; label_en: string; label_de: string }[];
}

export async function seedE2eInquiryForm(options: E2eSeedFormOptions): Promise<{
  formId: string;
  noticeVersionId: string;
  slug: string;
}> {
  const pglite = new PGlite(path.resolve('./.pglite-e2e'));
  await pglite.waitReady;

  const formId = crypto.randomUUID();
  const noticeVersionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const status = options.status ?? 'published';
  const acceptUnverified = options.acceptUnverified ?? true;
  const privacyPolicyUrl = options.privacyPolicyUrl ?? 'https://example.org/privacy';
  const ackEn = options.acknowledgementTextEn ?? 'I have read and acknowledge the privacy policy.';
  const ackDe =
    options.acknowledgementTextDe ?? 'Ich habe die Datenschutzerklärung zur Kenntnis genommen.';

  const fields = JSON.stringify([
    { key: 'given_name', enabled: true, required: true, order: 0 },
    { key: 'family_name', enabled: true, required: false, order: 1 },
    { key: 'email', enabled: true, required: true, order: 2 },
    { key: 'phone', enabled: true, required: false, order: 3 },
    { key: 'event_type', enabled: true, required: false, order: 4 },
    { key: 'event_date', enabled: true, required: false, order: 5 },
    { key: 'event_location', enabled: true, required: false, order: 6 },
    { key: 'message', enabled: true, required: false, order: 7 },
  ]);

  const eventTypes = JSON.stringify(
    options.eventTypes ?? [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
    ],
  );

  // 1. Check if form with this slug already exists
  const check = await pglite.query<{ id: string }>(
    `SELECT id FROM inquiry_forms WHERE slug = $1 LIMIT 1`,
    [options.slug],
  );

  let targetFormId: string = formId;
  if (check.rows.length > 0 && check.rows[0]?.id) {
    targetFormId = check.rows[0].id;
    await pglite.query(
      `UPDATE inquiry_forms SET
        name = $1,
        status = $2,
        fields = $3,
        event_types = $4,
        accept_unverified = $5,
        updated_at = $6
       WHERE id = $7`,
      [options.name, status, fields, eventTypes, acceptUnverified, now, targetFormId],
    );
  } else {
    await pglite.query(
      `INSERT INTO inquiry_forms (
        id, slug, name, status, default_locale, fields, event_types, auto_reply_enabled, accept_unverified, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        targetFormId,
        options.slug,
        options.name,
        status,
        'en',
        fields,
        eventTypes,
        true,
        acceptUnverified,
        now,
      ],
    );
  }

  // 2. Insert notice version referencing targetFormId
  const noticeRes = await pglite.query<{ id: string }>(
    `INSERT INTO inquiry_form_notice_versions (
      id, form_id, version, acknowledgement_text_en, acknowledgement_text_de, privacy_policy_url, created_by_actor_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (form_id, version) DO UPDATE SET
      acknowledgement_text_en = $4,
      acknowledgement_text_de = $5,
      privacy_policy_url = $6
    RETURNING id`,
    [noticeVersionId, targetFormId, 1, ackEn, ackDe, privacyPolicyUrl, 'e2e-seed', now],
  );

  const actualNoticeVersionId = noticeRes.rows[0]?.id ?? noticeVersionId;

  // 3. Link current_notice_version_id on inquiry form
  await pglite.query(
    `UPDATE inquiry_forms SET current_notice_version_id = $1, updated_at = $2 WHERE id = $3`,
    [actualNoticeVersionId, now, targetFormId],
  );

  await pglite.close();

  return { formId: targetFormId, noticeVersionId: actualNoticeVersionId, slug: options.slug };
}

export interface E2eLeadRow {
  id: string;
  form_id: string;
  given_name: string;
  family_name: string | null;
  email: string;
  phone: string | null;
  event_type: string | null;
  event_date: string | null;
  event_location: string | null;
  message: string | null;
  delivery_mode: string;
  verification: string;
  status: string;
  notice_version_id: string;
  notice_acknowledged_at: string;
  created_at: string;
}

export async function getE2eLeadsForForm(formId: string): Promise<E2eLeadRow[]> {
  const pglite = new PGlite(path.resolve('./.pglite-e2e'));
  await pglite.waitReady;

  const result = await pglite.query<E2eLeadRow>(
    `SELECT * FROM leads WHERE form_id = $1 ORDER BY created_at DESC`,
    [formId],
  );

  await pglite.close();
  return result.rows;
}

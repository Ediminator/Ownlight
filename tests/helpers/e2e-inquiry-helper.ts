import { type PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { PGlite as PGliteClient } from '@electric-sql/pglite';

export const E2E_INQUIRY_PUBLISHED_SLUG = 'inq-test01';
export const E2E_INQUIRY_PUBLISHED_ID = '018f0000-0000-7000-8000-000000000010';
export const E2E_INQUIRY_PUBLISHED_NOTICE_ID = '018f0000-0000-7000-8000-000000000011';
export const E2E_INQUIRY_DRAFT_SLUG = 'inq-draft1';
export const E2E_INQUIRY_DRAFT_ID = '018f0000-0000-7000-8000-000000000020';
export const E2E_INQUIRY_ARCHIVED_SLUG = 'inq-archv1';
export const E2E_INQUIRY_ARCHIVED_ID = '018f0000-0000-7000-8000-000000000030';

export async function seedAllE2eInquiryForms(pglite: PGlite): Promise<void> {
  const now = new Date().toISOString();
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

  const eventTypes = JSON.stringify([
    { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
    { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
  ]);

  // 1. Published form
  await pglite.query(
    `INSERT INTO inquiry_forms (
      id, slug, name, status, default_locale, fields, event_types, auto_reply_enabled, accept_unverified, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    ON CONFLICT (id) DO UPDATE SET status = $4, updated_at = $10`,
    [
      E2E_INQUIRY_PUBLISHED_ID,
      E2E_INQUIRY_PUBLISHED_SLUG,
      'General Inquiries',
      'published',
      'en',
      fields,
      eventTypes,
      true,
      true,
      now,
    ],
  );

  await pglite.query(
    `INSERT INTO inquiry_form_notice_versions (
      id, form_id, version, acknowledgement_text_en, acknowledgement_text_de, privacy_policy_url, created_by_actor_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO NOTHING`,
    [
      E2E_INQUIRY_PUBLISHED_NOTICE_ID,
      E2E_INQUIRY_PUBLISHED_ID,
      1,
      'I have read and acknowledge the privacy policy.',
      'Ich habe die Datenschutzerklärung zur Kenntnis genommen.',
      'https://example.org/privacy',
      'e2e-seed',
      now,
    ],
  );

  await pglite.query(`UPDATE inquiry_forms SET current_notice_version_id = $1 WHERE id = $2`, [
    E2E_INQUIRY_PUBLISHED_NOTICE_ID,
    E2E_INQUIRY_PUBLISHED_ID,
  ]);

  // 2. Draft form
  await pglite.query(
    `INSERT INTO inquiry_forms (
      id, slug, name, status, default_locale, fields, event_types, auto_reply_enabled, accept_unverified, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    ON CONFLICT (id) DO UPDATE SET status = $4, updated_at = $10`,
    [
      E2E_INQUIRY_DRAFT_ID,
      E2E_INQUIRY_DRAFT_SLUG,
      'Draft Inquiry Form',
      'draft',
      'en',
      fields,
      eventTypes,
      true,
      true,
      now,
    ],
  );

  // 3. Archived form
  await pglite.query(
    `INSERT INTO inquiry_forms (
      id, slug, name, status, default_locale, fields, event_types, auto_reply_enabled, accept_unverified, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    ON CONFLICT (id) DO UPDATE SET status = $4, updated_at = $10`,
    [
      E2E_INQUIRY_ARCHIVED_ID,
      E2E_INQUIRY_ARCHIVED_SLUG,
      'Archived Inquiry Form',
      'archived',
      'en',
      fields,
      eventTypes,
      true,
      true,
      now,
    ],
  );
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
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
      const pglite = new PGliteClient(path.resolve('./.pglite-e2e'));
      await pglite.waitReady;
      try {
        const result = await pglite.query<E2eLeadRow>(
          `SELECT * FROM leads WHERE form_id = $1 ORDER BY created_at DESC`,
          [formId],
        );
        return result.rows;
      } finally {
        await pglite.close();
      }
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  return [];
}

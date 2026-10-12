import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import {
  createForm,
  updateForm,
  createNoticeVersion,
  publishForm,
  unpublishForm,
  archiveForm,
  getPublishedFormBySlug,
  getForm,
  getNoticeVersions,
  listForms,
} from '@/server/inquiry-forms/service';
import * as repo from '@/server/inquiry-forms/repo';
import {
  DEFAULT_ACKNOWLEDGEMENT_TEXT_EN,
  DEFAULT_ACKNOWLEDGEMENT_TEXT_DE,
  DEFAULT_FORM_FIELDS,
} from '@/server/inquiry-forms/schema';
import { isFormSlug } from '@/server/inquiry-forms/slug';
import { auditEvents } from '@/server/db/schema/audit';
import { eq, desc } from 'drizzle-orm';
import { validateAndSanitizeMetadata } from '@/server/audit/allowlist';
import type { ActorType } from '@/server/audit/types';

describe('TASK-0024: Inquiry Forms Domain Service Integration Tests (AC-1 to AC-10)', () => {
  let testDb: TestDatabaseInstance;
  let db: DbClient;
  const testActor = {
    actorType: 'owner' as ActorType,
    actorId: '018f0000-0000-7000-8000-000000000001',
  };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    db = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: createForm creates draft form, 10-char slug, version 1 default notice, auto_reply=true, accept_unverified=false, and inquiry_form.created audit event', async () => {
    const res = await createForm(
      {
        name: 'Wedding Inquiry Form',
        default_locale: 'en',
      },
      testActor,
      db,
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    const form = res.data;
    expect(form.id).toBeDefined();
    expect(form.name).toBe('Wedding Inquiry Form');
    expect(form.status).toBe('draft');
    expect(form.defaultLocale).toBe('en');
    expect(isFormSlug(form.slug)).toBe(true);
    expect(form.slug).toHaveLength(10);
    expect(form.autoReplyEnabled).toBe(true);
    expect(form.acceptUnverified).toBe(false);
    expect(form.currentNoticeVersionId).not.toBeNull();

    // Verify notice version 1
    const versions = await getNoticeVersions(form.id, db);
    expect(versions).toHaveLength(1);
    const v1 = versions[0];
    expect(v1).toBeDefined();
    expect(v1?.version).toBe(1);
    expect(v1?.acknowledgementTextEn).toBe(DEFAULT_ACKNOWLEDGEMENT_TEXT_EN);
    expect(v1?.acknowledgementTextDe).toBe(DEFAULT_ACKNOWLEDGEMENT_TEXT_DE);
    expect(v1?.createdByActorId).toBe(testActor.actorId);
    expect(form.currentNoticeVersionId).toBe(v1?.id);

    // Verify audit event inquiry_form.created
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'inquiry_form.created'));

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toBeDefined();
    if (!event) return;
    expect(event.targetId).toBe(form.id);
    expect(event.outcome).toBe('success');
    expect(event.metadata).toBeDefined();
    const meta = event.metadata;
    expect(meta?.form_id).toBe(form.id);
    expect(Array.isArray(meta?.changed_fields)).toBe(true);
  });

  it('AC-2: updateForm with invalid fields fails with VALIDATION_FAILED naming the offending field key, leaving form unchanged', async () => {
    const created = await createForm({ name: 'Field Test Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // 1. Disable email
    const disableEmail = DEFAULT_FORM_FIELDS.map((f) =>
      f.key === 'email' ? { ...f, enabled: false } : f,
    );
    const res1 = await updateForm(formId, { fields: disableEmail }, testActor, db);
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.code).toBe('VALIDATION_FAILED');
      expect(res1.fields).toContain('email');
      expect(res1.error).toContain('email');
    }

    // 2. Make given_name optional
    const optionalGivenName = DEFAULT_FORM_FIELDS.map((f) =>
      f.key === 'given_name' ? { ...f, required: false } : f,
    );
    const res2 = await updateForm(formId, { fields: optionalGivenName }, testActor, db);
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.code).toBe('VALIDATION_FAILED');
      expect(res2.fields).toContain('given_name');
      expect(res2.error).toContain('given_name');
    }

    // 3. Unknown key
    const unknownKeyFields = [
      ...DEFAULT_FORM_FIELDS,
      { key: 'unknown_key_xyz', enabled: true, required: false, order: 8 },
    ];
    const res3 = await updateForm(formId, { fields: unknownKeyFields }, testActor, db);
    expect(res3.success).toBe(false);
    if (!res3.success) {
      expect(res3.code).toBe('VALIDATION_FAILED');
      expect(res3.fields).toContain('unknown_key_xyz');
      expect(res3.error).toContain('unknown_key_xyz');
    }

    // 4. Repeated key
    const duplicateKeyFields = [
      ...DEFAULT_FORM_FIELDS,
      { key: 'message', enabled: true, required: false, order: 8 },
    ];
    const res4 = await updateForm(formId, { fields: duplicateKeyFields }, testActor, db);
    expect(res4.success).toBe(false);
    if (!res4.success) {
      expect(res4.code).toBe('VALIDATION_FAILED');
      expect(res4.fields).toContain('message');
      expect(res4.error).toContain('message');
    }

    // Verify form was NOT modified
    const current = await getForm(formId, db);
    expect(current?.fields).toEqual(created.data.fields);
  });

  it('AC-3: updateForm with invalid event_types fails with VALIDATION_FAILED, leaving form unchanged', async () => {
    const created = await createForm({ name: 'Event Type Test Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // Enable event_type in fields with zero event types
    const fieldsWithEventType = DEFAULT_FORM_FIELDS.map((f) =>
      f.key === 'event_type' ? { ...f, enabled: true } : f,
    );
    const res1 = await updateForm(
      formId,
      { fields: fieldsWithEventType, event_types: [] },
      testActor,
      db,
    );
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.code).toBe('VALIDATION_FAILED');
      expect(res1.error).toContain('at least one event type');
    }

    // 21 event types
    const tooManyEventTypes = Array.from({ length: 21 }, (_, i) => ({
      key: `type-${String(i)}`,
      label_en: `Type ${String(i)}`,
      label_de: `Typ ${String(i)}`,
    }));
    const res2 = await updateForm(
      formId,
      { fields: fieldsWithEventType, event_types: tooManyEventTypes },
      testActor,
      db,
    );
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.code).toBe('VALIDATION_FAILED');
      expect(res2.error).toContain('20');
    }

    // Duplicate key
    const duplicateKeyTypes = [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'wedding', label_en: 'Civil Wedding', label_de: 'Standesamt' },
    ];
    const res3 = await updateForm(
      formId,
      { fields: fieldsWithEventType, event_types: duplicateKeyTypes },
      testActor,
      db,
    );
    expect(res3.success).toBe(false);
    if (!res3.success) {
      expect(res3.code).toBe('VALIDATION_FAILED');
      expect(res3.error).toContain('Duplicate event type key "wedding"');
    }

    // Label over 60 characters
    const longLabelTypes = [{ key: 'wedding', label_en: 'A'.repeat(61), label_de: 'Hochzeit' }];
    const res4 = await updateForm(
      formId,
      { fields: fieldsWithEventType, event_types: longLabelTypes },
      testActor,
      db,
    );
    expect(res4.success).toBe(false);
    if (!res4.success) {
      expect(res4.code).toBe('VALIDATION_FAILED');
      expect(res4.error).toContain('60 characters');
    }

    // Valid update succeeds
    const validTypes = [
      { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
      { key: 'elopement', label_en: 'Elopement', label_de: 'Elopement' },
    ];
    const successUpdate = await updateForm(
      formId,
      { fields: fieldsWithEventType, event_types: validTypes },
      testActor,
      db,
    );
    expect(successUpdate.success).toBe(true);
    const updatedForm = await getForm(formId, db);
    expect(updatedForm?.eventTypes).toEqual(validTypes);
  });

  it('AC-4: createNoticeVersion run twice appends versions 2 and 3, current_notice_version_id points to version 3, and earlier versions remain unchanged byte for byte', async () => {
    const created = await createForm({ name: 'Version Test Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // Snapshot version 1
    const versionsBefore = await getNoticeVersions(formId, db);
    expect(versionsBefore).toHaveLength(1);
    const v1Snapshot = { ...versionsBefore[0] };

    // Version 2
    const v2Res = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Updated English privacy text v2.',
        acknowledgement_text_de: 'Aktualisierter deutscher Datenschutztext v2.',
        privacy_policy_url: 'https://example.com/privacy-v2',
      },
      testActor,
      db,
    );
    expect(v2Res.success).toBe(true);
    if (!v2Res.success) return;
    expect(v2Res.data.version).toBe(2);

    const formAfterV2 = await getForm(formId, db);
    expect(formAfterV2?.currentNoticeVersionId).toBe(v2Res.data.id);

    // Snapshot version 2
    const v2Snapshot = { ...v2Res.data };

    // Version 3
    const v3Res = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Updated English privacy text v3.',
        acknowledgement_text_de: 'Aktualisierter deutscher Datenschutztext v3.',
        privacy_policy_url: 'https://example.com/privacy-v3',
      },
      testActor,
      db,
    );
    expect(v3Res.success).toBe(true);
    if (!v3Res.success) return;
    expect(v3Res.data.version).toBe(3);

    const formAfterV3 = await getForm(formId, db);
    expect(formAfterV3?.currentNoticeVersionId).toBe(v3Res.data.id);

    // Verify all 3 versions exist and v1 + v2 are byte-for-byte identical
    const allVersions = await getNoticeVersions(formId, db);
    expect(allVersions).toHaveLength(3);

    const v1FromDb = allVersions[0];
    const v2FromDb = allVersions[1];
    const v3FromDb = allVersions[2];
    expect(v1FromDb).toEqual(v1Snapshot);
    expect(v2FromDb).toEqual(v2Snapshot);
    expect(v3FromDb?.version).toBe(3);

    // Two inquiry_form.notice_versioned audit events recorded
    const noticeEvents = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'inquiry_form.notice_versioned'))
      .orderBy(desc(auditEvents.occurredAt));

    expect(noticeEvents.length).toBeGreaterThanOrEqual(2);
    const latestEvents = noticeEvents.filter((e) => e.metadata?.form_id === formId);
    expect(latestEvents).toHaveLength(2);
    const event0 = latestEvents[0];
    const event1 = latestEvents[1];
    expect(event0).toBeDefined();
    expect(event1).toBeDefined();
    expect(event0?.metadata?.version).toBe(3);
    expect(event1?.metadata?.version).toBe(2);
  });

  it('AC-5: repo does not expose update or delete functions for notice versions, and direct SQL DELETE fails due to FK restriction', async () => {
    // 1. Exported-API check: verify repo exports no update or delete functions for notice versions
    const repoExports = Object.keys(repo);
    const forbiddenNoticeMutations = repoExports.filter(
      (name) =>
        /delete.*notice/i.test(name) ||
        /update.*notice/i.test(name) ||
        /remove.*notice/i.test(name),
    );
    expect(
      forbiddenNoticeMutations,
      'Repository must not export functions that mutate or delete notice versions',
    ).toEqual([]);

    // 2. Direct SQL DELETE of notice version referenced by form must fail FK restriction
    const created = await createForm({ name: 'FK Restrict Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const form = created.data;
    const noticeVersionId = form.currentNoticeVersionId;
    expect(noticeVersionId).not.toBeNull();
    if (!noticeVersionId) return;

    // Direct SQL DELETE must fail with FK violation
    await expect(
      testDb.client.exec(
        `DELETE FROM inquiry_form_notice_versions WHERE id = '${noticeVersionId}'`,
      ),
    ).rejects.toThrow();
  });

  it('AC-6: createNoticeVersion rejects notice text containing <script> or invalid privacy_policy_url with VALIDATION_FAILED', async () => {
    const created = await createForm({ name: 'AC-6 Validation Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // HTML tag in notice text
    const res1 = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Accept <script>alert(1)</script>',
        acknowledgement_text_de: 'Akzeptieren',
        privacy_policy_url: 'https://example.com/privacy',
      },
      testActor,
      db,
    );
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.code).toBe('VALIDATION_FAILED');
      expect(res1.error).toContain('plain text');
    }

    // http:// URL
    const res2 = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Valid English text',
        acknowledgement_text_de: 'Gültiger deutscher Text',
        privacy_policy_url: 'http://insecure.example.com/privacy',
      },
      testActor,
      db,
    );
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.code).toBe('VALIDATION_FAILED');
      expect(res2.error).toContain('https://');
    }

    // javascript: URL
    const res3 = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Valid English text',
        acknowledgement_text_de: 'Gültiger deutscher Text',
        privacy_policy_url: 'javascript:alert(1)',
      },
      testActor,
      db,
    );
    expect(res3.success).toBe(false);
    if (!res3.success) {
      expect(res3.code).toBe('VALIDATION_FAILED');
      expect(res3.error).toContain('https://');
    }
  });

  it('AC-7: publishForm requires complete notice version with HTTPS privacy policy URL, otherwise fails with PUBLISH_PRECONDITION_FAILED', async () => {
    // 1. Initial form has empty privacy_policy_url in version 1
    const created = await createForm({ name: 'Publish Precondition Form' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // Attempting to publish without privacy policy URL fails
    const failPublish = await publishForm(formId, testActor, db);
    expect(failPublish.success).toBe(false);
    if (!failPublish.success) {
      expect(failPublish.code).toBe('PUBLISH_PRECONDITION_FAILED');
    }

    // 2. Add complete notice version with valid HTTPS URL
    const newNotice = await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'I have read and acknowledge the privacy policy.',
        acknowledgement_text_de: 'Ich habe die Datenschutzerklärung zur Kenntnis genommen.',
        privacy_policy_url: 'https://studio.example.com/privacy',
      },
      testActor,
      db,
    );
    expect(newNotice.success).toBe(true);

    // 3. Now publishForm succeeds
    const publishRes = await publishForm(formId, testActor, db);
    expect(publishRes.success).toBe(true);
    if (!publishRes.success) return;
    expect(publishRes.data.status).toBe('published');

    // Emits inquiry_form.published audit event
    const pubEvents = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'inquiry_form.published'));
    expect(pubEvents.length).toBeGreaterThanOrEqual(1);

    // Unpublish
    const unpublishRes = await unpublishForm(formId, testActor, db);
    expect(unpublishRes.success).toBe(true);
    if (!unpublishRes.success) return;
    expect(unpublishRes.data.status).toBe('draft');

    // Archive
    const archiveRes = await archiveForm(formId, testActor, db);
    expect(archiveRes.success).toBe(true);
    if (!archiveRes.success) return;
    expect(archiveRes.data.status).toBe('archived');
  });

  it('AC-8: getPublishedFormBySlug returns only published forms and returns null for draft, archived, and unknown slugs alike', async () => {
    // Create draft form
    const draftRes = await createForm({ name: 'Draft Form' }, testActor, db);
    expect(draftRes.success).toBe(true);
    if (!draftRes.success) return;

    // Create published form
    const pubRes = await createForm(
      {
        name: 'Published Form',
        privacy_policy_url: 'https://example.com/privacy',
      },
      testActor,
      db,
    );
    expect(pubRes.success).toBe(true);
    if (!pubRes.success) return;

    const publishedForm = await publishForm(pubRes.data.id, testActor, db);
    expect(publishedForm.success).toBe(true);

    // Create archived form
    const archRes = await createForm({ name: 'Archived Form' }, testActor, db);
    expect(archRes.success).toBe(true);
    if (!archRes.success) return;
    await archiveForm(archRes.data.id, testActor, db);

    // 1. Published slug -> returns form
    const retrievedPub = await getPublishedFormBySlug(pubRes.data.slug, db);
    expect(retrievedPub).not.toBeNull();
    expect(retrievedPub?.id).toBe(pubRes.data.id);
    expect(retrievedPub?.status).toBe('published');

    // 2. Draft slug -> returns null
    const retrievedDraft = await getPublishedFormBySlug(draftRes.data.slug, db);
    expect(retrievedDraft).toBeNull();

    // 3. Archived slug -> returns null
    const retrievedArch = await getPublishedFormBySlug(archRes.data.slug, db);
    expect(retrievedArch).toBeNull();

    // 4. Random unknown slug -> returns null
    const retrievedUnknown = await getPublishedFormBySlug('unknown123', db);
    expect(retrievedUnknown).toBeNull();
  });

  it('AC-10: every audit event emitted by the service matches allowlist metadata keys, and contains zero form names or notice texts', async () => {
    // Perform full lifecycle
    const created = await createForm(
      {
        name: 'Audit Secret Form Name',
        privacy_policy_url: 'https://example.com/privacy',
      },
      testActor,
      db,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    await updateForm(formId, { name: 'New Secret Name' }, testActor, db);
    await createNoticeVersion(
      formId,
      {
        acknowledgement_text_en: 'Sensitive Notice Text EN',
        acknowledgement_text_de: 'Sensitive Notice Text DE',
        privacy_policy_url: 'https://example.com/privacy-v2',
      },
      testActor,
      db,
    );
    await publishForm(formId, testActor, db);
    await unpublishForm(formId, testActor, db);
    await archiveForm(formId, testActor, db);

    // Query all inquiry_form.* audit events
    const allAuditEvents = await db.select().from(auditEvents);
    const formEvents = allAuditEvents.filter((e) => e.action.startsWith('inquiry_form.'));

    expect(formEvents.length).toBeGreaterThanOrEqual(6);

    for (const event of formEvents) {
      // Validate metadata against allowlist sanitizer without error
      const metadata = event.metadata;
      expect(metadata).not.toBeNull();

      expect(() => {
        validateAndSanitizeMetadata(event.action, event.actorType, metadata);
      }).not.toThrow();

      // Check metadata keys strictly
      if (event.action === 'inquiry_form.notice_versioned') {
        expect(Object.keys(metadata ?? {}).sort()).toEqual(['form_id', 'version']);
      } else {
        expect(Object.keys(metadata ?? {}).sort()).toEqual(['changed_fields', 'form_id']);
      }

      // Check zero PII or studio text in metadata string serialization
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain('Audit Secret Form Name');
      expect(serialized).not.toContain('New Secret Name');
      expect(serialized).not.toContain('Sensitive Notice Text EN');
      expect(serialized).not.toContain('Sensitive Notice Text DE');
      expect(serialized).not.toContain('https://example.com');
    }
  });

  it('listForms, getForm, and repo.getFormBySlug return expected records and handle missing forms', async () => {
    const listEmpty = await listForms(db);
    expect(listEmpty).toEqual([]);

    const created1 = await createForm({ name: 'Form 1' }, testActor, db);
    const created2 = await createForm({ name: 'Form 2' }, testActor, db);
    expect(created1.success && created2.success).toBe(true);
    if (!created1.success || !created2.success) return;

    const listTwo = await listForms(db);
    expect(listTwo.length).toBe(2);

    const bySlug = await repo.getFormBySlug(created1.data.slug, db);
    expect(bySlug).not.toBeNull();
    expect(bySlug?.id).toBe(created1.data.id);

    const nonExistentSlug = await repo.getFormBySlug('nonexistent', db);
    expect(nonExistentSlug).toBeNull();

    const nonExistentForm = await getForm('00000000-0000-0000-0000-000000000000', db);
    expect(nonExistentForm).toBeNull();
  });

  it('covers service validation failures and actor resolution', async () => {
    // String actor input
    const formWithStrActor = await createForm(
      { name: 'String Actor Form' },
      '018f0000-0000-7000-8000-000000000001',
      db,
    );
    expect(formWithStrActor.success).toBe(true);

    // Actor object without actorType
    const formWithNoTypeActor = await createForm(
      { name: 'Default Type Actor Form' },
      { actorId: '018f0000-0000-7000-8000-000000000001' },
      db,
    );
    expect(formWithNoTypeActor.success).toBe(true);

    // createForm: empty name
    const resEmptyName = await createForm({ name: '   ' }, testActor, db);
    expect(resEmptyName.success).toBe(false);

    // createForm: name > 100
    const resLongName = await createForm({ name: 'a'.repeat(101) }, testActor, db);
    expect(resLongName.success).toBe(false);

    // createForm: invalid default_locale
    const resBadLocale = await createForm(
      { name: 'Bad Locale', default_locale: 'fr' },
      testActor,
      db,
    );
    expect(resBadLocale.success).toBe(false);

    // createForm: valid default_locale 'de'
    const resDeLocale = await createForm({ name: 'De Form', default_locale: 'de' }, testActor, db);
    expect(resDeLocale.success).toBe(true);
    if (resDeLocale.success) {
      expect(resDeLocale.data.defaultLocale).toBe('de');
    }

    // createForm: invalid fields
    const resBadFields = await createForm({ name: 'Bad Fields', fields: [] }, testActor, db);
    expect(resBadFields.success).toBe(false);

    // createForm: event_type enabled but event_types empty
    const resMissingEvents = await createForm(
      {
        name: 'Missing Events',
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
          { key: 'event_type', enabled: true, required: false, order: 2 },
        ],
      },
      testActor,
      db,
    );
    expect(resMissingEvents.success).toBe(false);

    // createForm: invalid success_redirect_url
    const resBadRedirect = await createForm(
      { name: 'Bad Redirect', success_redirect_url: 'http://insecure.example.com' },
      testActor,
      db,
    );
    expect(resBadRedirect.success).toBe(false);

    // createForm: non-https privacy_policy_url (fallback to empty)
    const resBadPolicy = await createForm(
      { name: 'Insecure Policy', privacy_policy_url: 'http://insecure.example.com' },
      testActor,
      db,
    );
    expect(resBadPolicy.success).toBe(true);

    // createForm: valid success_redirect_url and explicit flags
    const resGoodRedirect = await createForm(
      {
        name: 'Good Redirect',
        auto_reply_enabled: false,
        accept_unverified: true,
        success_redirect_url: 'https://example.com/thanks',
      },
      testActor,
      db,
    );
    expect(resGoodRedirect.success).toBe(true);
    if (resGoodRedirect.success) {
      expect(resGoodRedirect.data.autoReplyEnabled).toBe(false);
      expect(resGoodRedirect.data.acceptUnverified).toBe(true);
      expect(resGoodRedirect.data.successRedirectUrl).toBe('https://example.com/thanks');
    }
  });

  it('covers updateForm branch conditions and edge cases', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    // Form not found
    const notFoundRes = await updateForm(nonExistentId, { name: 'New' }, testActor, db);
    expect(notFoundRes.success).toBe(false);
    if (!notFoundRes.success) expect(notFoundRes.code).toBe('NOT_FOUND');

    // Create form to update
    const created = await createForm({ name: 'Update Target' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // Invalid name (empty / too long)
    const badName1 = await updateForm(formId, { name: '  ' }, testActor, db);
    expect(badName1.success).toBe(false);
    const badName2 = await updateForm(formId, { name: 'b'.repeat(101) }, testActor, db);
    expect(badName2.success).toBe(false);

    // Invalid locale
    const badLocale = await updateForm(formId, { default_locale: 'es' }, testActor, db);
    expect(badLocale.success).toBe(false);

    // Valid locale update to 'de'
    const goodLocale = await updateForm(formId, { default_locale: 'de' }, testActor, db);
    expect(goodLocale.success).toBe(true);

    // Invalid fields update
    const badFields = await updateForm(formId, { fields: [] }, testActor, db);
    expect(badFields.success).toBe(false);

    // Invalid event types update
    const badEvents = await updateForm(
      formId,
      { event_types: [{ key: 'Invalid Key!', label_en: 'A', label_de: 'B' }] },
      testActor,
      db,
    );
    expect(badEvents.success).toBe(false);

    // Enable event_type field without providing event_types when existing is empty
    const enableWithoutTypes = await updateForm(
      formId,
      {
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
          { key: 'event_type', enabled: true, required: false, order: 2 },
        ],
      },
      testActor,
      db,
    );
    expect(enableWithoutTypes.success).toBe(false);

    // Update autoReplyEnabled, acceptUnverified, and successRedirectUrl
    const updateFlags = await updateForm(
      formId,
      {
        auto_reply_enabled: false,
        accept_unverified: true,
        success_redirect_url: 'https://example.com/custom-thanks',
      },
      testActor,
      db,
    );
    expect(updateFlags.success).toBe(true);
    if (updateFlags.success) {
      expect(updateFlags.data.autoReplyEnabled).toBe(false);
      expect(updateFlags.data.acceptUnverified).toBe(true);
      expect(updateFlags.data.successRedirectUrl).toBe('https://example.com/custom-thanks');
    }

    // Invalid success redirect URL
    const badRedirect = await updateForm(
      formId,
      { success_redirect_url: 'invalid-url' },
      testActor,
      db,
    );
    expect(badRedirect.success).toBe(false);

    // Reset success redirect URL to null
    const clearRedirect = await updateForm(formId, { success_redirect_url: null }, testActor, db);
    expect(clearRedirect.success).toBe(true);
    if (clearRedirect.success) {
      expect(clearRedirect.data.successRedirectUrl).toBeNull();
    }

    // Update with exact same values (tests branches where fields match existing values)
    const sameValues = await updateForm(
      formId,
      {
        name: created.data.name,
        default_locale: 'de',
        auto_reply_enabled: false,
        accept_unverified: true,
        success_redirect_url: null,
      },
      testActor,
      db,
    );
    expect(sameValues.success).toBe(true);

    // Update fields to enable event_type when event_types were already provided
    await updateForm(
      formId,
      {
        event_types: [{ key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' }],
      },
      testActor,
      db,
    );
    const enableWithExistingTypes = await updateForm(
      formId,
      {
        fields: [
          { key: 'given_name', enabled: true, required: true, order: 0 },
          { key: 'email', enabled: true, required: true, order: 1 },
          { key: 'event_type', enabled: true, required: false, order: 2 },
        ],
      },
      testActor,
      db,
    );
    expect(enableWithExistingTypes.success).toBe(true);

    // No changed fields returns existing form without DB update
    const noChange = await updateForm(formId, {}, testActor, db);
    expect(noChange.success).toBe(true);
  });

  it('covers createNoticeVersion, publishForm, unpublishForm, and archiveForm error branches', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    // createNoticeVersion: form not found
    const noticeNotFound = await createNoticeVersion(
      nonExistentId,
      { privacy_policy_url: 'https://example.com' },
      testActor,
      db,
    );
    expect(noticeNotFound.success).toBe(false);
    if (!noticeNotFound.success) expect(noticeNotFound.code).toBe('NOT_FOUND');

    // unpublishForm: form not found
    const unpubNotFound = await unpublishForm(nonExistentId, testActor, db);
    expect(unpubNotFound.success).toBe(false);
    if (!unpubNotFound.success) expect(unpubNotFound.code).toBe('NOT_FOUND');

    // archiveForm: form not found
    const archNotFound = await archiveForm(nonExistentId, testActor, db);
    expect(archNotFound.success).toBe(false);
    if (!archNotFound.success) expect(archNotFound.code).toBe('NOT_FOUND');

    // publishForm: form not found
    const pubNotFound = await publishForm(nonExistentId, testActor, db);
    expect(pubNotFound.success).toBe(false);
    if (!pubNotFound.success) expect(pubNotFound.code).toBe('NOT_FOUND');

    // publishForm: form with missing current notice version
    const created = await createForm({ name: 'Test Form For Notice Checks' }, testActor, db);
    expect(created.success).toBe(true);
    if (!created.success) return;
    const formId = created.data.id;

    // Simulate form with no notice version id
    await repo.updateFormRecord(formId, { currentNoticeVersionId: null }, db);
    const pubNoNotice = await publishForm(formId, testActor, db);
    expect(pubNoNotice.success).toBe(false);
    if (!pubNoNotice.success) expect(pubNoNotice.code).toBe('PUBLISH_PRECONDITION_FAILED');

    // Restore notice version with empty text
    const badNotice = await repo.insertNoticeVersionRecord(
      {
        formId,
        version: 99,
        acknowledgementTextEn: '   ',
        acknowledgementTextDe: 'Gültig',
        privacyPolicyUrl: 'https://example.com/privacy',
        createdByActorId: '018f0000-0000-7000-8000-000000000001',
      },
      db,
    );
    await repo.updateFormRecord(formId, { currentNoticeVersionId: badNotice.id }, db);

    const pubEmptyEn = await publishForm(formId, testActor, db);
    expect(pubEmptyEn.success).toBe(false);
    if (!pubEmptyEn.success) {
      expect(pubEmptyEn.code).toBe('PUBLISH_PRECONDITION_FAILED');
      expect(pubEmptyEn.error).toContain('English');
    }

    const badNoticeDe = await repo.insertNoticeVersionRecord(
      {
        formId,
        version: 100,
        acknowledgementTextEn: 'Valid text',
        acknowledgementTextDe: '   ',
        privacyPolicyUrl: 'https://example.com/privacy',
        createdByActorId: '018f0000-0000-7000-8000-000000000001',
      },
      db,
    );
    await repo.updateFormRecord(formId, { currentNoticeVersionId: badNoticeDe.id }, db);

    const pubEmptyDe = await publishForm(formId, testActor, db);
    expect(pubEmptyDe.success).toBe(false);
    if (!pubEmptyDe.success) {
      expect(pubEmptyDe.code).toBe('PUBLISH_PRECONDITION_FAILED');
      expect(pubEmptyDe.error).toContain('German');
    }
  });
});

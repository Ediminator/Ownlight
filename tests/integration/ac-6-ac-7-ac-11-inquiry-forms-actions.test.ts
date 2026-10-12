import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';

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
import {
  createInquiryFormAction,
  updateInquiryFormAction,
  createNoticeVersionAction,
  publishInquiryFormAction,
  unpublishInquiryFormAction,
  archiveInquiryFormAction,
} from '@/server/inquiry-forms/actions';
import { getForm, listForms, getNoticeVersions } from '@/server/inquiry-forms/service';
import { user } from '@/server/db/schema/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { createApiKey } from '@/server/auth/api-keys';
import { PUBLIC_AUTH_ACTIONS } from '@/server/auth/public-actions';
import { scanServerActions } from '../helpers/server-action-scanner';
import type { DbClient } from '@/server/db/client';

describe('TASK-0025: Server Actions Auth, Strict Schema Validation, and AST Scanner (AC-6, AC-7, AC-11)', () => {
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

    // 1. Seed studio owner user
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

    // 2. Active owner web session
    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  describe('AC-6: Unauthenticated and API-Key Bearer Rejection', () => {
    it('AC-6: rejects all 6 actions when unauthenticated (no session) and alters no data', async () => {
      // Create a fixture form first while authenticated
      const created = await createInquiryFormAction({ name: 'Fixture Form' }, dbClient);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const formId = created.data.id;

      // Clear session -> unauthenticated
      mockCookiesStore.clear();

      // 1. createInquiryFormAction
      const resCreate = await createInquiryFormAction({ name: 'Unauthorized Form' }, dbClient);
      expect(resCreate.success).toBe(false);
      if (!resCreate.success) {
        expect(resCreate.code).toBe('UNAUTHORIZED');
        expect(resCreate.error).toBe('UNAUTHORIZED');
      }

      // 2. updateInquiryFormAction
      const resUpdate = await updateInquiryFormAction(
        { id: formId, name: 'Renamed Unauthorized' },
        dbClient,
      );
      expect(resUpdate.success).toBe(false);
      if (!resUpdate.success) {
        expect(resUpdate.code).toBe('UNAUTHORIZED');
      }

      // 3. createNoticeVersionAction
      const resVersion = await createNoticeVersionAction(
        {
          formId,
          privacy_policy_url: 'https://example.org/privacy-unauth',
          acknowledgement_text_en: 'Test',
          acknowledgement_text_de: 'Test',
        },
        dbClient,
      );
      expect(resVersion.success).toBe(false);
      if (!resVersion.success) {
        expect(resVersion.code).toBe('UNAUTHORIZED');
      }

      // 4. publishInquiryFormAction
      const resPublish = await publishInquiryFormAction({ id: formId }, dbClient);
      expect(resPublish.success).toBe(false);
      if (!resPublish.success) {
        expect(resPublish.code).toBe('UNAUTHORIZED');
      }

      // 5. unpublishInquiryFormAction
      const resUnpublish = await unpublishInquiryFormAction({ id: formId }, dbClient);
      expect(resUnpublish.success).toBe(false);
      if (!resUnpublish.success) {
        expect(resUnpublish.code).toBe('UNAUTHORIZED');
      }

      // 6. archiveInquiryFormAction
      const resArchive = await archiveInquiryFormAction({ id: formId }, dbClient);
      expect(resArchive.success).toBe(false);
      if (!resArchive.success) {
        expect(resArchive.code).toBe('UNAUTHORIZED');
      }

      // Assert data is completely unchanged in DB
      const forms = await listForms(dbClient);
      expect(forms).toHaveLength(1);
      expect(forms[0]?.name).toBe('Fixture Form');
      expect(forms[0]?.status).toBe('draft');
      const versions = await getNoticeVersions(formId, dbClient);
      expect(versions).toHaveLength(1);
    });

    it('AC-6: rejects all 6 actions when bearer token / API key is present (even with active session) returning FORBIDDEN', async () => {
      // Create a fixture form first
      const created = await createInquiryFormAction({ name: 'Fixture Form' }, dbClient);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const formId = created.data.id;

      // Generate API key with admin scope
      const apiKeyResult = await createApiKey({
        userId: ownerUser.id,
        name: 'Admin API Key',
        scopes: ['*'],
        client: dbClient,
      });

      // Supply Bearer token in headers
      mockHeadersStore.set('authorization', `Bearer ${apiKeyResult.apiKey}`);

      // 1. createInquiryFormAction
      const resCreate = await createInquiryFormAction({ name: 'API Key Form' }, dbClient);
      expect(resCreate.success).toBe(false);
      if (!resCreate.success) {
        expect(resCreate.code).toBe('FORBIDDEN');
        expect(resCreate.error).toBe('FORBIDDEN');
      }

      // 2. updateInquiryFormAction
      const resUpdate = await updateInquiryFormAction(
        { id: formId, name: 'Renamed API Key' },
        dbClient,
      );
      expect(resUpdate.success).toBe(false);
      if (!resUpdate.success) {
        expect(resUpdate.code).toBe('FORBIDDEN');
      }

      // 3. createNoticeVersionAction
      const resVersion = await createNoticeVersionAction(
        {
          formId,
          privacy_policy_url: 'https://example.org/privacy-apikey',
          acknowledgement_text_en: 'Test',
          acknowledgement_text_de: 'Test',
        },
        dbClient,
      );
      expect(resVersion.success).toBe(false);
      if (!resVersion.success) {
        expect(resVersion.code).toBe('FORBIDDEN');
      }

      // 4. publishInquiryFormAction
      const resPublish = await publishInquiryFormAction({ id: formId }, dbClient);
      expect(resPublish.success).toBe(false);
      if (!resPublish.success) {
        expect(resPublish.code).toBe('FORBIDDEN');
      }

      // 5. unpublishInquiryFormAction
      const resUnpublish = await unpublishInquiryFormAction({ id: formId }, dbClient);
      expect(resUnpublish.success).toBe(false);
      if (!resUnpublish.success) {
        expect(resUnpublish.code).toBe('FORBIDDEN');
      }

      // 6. archiveInquiryFormAction
      const resArchive = await archiveInquiryFormAction({ id: formId }, dbClient);
      expect(resArchive.success).toBe(false);
      if (!resArchive.success) {
        expect(resArchive.code).toBe('FORBIDDEN');
      }

      // Assert data is completely unchanged in DB
      const forms = await listForms(dbClient);
      expect(forms).toHaveLength(1);
      expect(forms[0]?.name).toBe('Fixture Form');
      expect(forms[0]?.status).toBe('draft');
      const versions = await getNoticeVersions(formId, dbClient);
      expect(versions).toHaveLength(1);
    });
  });

  describe('AC-7: Strict Zod Schema Extra-Key Rejection', () => {
    it('AC-7: rejects updateInquiryFormAction crafted input with extra key (status: "published") without changing status', async () => {
      const created = await createInquiryFormAction({ name: 'Draft Form' }, dbClient);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const formId = created.data.id;

      // Attempt privilege escalation or mass assignment by passing status: "published"
      const res = await updateInquiryFormAction(
        {
          id: formId,
          name: 'Updated Name',
          status: 'published',
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }

      // Verify form status remains 'draft' and name unchanged in DB
      const loaded = await getForm(formId, dbClient);
      expect(loaded?.status).toBe('draft');
      expect(loaded?.name).toBe('Draft Form');
    });

    it('AC-7: rejects createInquiryFormAction with extra keys', async () => {
      const res = await createInquiryFormAction(
        {
          name: 'Malicious Form',
          status: 'published',
          slug: 'customslug',
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }

      const forms = await listForms(dbClient);
      expect(forms).toHaveLength(0);
    });

    it('AC-7: rejects createNoticeVersionAction with extra keys', async () => {
      const created = await createInquiryFormAction({ name: 'Notice Form' }, dbClient);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const formId = created.data.id;

      const res = await createNoticeVersionAction(
        {
          formId,
          privacy_policy_url: 'https://example.org/privacy',
          acknowledgement_text_en: 'Ack EN',
          acknowledgement_text_de: 'Ack DE',
          version: 99, // Should be rejected by strict schema
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }

      const versions = await getNoticeVersions(formId, dbClient);
      expect(versions).toHaveLength(1);
    });

    it('AC-7: rejects publish, unpublish, and archive actions with extra keys', async () => {
      const created = await createInquiryFormAction({ name: 'Action Form' }, dbClient);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const formId = created.data.id;

      const resPub = await publishInquiryFormAction({ id: formId, force: true }, dbClient);
      expect(resPub.success).toBe(false);
      if (!resPub.success) expect(resPub.code).toBe('VALIDATION_FAILED');

      const resUnpub = await unpublishInquiryFormAction({ id: formId, extra: 'foo' }, dbClient);
      expect(resUnpub.success).toBe(false);
      if (!resUnpub.success) expect(resUnpub.code).toBe('VALIDATION_FAILED');

      const resArch = await archiveInquiryFormAction({ id: formId, cascade: true }, dbClient);
      expect(resArch.success).toBe(false);
      if (!resArch.success) expect(resArch.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('AC-11: Server Action AST Scanner Compliance', () => {
    it('AC-11: all 6 inquiry form actions are detected as owner-protected and none appears in PUBLIC_AUTH_ACTIONS', () => {
      const rootDir = path.resolve(process.cwd(), 'src');
      const publicActionsFile = path.resolve(process.cwd(), 'src/server/auth/public-actions.ts');

      const scanResult = scanServerActions({
        rootDir,
        allowlist: PUBLIC_AUTH_ACTIONS,
        publicActionsFile,
        checkAllowlistComments: true,
      });

      // 1. inquiry-forms/actions.ts is discovered
      const normalizedFiles = scanResult.discoveredFiles.map((f) => f.replace(/\\/g, '/'));
      expect(normalizedFiles).toContain('server/inquiry-forms/actions.ts');

      // 2. All 6 actions are exported
      const expectedActions = [
        'createInquiryFormAction',
        'updateInquiryFormAction',
        'createNoticeVersionAction',
        'publishInquiryFormAction',
        'unpublishInquiryFormAction',
        'archiveInquiryFormAction',
      ];
      for (const action of expectedActions) {
        expect(scanResult.exportedActions).toContain(action);
      }

      // 3. None appears in PUBLIC_AUTH_ACTIONS
      for (const action of expectedActions) {
        expect(PUBLIC_AUTH_ACTIONS).not.toContain(action);
      }

      // 4. Zero violations for server/inquiry-forms/actions.ts
      const actionViolations = scanResult.violations.filter((v) =>
        v.file.replace(/\\/g, '/').includes('server/inquiry-forms/actions.ts'),
      );
      expect(actionViolations).toEqual([]);

      // 5. Zero violations repository-wide
      expect(scanResult.violations).toEqual([]);
    });
  });
});

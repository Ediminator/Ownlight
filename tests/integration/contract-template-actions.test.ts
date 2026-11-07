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
import type { DbClient } from '@/server/db/client';
import { user } from '@/server/db/schema/auth';
import { contractTemplates } from '@/server/db/schema/contracts';
import { studioSettings } from '@/server/db/schema/studio-settings';
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import {
  createContractTemplateAction,
  updateContractTemplateAction,
  archiveContractTemplateAction,
  updateStudioSigningSettingsAction,
  getStudioSigningSettingsAction,
  listContractTemplatesAction,
} from '@/server/contracts/actions';
import * as templateRepo from '@/server/contracts/template-repo';
import * as studioSigning from '@/server/studio/signing-settings';

describe('TASK-0065: Contract Template & Studio Signing Server Actions Integration Tests', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    // Create Owner User
    const [createdOwner] = await dbClient
      .insert(user)
      .values({
        name: 'Elena Rostova',
        email: 'elena@example.org',
        emailVerified: true,
        role: 'owner',
      })
      .returning();

    if (!createdOwner) {
      throw new Error('Failed to create test owner user');
    }
    ownerUser = createdOwner;

    // Create Authenticated Session
    const sessionResult = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionResult.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);

    // Initialize default studio settings
    const [existingSettings] = await dbClient.select().from(studioSettings).limit(1);
    if (!existingSettings) {
      await dbClient.insert(studioSettings).values({
        studio_name: 'Elena Rostova Photography',
        default_locale: 'en',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        contract_signatory_name: 'Elena Rostova',
        contract_signatory_title: 'Lead Photographer & Studio Owner',
        contract_countersignature_mode: 'pre_signed',
        studio_address_line1: 'Kastanienallee 71',
        studio_postal_code: '10435',
        studio_city: 'Berlin',
        studio_country_code: 'DE',
      });
    }
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  describe('Unauthenticated and Abuse Cases (AC-7)', () => {
    it('AC-7: Rejects unauthenticated createContractTemplateAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await createContractTemplateAction(
        {
          name: 'Hacker Template',
          slug: 'hacker-template',
          contentEn: 'test',
          contentDe: 'test',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects unauthenticated updateContractTemplateAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await updateContractTemplateAction(
        {
          id: '01920000-0000-7000-8000-000000000001',
          name: 'New Name',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects unauthenticated archiveContractTemplateAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await archiveContractTemplateAction(
        {
          id: '01920000-0000-7000-8000-000000000001',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects unauthenticated updateStudioSigningSettingsAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await updateStudioSigningSettingsAction(
        {
          contractSignatoryName: 'Intruder',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects unauthenticated getStudioSigningSettingsAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await getStudioSigningSettingsAction(dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects unauthenticated listContractTemplatesAction invocation', async () => {
      mockCookiesStore.clear();
      const res = await listContractTemplatesAction({}, dbClient);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('UNAUTHENTICATED');
      }
    });

    it('AC-7: Rejects non-owner user with FORBIDDEN across all actions', async () => {
      const [nonOwner] = await dbClient
        .insert(user)
        .values({
          name: 'Regular Client',
          email: 'client@example.org',
          emailVerified: true,
          role: 'client',
        })
        .returning();

      if (!nonOwner) throw new Error('Failed to create non-owner user');
      const clientSession = await createSession(nonOwner.id, dbClient);
      mockCookiesStore.set(SESSION_COOKIE_NAME, clientSession.token);

      const createRes = await createContractTemplateAction(
        {
          name: 'Unauthorized Template',
          slug: 'unauthorized-template',
          contentEn: 'test',
          contentDe: 'test',
        },
        dbClient,
      );
      expect(createRes.success).toBe(false);
      if (!createRes.success) {
        expect(createRes.code).toBe('FORBIDDEN');
      }

      const updateRes = await updateContractTemplateAction(
        { id: '01920000-0000-7000-8000-000000000001', name: 'Unauthorized' },
        dbClient,
      );
      expect(updateRes.success).toBe(false);
      if (!updateRes.success) {
        expect(updateRes.code).toBe('FORBIDDEN');
      }

      const archiveRes = await archiveContractTemplateAction(
        { id: '01920000-0000-7000-8000-000000000001' },
        dbClient,
      );
      expect(archiveRes.success).toBe(false);
      if (!archiveRes.success) {
        expect(archiveRes.code).toBe('FORBIDDEN');
      }

      const updateSettingsRes = await updateStudioSigningSettingsAction(
        { contractSignatoryName: 'Intruder' },
        dbClient,
      );
      expect(updateSettingsRes.success).toBe(false);
      if (!updateSettingsRes.success) {
        expect(updateSettingsRes.code).toBe('FORBIDDEN');
      }

      const getSettingsRes = await getStudioSigningSettingsAction(dbClient);
      expect(getSettingsRes.success).toBe(false);
      if (!getSettingsRes.success) {
        expect(getSettingsRes.code).toBe('FORBIDDEN');
      }

      const listRes = await listContractTemplatesAction({}, dbClient);
      expect(listRes.success).toBe(false);
      if (!listRes.success) {
        expect(listRes.code).toBe('FORBIDDEN');
      }
    });

    it('AC-4: Rejects invalid schema input on createContractTemplateAction (empty name, invalid slug)', async () => {
      const res = await createContractTemplateAction(
        {
          name: '',
          slug: 'INVALID SLUG WITH SPACES',
          contentEn: '',
          contentDe: '',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
        expect(res.fields).toContain('name');
        expect(res.fields).toContain('slug');
      }
    });

    it('AC-4: Rejects invalid schema input on updateContractTemplateAction (invalid uuid)', async () => {
      const res = await updateContractTemplateAction(
        {
          id: 'not-a-valid-uuid',
          name: 'Updated Name',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('AC-5: Rejects invalid schema input on archiveContractTemplateAction (invalid uuid)', async () => {
      const res = await archiveContractTemplateAction(
        {
          id: 'not-a-valid-uuid',
        },
        dbClient,
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('Contract Template Lifecycle (AC-1, AC-4, AC-5)', () => {
    it('AC-4: Creates a valid contract template, sets default, and logs audit event', async () => {
      const res = await createContractTemplateAction(
        {
          name: 'Full Day Wedding Agreement',
          slug: 'wedding-full-day',
          description: 'Comprehensive agreement for full day coverage.',
          projectTypeKey: 'wedding',
          contentEn: 'Agreement between {{studio.name}} and {{client.name}}',
          contentDe: 'Vertrag zwischen {{studio.name}} und {{client.name}}',
          isDefault: true,
          isActive: true,
        },
        dbClient,
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBeDefined();
        expect(res.data.name).toBe('Full Day Wedding Agreement');
        expect(res.data.slug).toBe('wedding-full-day');
        expect(res.data.isDefault).toBe(true);
        expect(res.data.projectTypeKey).toBe('wedding');
      }

      // Check audit event
      const [auditEvent] = await dbClient
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'contract_template.created'))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(1);

      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actorId).toBe(ownerUser.id);
      expect(auditEvent?.targetId).toBe(res.success ? res.data.id : '');
    });

    it('AC-4: Updates an existing contract template', async () => {
      const createdRes = await createContractTemplateAction(
        {
          name: 'Portrait Session Contract',
          slug: 'portrait-session',
          contentEn: 'Standard portrait clauses',
          contentDe: 'Standard Portraet Klauseln',
          isDefault: false,
        },
        dbClient,
      );
      expect(createdRes.success).toBe(true);
      if (!createdRes.success) return;

      const templateId = createdRes.data.id;

      const updateRes = await updateContractTemplateAction(
        {
          id: templateId,
          name: 'Deluxe Portrait Agreement',
          description: 'Updated portrait contract description',
          contentEn: 'Updated English portrait clauses',
        },
        dbClient,
      );

      expect(updateRes.success).toBe(true);
      if (updateRes.success) {
        expect(updateRes.data.name).toBe('Deluxe Portrait Agreement');
        expect(updateRes.data.description).toBe('Updated portrait contract description');
        expect(updateRes.data.contentEn).toBe('Updated English portrait clauses');
        expect(updateRes.data.contentDe).toBe('Standard Portraet Klauseln');
      }
    });

    it('AC-5: Soft deletes (archives) and restores a contract template', async () => {
      const createdRes = await createContractTemplateAction(
        {
          name: 'Commercial Agreement',
          slug: 'commercial-agreement',
          contentEn: 'Commercial clauses',
          contentDe: 'Kommerzielle Klauseln',
          isActive: true,
        },
        dbClient,
      );
      expect(createdRes.success).toBe(true);
      if (!createdRes.success) return;

      const templateId = createdRes.data.id;

      // Archive template
      const archiveRes = await archiveContractTemplateAction(
        {
          id: templateId,
          isActive: false,
        },
        dbClient,
      );
      expect(archiveRes.success).toBe(true);
      if (archiveRes.success) {
        expect(archiveRes.data.isActive).toBe(false);
      }

      // Check in DB
      const [inDb] = await dbClient
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.id, templateId));
      expect(inDb?.isActive).toBe(false);

      // Restore template
      const restoreRes = await archiveContractTemplateAction(
        {
          id: templateId,
          isActive: true,
        },
        dbClient,
      );
      expect(restoreRes.success).toBe(true);
      if (restoreRes.success) {
        expect(restoreRes.data.isActive).toBe(true);
      }

      const [restoredInDb] = await dbClient
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.id, templateId));
      expect(restoredInDb?.isActive).toBe(true);
    });

    it('AC-1: listContractTemplatesAction returns active and archived templates', async () => {
      await createContractTemplateAction(
        {
          name: 'Active Template 1',
          slug: 'active-template-1',
          contentEn: 'content',
          contentDe: 'inhalt',
          isActive: true,
        },
        dbClient,
      );
      const toArchive = await createContractTemplateAction(
        {
          name: 'Archived Template 2',
          slug: 'archived-template-2',
          contentEn: 'content',
          contentDe: 'inhalt',
          isActive: true,
        },
        dbClient,
      );
      if (toArchive.success) {
        await archiveContractTemplateAction({ id: toArchive.data.id, isActive: false }, dbClient);
      }

      const allTemplates = await listContractTemplatesAction({}, dbClient);
      expect(allTemplates.success).toBe(true);
      if (allTemplates.success) {
        expect(allTemplates.data.length).toBeGreaterThanOrEqual(2);
        const hasActive = allTemplates.data.some(
          (t) => t.slug === 'active-template-1' && t.isActive,
        );
        const hasArchived = allTemplates.data.some(
          (t) => t.slug === 'archived-template-2' && !t.isActive,
        );
        expect(hasActive).toBe(true);
        expect(hasArchived).toBe(true);
      }
    });
  });

  describe('Studio Signing Configuration (AC-6)', () => {
    it('AC-6: Updates studio signatory legal name, title, countersignature mode, and studio physical address', async () => {
      const res = await updateStudioSigningSettingsAction(
        {
          contractSignatoryName: 'Elena Maria Rostova',
          contractSignatoryTitle: 'Owner, Principal Photographer',
          contractCountersignatureMode: 'explicit',
          studioAddressLine1: 'Torstraße 100',
          studioAddressLine2: 'Hinterhaus 2. OG',
          studioPostalCode: '10119',
          studioCity: 'Berlin',
          studioCountryCode: 'DE',
          studioPhone: '+49 30 11223344',
          studioEmail: 'contact@elena-rostova.example.com',
        },
        dbClient,
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.contract_signatory_name).toBe('Elena Maria Rostova');
        expect(res.data.contract_signatory_title).toBe('Owner, Principal Photographer');
        expect(res.data.contract_countersignature_mode).toBe('explicit');
        expect(res.data.studio_address_line1).toBe('Torstraße 100');
        expect(res.data.studio_address_line2).toBe('Hinterhaus 2. OG');
        expect(res.data.studio_postal_code).toBe('10119');
        expect(res.data.studio_city).toBe('Berlin');
        expect(res.data.studio_country_code).toBe('DE');
      }

      // Check settings retrieval
      const getRes = await getStudioSigningSettingsAction(dbClient);
      expect(getRes.success).toBe(true);
      if (getRes.success) {
        expect(getRes.data.contract_signatory_name).toBe('Elena Maria Rostova');
        expect(getRes.data.contract_countersignature_mode).toBe('explicit');
      }
    });

    it('AC-6: Rejects invalid studio country code or email', async () => {
      const res = await updateStudioSigningSettingsAction(
        {
          studioCountryCode: 'INVALID_LONG_CODE',
          studioEmail: 'not-an-email',
        },
        dbClient,
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe('VALIDATION_FAILED');
      }
    });

    it('handles unexpected database failures and returns INTERNAL_ERROR across all actions', async () => {
      // 1. createContractTemplate failure
      const createSpy = vi
        .spyOn(templateRepo, 'createContractTemplate')
        .mockRejectedValueOnce(new Error('Database write error'));

      const createRes = await createContractTemplateAction(
        {
          name: 'Fail Template',
          slug: 'fail-template',
          contentEn: 'content',
          contentDe: 'inhalt',
        },
        dbClient,
      );
      expect(createRes.success).toBe(false);
      if (!createRes.success) {
        expect(createRes.code).toBe('INTERNAL_ERROR');
      }
      createSpy.mockRestore();

      // 2. updateContractTemplate failure
      const updateSpy = vi
        .spyOn(templateRepo, 'updateContractTemplate')
        .mockRejectedValueOnce(new Error('Database update error'));

      const updateRes = await updateContractTemplateAction(
        {
          id: '01920000-0000-7000-8000-000000000001',
          name: 'Updated Name',
        },
        dbClient,
      );
      expect(updateRes.success).toBe(false);
      if (!updateRes.success) {
        expect(updateRes.code).toBe('INTERNAL_ERROR');
      }
      updateSpy.mockRestore();

      // 3. deleteContractTemplate failure (archive)
      const deleteSpy = vi
        .spyOn(templateRepo, 'deleteContractTemplate')
        .mockRejectedValueOnce(new Error('Database delete error'));

      const archiveRes = await archiveContractTemplateAction(
        {
          id: '01920000-0000-7000-8000-000000000001',
          isActive: false,
        },
        dbClient,
      );
      expect(archiveRes.success).toBe(false);
      if (!archiveRes.success) {
        expect(archiveRes.code).toBe('INTERNAL_ERROR');
      }
      deleteSpy.mockRestore();

      // 4. updateStudioSigningProfile failure
      const updateSigningSpy = vi
        .spyOn(studioSigning, 'updateStudioSigningProfile')
        .mockRejectedValueOnce(new Error('Database signing update error'));

      const updateSigningRes = await updateStudioSigningSettingsAction(
        {
          contractSignatoryName: 'Elena Rostova',
        },
        dbClient,
      );
      expect(updateSigningRes.success).toBe(false);
      if (!updateSigningRes.success) {
        expect(updateSigningRes.code).toBe('INTERNAL_ERROR');
      }
      updateSigningSpy.mockRestore();

      // 5. getStudioSigningProfile failure
      const getSigningSpy = vi
        .spyOn(studioSigning, 'getStudioSigningProfile')
        .mockRejectedValueOnce(new Error('Database signing read error'));

      const getSigningRes = await getStudioSigningSettingsAction(dbClient);
      expect(getSigningRes.success).toBe(false);
      if (!getSigningRes.success) {
        expect(getSigningRes.code).toBe('INTERNAL_ERROR');
      }
      getSigningSpy.mockRestore();

      // 6. listContractTemplates failure
      const listSpy = vi
        .spyOn(templateRepo, 'listContractTemplates')
        .mockRejectedValueOnce(new Error('Database list error'));

      const listRes = await listContractTemplatesAction({}, dbClient);
      expect(listRes.success).toBe(false);
      if (!listRes.success) {
        expect(listRes.code).toBe('INTERNAL_ERROR');
      }
      listSpy.mockRestore();

      // 7. Non-Error exception branch (string throw)
      const stringSpy = vi
        .spyOn(templateRepo, 'createContractTemplate')
        .mockRejectedValueOnce('string-exception');

      const stringRes = await createContractTemplateAction(
        {
          name: 'Fail Template',
          slug: 'fail-template',
          contentEn: 'content',
          contentDe: 'inhalt',
        },
        dbClient,
      );
      expect(stringRes.success).toBe(false);
      if (!stringRes.success) {
        expect(stringRes.code).toBe('INTERNAL_ERROR');
        expect(stringRes.error).toBe('Failed to create contract template');
      }
      stringSpy.mockRestore();
    });
  });
});

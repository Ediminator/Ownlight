import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { type AuthContext } from '@/server/auth/guards';
import { UnauthenticatedError } from '@/server/auth/repo-auth';
import { contractTemplates } from '@/server/db/schema/contracts';
import { auditEvents } from '@/server/db/schema/audit';
import {
  listContractTemplates,
  getContractTemplateById,
  getContractTemplateBySlug,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  ContractTemplateNotFoundError,
} from '@/server/contracts/template-repo';
import { eq, desc } from 'drizzle-orm';

describe('Contract Templates Repository Integration Tests (AC-1, AC-2, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;

  const ownerAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Studio Owner',
      email: 'owner@example.org',
      emailVerified: true,
      image: null,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  const clientAuth: AuthContext = {
    user: {
      id: '01920000-0000-7000-8000-000000000002',
      name: 'Client User',
      email: 'client@example.org',
      emailVerified: true,
      image: null,
      role: 'client',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-1: createContractTemplate inserts template with UUIDv7 ID and emits contract_template.created audit event', async () => {
    const created = await createContractTemplate(
      {
        name: 'Wedding Photography Agreement',
        slug: 'wedding-photography-agreement',
        description: 'Standard contract for weddings',
        projectTypeKey: 'wedding',
        contentEn: '# Wedding Agreement\nBetween {{studio.name}} and {{client.name}}.',
        contentDe: '# Hochzeitsvertrag\nZwischen {{studio.name}} und {{client.name}}.',
        isDefault: true,
        isActive: true,
      },
      ownerAuth,
      dbClient,
    );

    expect(created.id).toBeDefined();
    expect(created.name).toBe('Wedding Photography Agreement');
    expect(created.slug).toBe('wedding-photography-agreement');
    expect(created.projectTypeKey).toBe('wedding');
    expect(created.isDefault).toBe(true);
    expect(created.isActive).toBe(true);

    // Verify in database
    const [persisted] = await dbClient
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, created.id))
      .limit(1);

    expect(persisted).toBeDefined();
    expect(persisted?.name).toBe('Wedding Photography Agreement');

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract_template.created'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('contract_template');
    expect(auditLog?.targetId).toBe(created.id);
    expect(auditLog?.metadata).toMatchObject({
      template_id: created.id,
      slug: 'wedding-photography-agreement',
      name: 'Wedding Photography Agreement',
      project_type_key: 'wedding',
      is_default: true,
    });
  });

  it('AC-2: updateContractTemplate persists modifications and records contract_template.updated audit event', async () => {
    const template = await createContractTemplate(
      {
        name: 'Portrait Terms',
        slug: 'portrait-terms',
        contentEn: 'English original',
        contentDe: 'German original',
      },
      ownerAuth,
      dbClient,
    );

    const updated = await updateContractTemplate(
      template.id,
      {
        name: 'Updated Portrait Terms & Conditions',
        description: 'Updated description for portraits',
        contentEn: 'Updated English terms',
      },
      ownerAuth,
      dbClient,
    );

    expect(updated.name).toBe('Updated Portrait Terms & Conditions');
    expect(updated.description).toBe('Updated description for portraits');
    expect(updated.contentEn).toBe('Updated English terms');

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract_template.updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(template.id);
    expect(auditLog?.metadata).toMatchObject({
      template_id: template.id,
      slug: 'portrait-terms',
      name: 'Updated Portrait Terms & Conditions',
      changed_fields: ['name', 'description', 'contentEn'],
    });
  });

  it('AC-2: deleteContractTemplate performs soft deactivation (isActive = false) and records contract_template.deleted audit event', async () => {
    const template = await createContractTemplate(
      {
        name: 'Commercial Agreement',
        slug: 'commercial-agreement',
        contentEn: 'Commercial terms',
        contentDe: 'Gewerbliche Bedingungen',
      },
      ownerAuth,
      dbClient,
    );

    const deleted = await deleteContractTemplate(template.id, ownerAuth, dbClient);
    expect(deleted.isActive).toBe(false);

    // Verify row still exists in database with isActive = false
    const [persisted] = await dbClient
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, template.id))
      .limit(1);

    expect(persisted).toBeDefined();
    expect(persisted?.isActive).toBe(false);

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contract_template.deleted'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetId).toBe(template.id);
    expect(auditLog?.metadata).toMatchObject({
      template_id: template.id,
      slug: 'commercial-agreement',
    });
  });

  it('AC-2: unsets existing default when setting a new default template for the same project type', async () => {
    const firstDefault = await createContractTemplate(
      {
        name: 'Wedding Standard',
        slug: 'wedding-standard',
        projectTypeKey: 'wedding',
        contentEn: 'T1 En',
        contentDe: 'T1 De',
        isDefault: true,
      },
      ownerAuth,
      dbClient,
    );
    expect(firstDefault.isDefault).toBe(true);

    const secondDefault = await createContractTemplate(
      {
        name: 'Wedding Premium Default',
        slug: 'wedding-premium-default',
        projectTypeKey: 'wedding',
        contentEn: 'T2 En',
        contentDe: 'T2 De',
        isDefault: true,
      },
      ownerAuth,
      dbClient,
    );
    expect(secondDefault.isDefault).toBe(true);

    // First template must have been flipped to isDefault: false
    const refreshedFirst = await getContractTemplateById(firstDefault.id, ownerAuth, dbClient);
    expect(refreshedFirst.isDefault).toBe(false);
  });

  it('AC-7: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    await expect(listContractTemplates(undefined, clientAuth, dbClient)).rejects.toThrow(
      UnauthenticatedError,
    );

    await expect(
      createContractTemplate(
        {
          name: 'Unauth Template',
          slug: 'unauth-template',
          contentEn: 'En',
          contentDe: 'De',
        },
        clientAuth,
        dbClient,
      ),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
      getContractTemplateById('01920000-0000-7000-8000-000000000000', clientAuth, dbClient),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(getContractTemplateBySlug('any-slug', clientAuth, dbClient)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('AC-8: rejects invalid template input (empty name or invalid slug)', async () => {
    await expect(
      createContractTemplate(
        {
          name: '   ',
          slug: 'valid-slug',
          contentEn: 'En',
          contentDe: 'De',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow();

    await expect(
      createContractTemplate(
        {
          name: 'Valid Name',
          slug: 'NOT_KEBAB_CASE',
          contentEn: 'En',
          contentDe: 'De',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow();
  });

  it('AC-8: throws ContractTemplateNotFoundError for non-existent template ID or slug', async () => {
    await expect(
      getContractTemplateById('01920000-0000-7000-8000-000000000099', ownerAuth, dbClient),
    ).rejects.toThrow(ContractTemplateNotFoundError);

    await expect(
      getContractTemplateBySlug('non-existent-slug', ownerAuth, dbClient),
    ).rejects.toThrow(ContractTemplateNotFoundError);

    await expect(
      updateContractTemplate(
        '01920000-0000-7000-8000-000000000099',
        { name: 'X' },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow(ContractTemplateNotFoundError);
  });

  it('AC-1: listContractTemplates filters by activeOnly and projectTypeKey', async () => {
    // Universal active template
    await createContractTemplate(
      {
        name: 'Universal Terms',
        slug: 'universal-terms',
        projectTypeKey: null,
        contentEn: 'En',
        contentDe: 'De',
        isDefault: true,
        isActive: true,
      },
      ownerAuth,
      dbClient,
    );

    // Wedding active template
    await createContractTemplate(
      {
        name: 'Wedding Active',
        slug: 'wedding-active',
        projectTypeKey: 'wedding',
        contentEn: 'En',
        contentDe: 'De',
        isDefault: false,
        isActive: true,
      },
      ownerAuth,
      dbClient,
    );

    // Inactive template
    const inactive = await createContractTemplate(
      {
        name: 'Old Inactive Template',
        slug: 'old-inactive',
        projectTypeKey: 'portrait',
        contentEn: 'En',
        contentDe: 'De',
        isDefault: false,
        isActive: false,
      },
      ownerAuth,
      dbClient,
    );

    // Test activeOnly filter
    const activeList = await listContractTemplates({ activeOnly: true }, ownerAuth, dbClient);
    expect(activeList.some((t) => t.id === inactive.id)).toBe(false);

    // Test projectTypeKey filter
    const weddingList = await listContractTemplates(
      { projectTypeKey: 'wedding' },
      ownerAuth,
      dbClient,
    );
    expect(weddingList.every((t) => t.projectTypeKey === 'wedding')).toBe(true);

    // Test projectTypeKey null filter
    const universalList = await listContractTemplates(
      { projectTypeKey: null },
      ownerAuth,
      dbClient,
    );
    expect(universalList.every((t) => t.projectTypeKey === null)).toBe(true);

    // Test without options
    const allList = await listContractTemplates(undefined, ownerAuth, dbClient);
    expect(allList.length).toBeGreaterThanOrEqual(3);
  });

  it('AC-2: handles updating universal default template and all template fields', async () => {
    const tpl = await createContractTemplate(
      {
        name: 'Initial Universal',
        slug: 'initial-universal',
        projectTypeKey: null,
        contentEn: 'En',
        contentDe: 'De',
      },
      ownerAuth,
      dbClient,
    );

    const updated = await updateContractTemplate(
      tpl.id,
      {
        slug: 'renamed-universal',
        description: 'New Description',
        projectTypeKey: 'portrait',
        contentEn: 'New En',
        contentDe: 'New De',
        isActive: false,
        isDefault: true,
      },
      ownerAuth,
      dbClient,
    );

    expect(updated.slug).toBe('renamed-universal');
    expect(updated.description).toBe('New Description');
    expect(updated.projectTypeKey).toBe('portrait');
    expect(updated.contentDe).toBe('New De');
    expect(updated.isActive).toBe(false);
    expect(updated.isDefault).toBe(true);

    // Another universal default update
    const tplUniversal2 = await createContractTemplate(
      {
        name: 'Univ 2',
        slug: 'univ-2',
        projectTypeKey: null,
        contentEn: 'En',
        contentDe: 'De',
        isDefault: true,
      },
      ownerAuth,
      dbClient,
    );

    const updatedUniv2 = await updateContractTemplate(
      tplUniversal2.id,
      {
        isDefault: true,
        projectTypeKey: null,
      },
      ownerAuth,
      dbClient,
    );
    expect(updatedUniv2.isDefault).toBe(true);
  });
});

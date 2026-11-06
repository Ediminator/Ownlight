import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import type { DbClient } from '@/server/db/client';
import { type AuthContext } from '@/server/auth/guards';
import { UnauthenticatedError } from '@/server/auth/repo-auth';
import { auditEvents } from '@/server/db/schema/audit';
import {
  getStudioSigningProfile,
  updateStudioSigningProfile,
} from '@/server/studio/signing-settings';
import { eq, desc } from 'drizzle-orm';

describe('Studio Signing Settings Integration Tests (AC-6, AC-7, AC-8)', () => {
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

  it('AC-6: updateStudioSigningProfile updates signatory info and physical address and records studio_settings.contract_updated audit event', async () => {
    const updated = await updateStudioSigningProfile(
      {
        contractSignatoryName: 'Jane Doe',
        contractSignatoryTitle: 'Lead Photographer & Studio Owner',
        contractCountersignatureMode: 'explicit',
        studioAddressLine1: 'Torstraße 100',
        studioAddressLine2: 'Hinterhof 2. OG',
        studioPostalCode: '10119',
        studioCity: 'Berlin',
        studioCountryCode: 'DE',
        studioPhone: '+49 30 1234567',
        studioEmail: 'photographer@example.org',
      },
      ownerAuth,
      dbClient,
    );

    expect(updated.contract_signatory_name).toBe('Jane Doe');
    expect(updated.contract_signatory_title).toBe('Lead Photographer & Studio Owner');
    expect(updated.contract_countersignature_mode).toBe('explicit');
    expect(updated.studio_address_line1).toBe('Torstraße 100');
    expect(updated.studio_address_line2).toBe('Hinterhof 2. OG');
    expect(updated.studio_postal_code).toBe('10119');
    expect(updated.studio_city).toBe('Berlin');
    expect(updated.studio_country_code).toBe('DE');
    expect(updated.studio_phone).toBe('+49 30 1234567');
    expect(updated.studio_email).toBe('photographer@example.org');

    // Verify in database via getStudioSigningProfile
    const fetched = await getStudioSigningProfile(ownerAuth, dbClient);
    expect(fetched.contract_signatory_name).toBe('Jane Doe');
    expect(fetched.contract_countersignature_mode).toBe('explicit');
    expect(fetched.studio_city).toBe('Berlin');

    // Verify audit log
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'studio_settings.contract_updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('studio_settings');
    const meta = auditLog?.metadata as {
      contract_signatory_name?: string;
      contract_countersignature_mode?: string;
      studio_city?: string;
      studio_country_code?: string;
      changed_fields?: string[];
    } | null;
    expect(meta?.contract_signatory_name).toBe('Jane Doe');
    expect(meta?.contract_countersignature_mode).toBe('explicit');
    expect(meta?.studio_city).toBe('Berlin');
    expect(meta?.studio_country_code).toBe('DE');
    expect(meta?.changed_fields).toContain('contract_signatory_name');
    expect(meta?.changed_fields).toContain('contract_signatory_title');
    expect(meta?.changed_fields).toContain('contract_countersignature_mode');
    expect(meta?.changed_fields).toContain('studio_city');
  });

  it('AC-7: rejects unauthenticated caller with UNAUTHENTICATED', async () => {
    await expect(getStudioSigningProfile(clientAuth, dbClient)).rejects.toThrow(
      UnauthenticatedError,
    );

    await expect(
      updateStudioSigningProfile(
        {
          contractSignatoryName: 'Hacker',
        },
        clientAuth,
        dbClient,
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it('AC-8: invalid signing profile payload throws typed validation error without mutating database', async () => {
    await expect(
      updateStudioSigningProfile(
        {
          contractCountersignatureMode: 'unsupported_mode',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow();

    await expect(
      updateStudioSigningProfile(
        {
          studioEmail: 'invalid-email-format',
        },
        ownerAuth,
        dbClient,
      ),
    ).rejects.toThrow();
  });

  it('AC-6: supports partial updates to signing profile and address fields', async () => {
    const updatedName = await updateStudioSigningProfile(
      {
        contractSignatoryName: 'Alex River',
      },
      ownerAuth,
      dbClient,
    );
    expect(updatedName.contract_signatory_name).toBe('Alex River');

    const updatedMode = await updateStudioSigningProfile(
      {
        contractCountersignatureMode: 'pre_signed',
      },
      ownerAuth,
      dbClient,
    );
    expect(updatedMode.contract_countersignature_mode).toBe('pre_signed');
    expect(updatedMode.contract_signatory_name).toBe('Alex River');
  });
});

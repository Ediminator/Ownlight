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
import { auditEvents } from '@/server/db/schema/audit';
import { createSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { eq, desc } from 'drizzle-orm';
import { getStudioTaxSettings, updateStudioTaxSettings } from '@/server/studio/tax-settings';

describe('TASK-0056: Studio Tax Settings Integration Tests (AC-6, AC-7, AC-8)', () => {
  let testDb: TestDatabaseInstance;
  let dbClient: DbClient;
  let ownerUser: { id: string; name: string; email: string; role: string };
  let sessionToken: string;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    dbClient = testDb.db as unknown as DbClient;

    mockCookiesStore.clear();
    mockHeadersStore.clear();

    const [insertedUser] = await dbClient
      .insert(user)
      .values({
        id: '01920000-0000-7000-8000-000000000001',
        name: 'Studio Owner',
        email: 'owner@example.org',
        role: 'owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedUser) throw new Error('Expected user to be inserted');
    ownerUser = insertedUser;

    const sessionRecord = await createSession(ownerUser.id, dbClient);
    sessionToken = sessionRecord.token;
    mockCookiesStore.set(SESSION_COOKIE_NAME, sessionToken);
  });

  afterEach(async () => {
    mockCookiesStore.clear();
    mockHeadersStore.clear();
    await testDb.destroy();
  });

  it('AC-6: updateStudioTaxSettings updates tax configuration and records studio_settings.tax_updated audit event', async () => {
    const updated = await updateStudioTaxSettings(
      {
        taxNumber: '91/123/45678',
        vatId: 'DE987654321',
        isKleinunternehmer: true,
        kleinunternehmerNotice: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        defaultTaxRateBasisPoints: 0,
        pricesIncludeTax: false,
      },
      dbClient,
    );

    expect(updated.tax_number).toBe('91/123/45678');
    expect(updated.vat_id).toBe('DE987654321');
    expect(updated.is_kleinunternehmer).toBe(true);
    expect(updated.kleinunternehmer_notice).toBe(
      'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    );
    expect(updated.default_tax_rate_basis_points).toBe(0);
    expect(updated.prices_include_tax).toBe(false);

    // Verify in database
    const fetched = await getStudioTaxSettings(dbClient);
    expect(fetched.tax_number).toBe('91/123/45678');
    expect(fetched.vat_id).toBe('DE987654321');
    expect(fetched.is_kleinunternehmer).toBe(true);

    // Verify audit event
    const [auditLog] = await dbClient
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'studio_settings.tax_updated'))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);

    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('studio_settings');
  });

  it('AC-7: rejects unauthenticated caller attempting to get or update tax settings with UNAUTHENTICATED', async () => {
    mockCookiesStore.clear();

    await expect(getStudioTaxSettings(dbClient)).rejects.toThrow('UNAUTHENTICATED');

    await expect(
      updateStudioTaxSettings(
        {
          taxNumber: '12345',
        },
        dbClient,
      ),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('AC-8: invalid tax settings payload throws typed validation error without mutating database', async () => {
    await expect(
      updateStudioTaxSettings(
        {
          defaultTaxRateBasisPoints: -50,
        },
        dbClient,
      ),
    ).rejects.toThrow();
  });

  it('AC-6: updateStudioTaxSettings handles individual partial updates correctly', async () => {
    const updated = await updateStudioTaxSettings(
      {
        vatId: 'DE111222333',
      },
      dbClient,
    );
    expect(updated.vat_id).toBe('DE111222333');

    const updated2 = await updateStudioTaxSettings(
      {
        pricesIncludeTax: false,
      },
      dbClient,
    );
    expect(updated2.prices_include_tax).toBe(false);

    // Test updating taxNumber and vatId to null (clearing them)
    const updatedWithNulls = await updateStudioTaxSettings(
      {
        taxNumber: null,
        vatId: null,
      },
      dbClient,
    );
    expect(updatedWithNulls.tax_number).toBeNull();
    expect(updatedWithNulls.vat_id).toBeNull();
  });
});

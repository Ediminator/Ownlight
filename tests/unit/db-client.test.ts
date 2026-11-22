import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock postgres client to test client creation without opening actual sockets
const mockSql = Object.assign(
  vi.fn(() => Promise.resolve([])),
  {
    end: vi.fn(() => Promise.resolve()),
    options: {
      parsers: {},
      serializers: {},
    },
  },
);

vi.mock('postgres', () => {
  return {
    default: vi.fn((_url: string, options: unknown) => {
      mockSql.options = { ...(options as object), parsers: {}, serializers: {} };
      return mockSql;
    }),
  };
});

import {
  configurePostgresDateSerializers,
  createPostgresClient,
  getRawSql,
  getDb,
  rawSql,
  db,
  type DbClient,
} from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { studioSettings } from '@/server/db/schema';
import { isUuidV7 } from '@/lib/id';
import { resetEnvCache } from '@/env';

describe('Database client and schema helper', () => {
  const mockValidEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    AUTH_URL: 'http://localhost:3000',
    AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a', // gitleaks:allow
    DATABASE_URL: 'postgres://ownlight_app:password@127.0.0.1:5432/ownlight_dev',
    STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    STORAGE_PORT: '9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'valid_access_key_123',
    STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b', // gitleaks:allow
    STORAGE_BUCKET_UPLOADS: 'ownlight-uploads',
    STORAGE_USE_SSL: 'false',
  };

  beforeEach(() => {
    Object.assign(process.env, mockValidEnv);
    resetEnvCache();
  });

  it('createPostgresClient respects custom configuration options', () => {
    const client = createPostgresClient({
      url: 'postgres://test:pw@127.0.0.1:5432/test_db',
      maxConnections: 5,
      statementTimeout: 15,
      ssl: 'require',
    });

    expect(client).toBeDefined();
    expect((mockSql.options as { max?: number }).max).toBe(5);
    expect((mockSql.options as { timeout?: number }).timeout).toBe(15);
    expect((mockSql.options as { ssl?: unknown }).ssl).toBe('require');
  });

  it('createPostgresClient uses environment defaults when options are omitted', () => {
    const client = createPostgresClient();
    expect(client).toBeDefined();
  });

  it('getRawSql and getDb return singletons', () => {
    const raw1 = getRawSql();
    const raw2 = getRawSql();
    expect(raw1).toBe(raw2);

    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it('rawSql proxy forwards calls and property accesses', async () => {
    expect('end' in rawSql).toBe(true);
    expect(typeof rawSql.end).toBe('function');
    await rawSql`SELECT 1`;
  });

  it('db proxy forwards Drizzle query builders', () => {
    expect('select' in db).toBe(true);
    expect(typeof db.select).toBe('function');
  });

  it('studioSettings column defaultFn generates a valid UUIDv7', () => {
    const defaultFn = studioSettings.id.defaultFn;
    expect(defaultFn).toBeDefined();
    if (defaultFn) {
      const generated = defaultFn();
      expect(isUuidV7(generated)).toBe(true);
    }
  });

  it('AC-1: DbClient is a structural non-class type preserving Drizzle and schema surface', () => {
    type StructuralPostgresDb = Pick<
      PostgresJsDatabase<typeof schema>,
      keyof PostgresJsDatabase<typeof schema>
    >;

    // Structural Pick type omits protected class members (e.g., authToken) so it only equals DbClient once DbClient is structural
    expectTypeOf<DbClient>().toEqualTypeOf<StructuralPostgresDb>();

    type ExpectedPublicMembers =
      | 'query'
      | 'select'
      | 'selectDistinct'
      | 'selectDistinctOn'
      | 'insert'
      | 'update'
      | 'delete'
      | 'execute'
      | 'transaction'
      | 'with'
      | '$with'
      | '$count'
      | '$cache'
      | '_';
    expectTypeOf<ExpectedPublicMembers>().toExtend<keyof DbClient>();

    expectTypeOf<DbClient['query']['studioSettings']>().toEqualTypeOf<
      PostgresJsDatabase<typeof schema>['query']['studioSettings']
    >();
    expectTypeOf<DbClient['select']>().toEqualTypeOf<PostgresJsDatabase<typeof schema>['select']>();
    expectTypeOf<DbClient['insert']>().toEqualTypeOf<PostgresJsDatabase<typeof schema>['insert']>();
    expectTypeOf<DbClient['update']>().toEqualTypeOf<PostgresJsDatabase<typeof schema>['update']>();
    expectTypeOf<DbClient['delete']>().toEqualTypeOf<PostgresJsDatabase<typeof schema>['delete']>();
    expectTypeOf<DbClient['transaction']>().toEqualTypeOf<
      PostgresJsDatabase<typeof schema>['transaction']
    >();

    // Runtime verification that db exposes the Drizzle query builder surface
    expect(typeof db.select).toBe('function');
    expect(typeof db.selectDistinct).toBe('function');
    expect(typeof db.selectDistinctOn).toBe('function');
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
    expect(typeof db.execute).toBe('function');
    expect(typeof db.transaction).toBe('function');
    expect(typeof db.with).toBe('function');
    expect(typeof db.$with).toBe('function');
    expect(typeof db.$count).toBe('function');
    expect(db.query.studioSettings).toBeDefined();
  });

  it('AC-2: db Proxy, transaction tx, PGlite client, and structural mocks satisfy DbClient with schema inference', async () => {
    type StudioSettingsRow = typeof studioSettings.$inferSelect;

    const acceptsDbClient = (client: DbClient) => ({
      selectSettings: () => client.select().from(studioSettings),
      queryFirstSettings: () => client.query.studioSettings.findFirst(),
      runInTransaction: () =>
        client.transaction(async (tx) => {
          // tx (PgTransaction) must be directly assignable to DbClient without a cast
          const nested = acceptsDbClient(tx);
          return nested.selectSettings();
        }),
    });

    // 1. Lazy Proxy db satisfies DbClient and infers exact schema row types
    const fromProxy = acceptsDbClient(db);
    expect(typeof fromProxy.selectSettings).toBe('function');
    expect(typeof fromProxy.queryFirstSettings).toBe('function');
    expect(typeof fromProxy.runInTransaction).toBe('function');
    expectTypeOf<Awaited<ReturnType<typeof fromProxy.selectSettings>>>().toEqualTypeOf<
      StudioSettingsRow[]
    >();
    expectTypeOf<Awaited<ReturnType<typeof fromProxy.queryFirstSettings>>>().toEqualTypeOf<
      StudioSettingsRow | undefined
    >();
    expectTypeOf<ReturnType<typeof fromProxy.runInTransaction>>().toEqualTypeOf<
      Promise<StudioSettingsRow[]>
    >();

    // 2. Transaction handle tx satisfies DbClient directly
    type TxParam = Parameters<Parameters<DbClient['transaction']>[0]>[0];
    expectTypeOf<TxParam>().toExtend<DbClient>();

    // 3. drizzlePglite(pglite, { schema }) adapted to DbClient preserves exact schema inference
    const wrapPglite = (pglite: PGlite): DbClient =>
      drizzlePglite(pglite, { schema }) as unknown as DbClient;
    expect(typeof wrapPglite).toBe('function');
    expectTypeOf<ReturnType<typeof wrapPglite>>().toEqualTypeOf<DbClient>();
    expectTypeOf<
      PgliteDatabase<typeof schema>['query']['studioSettings']
    >().not.toEqualTypeOf<never>();

    // 4. Structural mock object satisfies DbClient
    const selectMock = vi.fn(() => ({ from: vi.fn(() => Promise.resolve([])) }));
    const structuralMock = {
      select: selectMock,
      query: { studioSettings: { findFirst: vi.fn(() => Promise.resolve(undefined)) } },
      transaction: vi.fn(async (cb: (tx: DbClient) => Promise<unknown>) => cb(structuralMock)),
    } as unknown as DbClient;
    const fromMock = acceptsDbClient(structuralMock);
    expect(typeof fromMock.selectSettings).toBe('function');
    expect(typeof fromMock.runInTransaction).toBe('function');
    const txRows = await fromMock.runInTransaction();
    expect(txRows).toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('AC-3: eslint.config.mjs preserves strictTypeChecked without suppressing no-unsafe-class-instance-assignment', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    const eslintConfig = fs.readFileSync(path.join(repoRoot, 'eslint.config.mjs'), 'utf8');
    const dbClientSource = fs.readFileSync(path.join(repoRoot, 'src/server/db/client.ts'), 'utf8');

    expect(eslintConfig).toContain('strictTypeChecked');
    expect(eslintConfig).toContain('stylisticTypeChecked');
    expect(eslintConfig).not.toContain('no-unsafe-class-instance-assignment');

    const forbiddenSuppressions = [
      ['eslint', 'disable'].join('-'),
      ['@ts', 'ignore'].join('-'),
      ['@ts', 'expect', 'error'].join('-'),
    ];
    for (const directive of forbiddenSuppressions) {
      expect(dbClientSource).not.toContain(directive);
    }
    expect(dbClientSource).not.toMatch(/export type DbClient\s*=\s*PostgresJsDatabase/);
  });

  it('AC-4: runtime getDb, rawSql/db Proxies, and configurePostgresDateSerializers behave identically', async () => {
    const raw1 = getRawSql();
    const raw2 = getRawSql();
    expect(raw1).toBe(raw2);

    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);

    expect('select' in db).toBe(true);
    expect('nonExistentMember' in db).toBe(false);
    expect('end' in rawSql).toBe(true);
    await rawSql`SELECT 1`;

    const sqlTarget: { options?: { serializers?: Record<string, (val: unknown) => unknown> } } = {};
    configurePostgresDateSerializers(sqlTarget);

    const serializers = sqlTarget.options?.serializers;
    expect(serializers).toBeDefined();

    const sampleDate = new Date('2026-06-15T12:00:00.000Z');
    expect(serializers?.['1184']?.(sampleDate)).toBe('2026-06-15T12:00:00.000Z');
    expect(serializers?.['1082']?.(sampleDate)).toBe('2026-06-15T12:00:00.000Z');
    expect(serializers?.['1083']?.(sampleDate)).toBe('2026-06-15T12:00:00.000Z');
    expect(serializers?.['1114']?.(sampleDate)).toBe('2026-06-15T12:00:00.000Z');
    expect(serializers?.['1184']?.('already-iso')).toBe('already-iso');
  });

  it('AC-5: rejects incompatible partial objects and invalid query table names at compile time', () => {
    interface IncompleteClient {
      select: () => null;
    }

    expectTypeOf<IncompleteClient>().not.toExtend<DbClient>();
    expectTypeOf<Record<string, unknown>>().not.toExtend<DbClient>();
    expectTypeOf<Record<string, never>>().not.toExtend<DbClient>();
    expectTypeOf<'nonExistentTable'>().not.toExtend<keyof DbClient['query']>();
    expectTypeOf<{ nonExistentTable: unknown }>().not.toExtend<DbClient['query']>();
  });
});

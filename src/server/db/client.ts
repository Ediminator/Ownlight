import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/env';

export interface DbClientConfig {
  url?: string;
  maxConnections?: number;
  statementTimeout?: number;
  ssl?: boolean | 'require' | 'prefer';
}

/**
 * Creates a raw postgres connection instance configured with connection limits,
 * statement timeout, SSL, and hardened logging that never exposes query arguments or PII.
 */
export function createPostgresClient(config: DbClientConfig = {}): postgres.Sql {
  const connectionUrl = config.url ?? env.DATABASE_URL;
  const maxConnections = config.maxConnections ?? env.DB_MAX_CONNECTIONS;
  const statementTimeout = config.statementTimeout ?? env.DB_STATEMENT_TIMEOUT;
  const ssl = config.ssl ?? env.DB_SSL;

  return postgres(connectionUrl, {
    max: maxConnections,
    timeout: statementTimeout,
    ssl,
    transform: {
      undefined: null,
    },
    // Query parameters are never logged to prevent credential or personal data leakage
    debug: false,
    onnotice: () => undefined,
  });
}

/**
 * Configures postgres-js serializers for timestamp/date OIDs (1184, 1082, 1083, 1114)
 * so that raw Date objects passed into sql`...` template tags serialize to ISO strings
 * rather than throwing TypeError.
 */
export function configurePostgresDateSerializers(sqlClient: {
  options?: { serializers?: Record<string, (val: unknown) => unknown> };
}): void {
  sqlClient.options ??= {};
  sqlClient.options.serializers ??= {};

  const serializeDate = (val: unknown): unknown => (val instanceof Date ? val.toISOString() : val);

  sqlClient.options.serializers['1184'] = serializeDate;
  sqlClient.options.serializers['1082'] = serializeDate;
  sqlClient.options.serializers['1083'] = serializeDate;
  sqlClient.options.serializers['1114'] = serializeDate;
}

import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

export type DbClient = PostgresJsDatabase<typeof schema>;

// Global singleton cache for Next.js hot-reload persistence in development
const globalForDb = globalThis as unknown as {
  rawSql: postgres.Sql | undefined;
  db: DbClient | undefined;
  pglite: PGlite | undefined;
};

export function getRawSql(): postgres.Sql {
  globalForDb.rawSql ??= createPostgresClient();
  return globalForDb.rawSql;
}

export function getDb(): DbClient {
  if (globalForDb.db) {
    return globalForDb.db;
  }

  if (process.env.USE_PGLITE === 'true') {
    const dataDir = process.env.PGLITE_DATA_DIR
      ? path.resolve(process.env.PGLITE_DATA_DIR)
      : undefined;
    globalForDb.pglite ??= new PGlite(dataDir);

    try {
      const drizzleDir = path.resolve(process.cwd(), 'drizzle');
      const metaJournalPath = path.resolve(drizzleDir, 'meta/_journal.json');
      if (fs.existsSync(metaJournalPath)) {
        const journal = JSON.parse(fs.readFileSync(metaJournalPath, 'utf8')) as {
          entries: { tag: string }[];
        };
        for (const entry of journal.entries) {
          const sqlFile = path.resolve(drizzleDir, `${entry.tag}.sql`);
          if (fs.existsSync(sqlFile)) {
            const sql = fs.readFileSync(sqlFile, 'utf8');
            void globalForDb.pglite.exec(sql).catch(() => {
              // Ignore migration errors if tables already exist
            });
          }
        }
      }
    } catch {
      // Ignore migration errors if tables already exist
    }

    globalForDb.db = drizzlePglite(globalForDb.pglite, { schema }) as unknown as DbClient;
    return globalForDb.db;
  }

  const rawClient = getRawSql();
  globalForDb.db = drizzle(rawClient, { schema });
  configurePostgresDateSerializers(rawClient);
  return globalForDb.db;
}

/**
 * Lazy proxy exports so importing server modules does not eagerly connect
 * or throw during build/test before environment configuration.
 */
export const rawSql: postgres.Sql = new Proxy((() => undefined) as unknown as postgres.Sql, {
  get(_target, prop: string | symbol): unknown {
    const value: unknown = Reflect.get(getRawSql(), prop);
    return value;
  },
  has(_target, prop: string | symbol): boolean {
    return Reflect.has(getRawSql(), prop);
  },
  apply(_target, thisArg: unknown, argArray: unknown[]): unknown {
    const value: unknown = Reflect.apply(getRawSql(), thisArg, argArray);
    return value;
  },
});

export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, prop: string | symbol): unknown {
    const value: unknown = Reflect.get(getDb(), prop);
    return value;
  },
  has(_target, prop: string | symbol): boolean {
    return Reflect.has(getDb(), prop);
  },
});

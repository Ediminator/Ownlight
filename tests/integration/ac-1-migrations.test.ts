import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { checkSchemaDrift } from '../../scripts/db-check.mjs';

describe('AC-1: Database migrations and drift detection', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');
  const dbCheckScript = path.resolve(rootDir, 'scripts/db-check.mjs');

  it('AC-1: migration files are committed in drizzle/ and registered in journal', () => {
    expect(fs.existsSync(drizzleDir)).toBe(true);

    const journalPath = path.resolve(drizzleDir, 'meta/_journal.json');
    expect(fs.existsSync(journalPath)).toBe(true);

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string; idx: number }[];
    };
    expect(journal.entries.length).toBeGreaterThan(0);

    for (const entry of journal.entries) {
      const sqlFile = path.resolve(drizzleDir, `${entry.tag}.sql`);
      expect(fs.existsSync(sqlFile)).toBe(true);
      const sqlContent = fs.readFileSync(sqlFile, 'utf8');
      expect(sqlContent.length).toBeGreaterThan(0);
    }
    const firstEntry = journal.entries[0];
    expect(firstEntry).toBeDefined();
    if (!firstEntry) {
      throw new Error('Expected at least one journal entry');
    }
    const initialMigration = fs.readFileSync(
      path.resolve(drizzleDir, `${firstEntry.tag}.sql`),
      'utf8',
    );
    expect(initialMigration).toContain('studio_settings');
  });

  it('AC-1: given an empty database, migrations apply all tables and constraints', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: drizzleDir });

      const res = await client.query<{ column_name: string; data_type: string }>(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'studio_settings' ORDER BY ordinal_position",
      );

      const columns = res.rows.map((r) => r.column_name);
      expect(columns).toEqual([
        'id',
        'studio_name',
        'default_locale',
        'timezone',
        'currency',
        'created_at',
        'updated_at',
        'mfa_required',
        'mfa_postponed_until',
      ]);

      // Verify MFA tables exist
      const tablesRes = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      const tableNames = tablesRes.rows.map((r) => r.table_name);
      expect(tableNames).toContain('totp_credential');
      expect(tableNames).toContain('recovery_code');
      expect(tableNames).toContain('passkey_credential');
    } finally {
      await client.close();
    }
  });

  it('AC-1: running migrations a second time is an idempotent no-op', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);

      // Run migrations for the first time using the real Drizzle migrator
      await migrate(db, { migrationsFolder: drizzleDir });

      // Insert test row into migrated schema
      await client.query(
        "INSERT INTO studio_settings (id, studio_name, default_locale, timezone, currency, created_at, updated_at) VALUES ('01912345-6789-7abc-8def-0123456789ab', 'Test Studio', 'en', 'UTC', 'EUR', NOW(), NOW())",
      );

      // Running the actual migration runner a second time must execute cleanly without error
      await migrate(db, { migrationsFolder: drizzleDir });

      // Verify data remains intact after re-running migrations
      const rows = await client.query('SELECT count(*) as cnt FROM studio_settings');
      expect(Number((rows.rows[0] as { cnt: string | number }).cnt)).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('AC-1: db:check passes when schema and migrations are in sync', () => {
    const result = checkSchemaDrift();
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  }, 60000);

  it('AC-1: checkSchemaDrift returns valid: false when migrations directory is missing', () => {
    const missingDir = path.resolve(rootDir, 'nonexistent_drizzle_dir');
    const result = checkSchemaDrift({ drizzleDir: missingDir });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('AC-1: checkSchemaDrift fails and db:check exits non-zero when schema and migrations drift', () => {
    const tempDir = path.resolve(rootDir, 'tests/fixtures/temp-drift-ac1');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Copy existing migrations into tempDir
      fs.cpSync(drizzleDir, path.join(tempDir, 'drizzle'), { recursive: true });

      // Create a drifted schema with an unmigrated column
      fs.writeFileSync(
        path.join(tempDir, 'drift-schema.ts'),
        `import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
export const studioSettings = pgTable('studio_settings', {
  id: uuid('id').primaryKey().notNull(),
  studioName: text('studio_name').notNull(),
  defaultLocale: text('default_locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  currency: text('currency').notNull().default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  unmigratedDriftColumn: text('unmigrated_drift_column'),
});`,
      );

      // Create a drizzle.config.ts referencing the drifted schema
      const relativeConfigPath = './tests/fixtures/temp-drift-ac1/drizzle.config.ts';
      const configPath = path.resolve(rootDir, relativeConfigPath);
      fs.writeFileSync(
        configPath,
        `import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './tests/fixtures/temp-drift-ac1/drift-schema.ts',
  out: './tests/fixtures/temp-drift-ac1/drizzle',
  dialect: 'postgresql',
});`,
      );

      // 1. Assert checkSchemaDrift() returns valid: false
      const result = checkSchemaDrift({
        drizzleDir: path.join(tempDir, 'drizzle'),
        config: relativeConfigPath,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Schema drift detected');

      // 2. Assert CLI execution exits with non-zero status code
      let cliFailed = false;
      try {
        execFileSync(
          process.execPath,
          [
            dbCheckScript,
            `--config=${relativeConfigPath}`,
            `--drizzle-dir=${path.join(tempDir, 'drizzle')}`,
          ],
          {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );
      } catch (err: unknown) {
        cliFailed = true;
        const execError = err as { status: number; stderr: string };
        expect(execError.status).toBe(1);
        expect(execError.stderr).toContain('Schema drift detected');
      }
      expect(cliFailed).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120000);
});

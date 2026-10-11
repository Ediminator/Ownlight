import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { isTable } from 'drizzle-orm';
import { getTableConfig, pgTable, uuid, text } from 'drizzle-orm/pg-core';
import * as schema from '@/server/db/schema';
import { getExportProviders } from '@/server/privacy/export/registry';
import { EXPORT_COVERAGE_ALLOWLIST } from '@/server/privacy/export/allowlist';

/**
 * Helper to extract table names with client_id or contact_id from a schema dictionary.
 */
function findTablesWithSubjectReferences(schemaObj: object): {
  tableName: string;
  columns: string[];
}[] {
  const result: { tableName: string; columns: string[] }[] = [];
  const visitedNames = new Set<string>();

  for (const value of Object.values(schemaObj)) {
    if (isTable(value)) {
      const config = getTableConfig(value);
      if (visitedNames.has(config.name)) continue;
      visitedNames.add(config.name);

      const refColumns = config.columns
        .map((col) => col.name)
        .filter((colName) => colName === 'client_id' || colName === 'contact_id');

      if (refColumns.length > 0) {
        result.push({
          tableName: config.name,
          columns: refColumns,
        });
      }
    }
  }

  return result;
}

/**
 * Checks whether a given list of tables is fully covered by providers or the allowlist.
 * Returns the list of unmapped table names.
 */
function checkCoverage(
  tables: { tableName: string; columns: string[] }[],
  coveredTables: ReadonlySet<string>,
  allowlistedTables: ReadonlySet<string>,
): string[] {
  const unmapped: string[] = [];
  for (const t of tables) {
    if (!coveredTables.has(t.tableName) && !allowlistedTables.has(t.tableName)) {
      unmapped.push(t.tableName);
    }
  }
  return unmapped;
}

describe('TASK-0015: DSAR export schema coverage (AC-5)', () => {
  it('AC-5: all schema tables with client_id or contact_id are covered by export providers or allowlist', () => {
    const subjectTables = findTablesWithSubjectReferences(schema);
    expect(subjectTables.length).toBeGreaterThan(0);

    const providers = getExportProviders();
    const coveredTables = new Set(providers.flatMap((p) => p.coveredTables));
    const allowlistedTables = new Set(EXPORT_COVERAGE_ALLOWLIST.map((e) => e.tableName));

    const unmapped = checkCoverage(subjectTables, coveredTables, allowlistedTables);

    expect(
      unmapped,
      `Unmapped tables containing client_id or contact_id columns found: ${unmapped.join(', ')}. ` +
        `Every table with client_id or contact_id must either have an active export provider or an explicit entry in EXPORT_COVERAGE_ALLOWLIST.`,
    ).toEqual([]);
  });

  it('AC-5: fails naming the unmapped table when a fixture table with client_id is not covered', () => {
    // Define a test-only fixture table with a client_id column
    const fixtureUnmappedTable = pgTable('fixture_unmapped_personal_data', {
      id: uuid('id').primaryKey(),
      clientId: uuid('client_id').notNull(),
      secretNotes: text('secret_notes'),
    });

    const mockSchema = {
      fixtureUnmappedTable,
    };

    const fixtureTables = findTablesWithSubjectReferences(mockSchema);
    expect(fixtureTables).toHaveLength(1);
    expect(fixtureTables[0]?.tableName).toBe('fixture_unmapped_personal_data');

    const providers = getExportProviders();
    const coveredTables = new Set(providers.flatMap((p) => p.coveredTables));
    const allowlistedTables = new Set(EXPORT_COVERAGE_ALLOWLIST.map((e) => e.tableName));

    const unmapped = checkCoverage(fixtureTables, coveredTables, allowlistedTables);

    expect(unmapped).toContain('fixture_unmapped_personal_data');
    expect(() => {
      if (unmapped.length > 0) {
        throw new Error(`Unmapped tables found: ${unmapped.join(', ')}`);
      }
    }).toThrow(/fixture_unmapped_personal_data/);
  });

  it('AC-5: fails naming the unmapped table when a fixture table with contact_id is not covered', () => {
    // Define a test-only fixture table with a contact_id column
    const fixtureContactTable = pgTable('fixture_unmapped_contact_records', {
      id: uuid('id').primaryKey(),
      contactId: uuid('contact_id').notNull(),
    });

    const mockSchema = {
      fixtureContactTable,
    };

    const fixtureTables = findTablesWithSubjectReferences(mockSchema);
    const coveredTables = new Set(getExportProviders().flatMap((p) => p.coveredTables));
    const allowlistedTables = new Set(EXPORT_COVERAGE_ALLOWLIST.map((e) => e.tableName));

    const unmapped = checkCoverage(fixtureTables, coveredTables, allowlistedTables);

    expect(unmapped).toContain('fixture_unmapped_contact_records');
  });

  it('AC-5: passes when a fixture table is properly registered or added to the allowlist with reason', () => {
    const fixtureTable = pgTable('fixture_allowed_table', {
      id: uuid('id').primaryKey(),
      clientId: uuid('client_id').notNull(),
    });

    const mockSchema = { fixtureTable };
    const fixtureTables = findTablesWithSubjectReferences(mockSchema);

    const coveredTables = new Set<string>();
    const allowlist = [
      {
        tableName: 'fixture_allowed_table',
        reason: 'Internal ephemeral indexing cache containing no independent personal data.',
      },
    ];

    expect(allowlist[0]?.reason.trim().length).toBeGreaterThan(10);

    const allowlistedTables = new Set(allowlist.map((e) => e.tableName));
    const unmapped = checkCoverage(fixtureTables, coveredTables, allowlistedTables);

    expect(unmapped).toHaveLength(0);
  });
});

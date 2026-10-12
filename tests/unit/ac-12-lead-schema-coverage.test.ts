import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { isTable } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '@/server/db/schema';
import { getExportProviders } from '@/server/privacy/export/registry';
import { EXPORT_COVERAGE_ALLOWLIST } from '@/server/privacy/export/allowlist';
import { getErasureProviders } from '@/server/privacy/erasure/registry';
import { ERASURE_COVERAGE_ALLOWLIST } from '@/server/privacy/erasure/allowlist';

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

describe('TASK-0026: Schema coverage for leads table (AC-12)', () => {
  it('AC-12: leads table is covered by export and erasure providers', () => {
    const subjectTables = findTablesWithSubjectReferences(schema);
    const leadsTable = subjectTables.find((t) => t.tableName === 'leads');
    expect(leadsTable).toBeDefined();
    expect(leadsTable?.columns).toContain('client_id');

    // 1. Export coverage
    const exportProviders = getExportProviders();
    const exportCovered = new Set(exportProviders.flatMap((p) => p.coveredTables));
    const exportAllowlisted = new Set(EXPORT_COVERAGE_ALLOWLIST.map((e) => e.tableName));
    expect(exportCovered.has('leads')).toBe(true);

    const exportUnmapped = checkCoverage(subjectTables, exportCovered, exportAllowlisted);
    expect(exportUnmapped).toEqual([]);

    // 2. Erasure coverage
    const erasureProviders = getErasureProviders();
    const erasureCovered = new Set(erasureProviders.flatMap((p) => p.coveredTables));
    const erasureAllowlisted = new Set(ERASURE_COVERAGE_ALLOWLIST.map((e) => e.tableName));
    expect(erasureCovered.has('leads')).toBe(true);

    const erasureUnmapped = checkCoverage(subjectTables, erasureCovered, erasureAllowlisted);
    expect(erasureUnmapped).toEqual([]);
  });

  it('AC-12: mutation check - removing converted-leads export provider causes coverage failure for leads', () => {
    const subjectTables = findTablesWithSubjectReferences(schema);

    // Mutation: remove converted-leads provider
    const mutatedExportProviders = getExportProviders().filter((p) => p.id !== 'converted-leads');
    const mutatedCovered = new Set(mutatedExportProviders.flatMap((p) => p.coveredTables));
    const exportAllowlisted = new Set(EXPORT_COVERAGE_ALLOWLIST.map((e) => e.tableName));

    const unmapped = checkCoverage(subjectTables, mutatedCovered, exportAllowlisted);
    expect(unmapped).toContain('leads');
  });

  it('AC-12: mutation check - removing converted-leads erasure provider causes coverage failure for leads', () => {
    const subjectTables = findTablesWithSubjectReferences(schema);

    // Mutation: remove converted-leads provider
    const mutatedErasureProviders = getErasureProviders().filter((p) => p.id !== 'converted-leads');
    const mutatedCovered = new Set(mutatedErasureProviders.flatMap((p) => p.coveredTables));
    const erasureAllowlisted = new Set(ERASURE_COVERAGE_ALLOWLIST.map((e) => e.tableName));

    const unmapped = checkCoverage(subjectTables, mutatedCovered, erasureAllowlisted);
    expect(unmapped).toContain('leads');
  });
});

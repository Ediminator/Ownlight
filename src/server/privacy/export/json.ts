import { dsarExportSchema, type DsarExport } from './schema';
import type { ExportCollectedData } from './types';

/**
 * Validates and formats the collected export data into the ownlight.dsar.v1 JSON format.
 */
export function generateJsonExport(data: ExportCollectedData): string {
  // Validate strictly against the DSAR schema
  const validated: DsarExport = dsarExportSchema.parse(data);
  return JSON.stringify(validated, null, 2);
}

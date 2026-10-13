import 'server-only';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { collectExportData } from './registry';
import { generateJsonExport } from './json';
import { generateHtmlExport } from './html';
import type { ExportCollectedData } from './types';

export interface GenerateExportOptions {
  contactId?: string;
  leadId?: string;
  format: 'json' | 'html';
  locale: 'en' | 'de';
  actorId: string;
  client?: DbClient;
}

export interface GenerateExportResult {
  content: string;
  filename: string;
  contentType: string;
  categoryCount: number;
  durationMs: number;
  exportData: ExportCollectedData;
}

/**
 * Orchestrates full personal data export generation:
 * 1. Collects personal data via domain provider registry (contact or lead)
 * 2. Formats as JSON or self-contained HTML
 * 3. Records privacy.export.generated audit event with allowlisted metadata
 * 4. Structured logging containing zero personal data
 */
export async function generateExport(
  options: GenerateExportOptions,
): Promise<GenerateExportResult | null> {
  const startTime = Date.now();
  const dbClient = options.client ?? defaultDb;

  const subjectId = options.leadId ?? options.contactId;
  if (!subjectId) {
    return null;
  }
  const isLead = typeof options.leadId === 'string';
  const subjectTarget = isLead ? { leadId: subjectId } : { contactId: subjectId };
  const subjectKind = isLead ? 'lead' : 'contact';

  // 1. Collect export data across registered domain providers
  const collected = await collectExportData(subjectTarget, dbClient);
  if (!collected) {
    return null;
  }

  const { exportData } = collected;
  const categoryCount = Object.keys(exportData.categories).length;

  // 2. Format export according to requested format
  let content: string;
  let contentType: string;

  if (options.format === 'json') {
    content = generateJsonExport(exportData);
    contentType = 'application/json; charset=utf-8';
  } else {
    content = generateHtmlExport(exportData, options.locale);
    contentType = 'text/html; charset=utf-8';
  }

  const durationMs = Date.now() - startTime;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `ownlight-data-export-${subjectId}-${dateStr}.${options.format}`;

  // 3. Emit audit event with allowlisted metadata only (AC-6)
  const auditMetadata: Record<string, unknown> = {
    format: options.format,
    locale: options.locale,
    category_count: categoryCount,
  };
  if (isLead) {
    auditMetadata.subject_kind = 'lead';
    auditMetadata.lead_id = options.leadId;
  } else {
    auditMetadata.contact_id = options.contactId;
  }

  await audit(
    {
      action: 'privacy.export.generated',
      actorType: 'owner',
      actorId: options.actorId,
      targetType: subjectKind,
      targetId: subjectId,
      outcome: 'success',
      metadata: auditMetadata,
    },
    dbClient,
  );

  // 4. Log duration, format, and subject ID ONLY; zero personal data (AC-7, AC-14)
  logger.info(
    {
      subjectId,
      subjectKind,
      format: options.format,
      locale: options.locale,
      durationMs,
      outcome: 'success',
    },
    'DSAR personal data export generated',
  );

  return {
    content,
    filename,
    contentType,
    categoryCount,
    durationMs,
    exportData,
  };
}

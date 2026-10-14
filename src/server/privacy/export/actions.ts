'use server';

import 'server-only';
import { headers } from 'next/headers';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  requireOwnerSession,
  extractBearerToken,
  ForbiddenError,
  type AuthContext,
} from '@/server/auth/guards';
import { generateExport } from './service';
import type { ExportCollectedData } from './types';

export interface ExportClientDataInput {
  clientId?: string;
  contactId?: string;
  format?: 'json' | 'html';
  locale?: 'en' | 'de';
}

export type ExportClientDataActionResult =
  | {
      success: true;
      data: {
        content: string;
        filename: string;
        contentType: string;
        downloadUrl: string;
        exportData: ExportCollectedData;
      };
      content: string;
      filename: string;
      contentType: string;
      downloadUrl: string;
      exportData: ExportCollectedData;
    }
  | {
      success: false;
      code: 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED';
      error: string;
      fields?: string[];
    };

async function checkBearerRejection(): Promise<boolean> {
  try {
    const reqHeaders = await headers();
    if (extractBearerToken(reqHeaders)) {
      return true;
    }
  } catch {
    // Outside Next.js request context
  }
  return false;
}

/**
 * Production DSAR export server action for clients and contacts (AC-1, AC-6, AC-7, AC-8).
 * Governed by Process Rule R-A.
 */
export async function exportClientDataAction(
  rawInput: unknown,
  client: DbClient = defaultDb,
): Promise<ExportClientDataActionResult> {
  if (await checkBearerRejection()) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: 'API keys are not permitted for data exports',
    };
  }

  let auth: AuthContext;
  try {
    auth = await requireOwnerSession({ client });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    return { success: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' };
  }

  let clientId: string | undefined;
  let contactId: string | undefined;
  let format: 'json' | 'html' = 'json';
  let locale: 'en' | 'de' = 'en';

  if (typeof rawInput === 'string') {
    clientId = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    const obj = rawInput as Record<string, unknown>;
    if (typeof obj.clientId === 'string') clientId = obj.clientId;
    if (typeof obj.contactId === 'string') contactId = obj.contactId;
    if (obj.format === 'json' || obj.format === 'html') format = obj.format;
    if (obj.locale === 'en' || obj.locale === 'de') locale = obj.locale;
  }

  if (!clientId && !contactId) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Either clientId or contactId must be provided',
      fields: ['clientId', 'contactId'],
    };
  }

  const result = await generateExport({
    clientId,
    contactId,
    format,
    locale,
    actorId: auth.user.id,
    client,
  });

  if (!result) {
    return {
      success: false,
      code: 'NOT_FOUND',
      error: 'Subject not found',
    };
  }

  const downloadUrl = `data:${result.contentType};utf8,${encodeURIComponent(result.content)}`;

  return {
    success: true,
    data: {
      content: result.content,
      filename: result.filename,
      contentType: result.contentType,
      downloadUrl,
      exportData: result.exportData,
    },
    content: result.content,
    filename: result.filename,
    contentType: result.contentType,
    downloadUrl,
    exportData: result.exportData,
  };
}

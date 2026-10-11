import type { DbClient } from '@/server/db/client';
import type { Client, ClientContact } from '@/server/db/schema/clients';

export interface ExportSubject {
  contactId: string;
  clientId: string;
  contact: ClientContact;
  client: Client;
}

export interface ExportProvider {
  id: string;
  category: string;
  coveredTables: readonly string[];
  collect: (subject: ExportSubject, tx: DbClient) => Promise<unknown[] | Record<string, unknown>>;
}

export interface DsarSubjectExport {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface DsarStudioExport {
  name: string;
}

export interface ExportCollectedData {
  schema: 'ownlight.dsar.v1';
  generated_at: string;
  studio: DsarStudioExport;
  subject: DsarSubjectExport;
  categories: Record<string, unknown[]>;
}

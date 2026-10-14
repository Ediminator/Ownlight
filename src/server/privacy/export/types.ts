import type { DbClient } from '@/server/db/client';
import type { Client, ClientContact } from '@/server/db/schema/clients';
import type { Lead } from '@/server/db/schema/leads';

export type ExportSubjectKind = 'client' | 'contact' | 'lead';

export interface ContactExportSubject {
  kind?: 'contact' | 'client';
  contactId: string;
  clientId: string;
  contact: ClientContact;
  client: Client;
}

export interface LeadExportSubject {
  kind: 'lead';
  leadId: string;
  lead: Lead;
}

export type ExportSubject = ContactExportSubject | LeadExportSubject;

export interface ExportProvider {
  id: string;
  category: string;
  coveredTables: readonly string[];
  subjectKinds?: readonly ExportSubjectKind[];
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

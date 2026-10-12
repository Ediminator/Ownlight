import 'server-only';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import type { ExportProvider, ExportSubject } from '@/server/privacy/export/types';

/**
 * DSAR Export provider for Google Contacts sync (TASK-0015 / TASK-0021 AC-8).
 * Discloses Google LLC as an external third-party recipient under GDPR Art. 15(1)(c),
 * documenting the purpose, lawful basis (Art. 6(1)(f)), transfer safeguards (EU-US DPF/SCCs),
 * and strictly minimized data categories transferred.
 */
export const googleContactsExportProvider: ExportProvider = {
  id: 'google_contacts',
  category: 'google_contacts',
  coveredTables: ['google_contacts_links'],

  collect: async (subject: ExportSubject, tx: DbClient): Promise<unknown[]> => {
    const [link] = await tx
      .select({
        googleResourceName: googleContactsLinks.googleResourceName,
        lastSyncedAt: googleContactsLinks.lastSyncedAt,
      })
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, subject.contactId))
      .limit(1);

    if (!link) {
      return [];
    }

    return [
      {
        recipient: 'Google LLC',
        recipient_address: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
        purpose: 'Mobile device caller ID identification during shoot days',
        lawful_basis:
          'Art. 6(1)(f) GDPR (Legitimate interests: operational shoot day communication)',
        transfer_safeguards:
          'EU-US Data Privacy Framework (DPF) / Standard Contractual Clauses (SCCs)',
        categories_transmitted: 'given name, family name, phone number(s)',
        google_resource_name: link.googleResourceName,
        last_synced_at: link.lastSyncedAt.toISOString(),
      },
    ];
  },
};

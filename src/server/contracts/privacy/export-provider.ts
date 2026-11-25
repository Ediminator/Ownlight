import 'server-only';
import { eq, inArray, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contracts } from '@/server/db/schema/contracts';
import { projects } from '@/server/db/schema/projects';
import type { ExportProvider, ExportSubject } from '@/server/privacy/export/types';
import { escapeHtml } from '@/server/privacy/export/html';
import { formatDate } from '@/lib/formatters';

export interface FormattedContractExport {
  id: string;
  project_id: string;
  project_title: string | null;
  contract_number: string;
  title: string;
  locale: string;
  status: string;
  valid_until: string | null;
  sent_at: string | null;
  signed_at: string | null;
  studio_signed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signature_type: string | null;
  canonical_body_sha256: string;
  pdf_sha256: string | null;
  created_at: string;
}

export const CONTRACT_EXPORT_HEADERS = {
  en: {
    contractNumber: 'Contract Number',
    title: 'Title',
    project: 'Project',
    status: 'Status',
    sentAt: 'Sent Date',
    signedAt: 'Signed Date',
    signer: 'Signed By',
    verificationHash: 'Verification Hash (SHA-256)',
  },
  de: {
    contractNumber: 'Vertragsnummer',
    title: 'Titel',
    project: 'Projekt',
    status: 'Status',
    sentAt: 'Gesendet am',
    signedAt: 'Unterzeichnet am',
    signer: 'Unterzeichnet von',
    verificationHash: 'Prüfsumme (SHA-256)',
  },
} as const;

export const CONTRACT_STATUS_LABELS = {
  en: {
    draft: 'Draft',
    sent: 'Sent',
    signed_by_client: 'Signed by Client',
    signed: 'Signed',
    declined: 'Declined',
    voided: 'Voided',
    superseded: 'Superseded',
  },
  de: {
    draft: 'Entwurf',
    sent: 'Versendet',
    signed_by_client: 'Vom Kunden unterzeichnet',
    signed: 'Unterzeichnet',
    declined: 'Abgelehnt',
    voided: 'Storniert',
    superseded: 'Ersetzt',
  },
} as const;

/**
 * Formats an accessible, localized HTML table for contracts DSAR exports (en and de).
 */
export function formatContractsHtml(
  items: FormattedContractExport[],
  locale: 'en' | 'de' = 'en',
): string {
  if (items.length === 0) {
    return locale === 'de'
      ? '<p class="empty-notice">In dieser Kategorie sind derzeit keine Datensätze gespeichert.</p>'
      : '<p class="empty-notice">No records stored in this category.</p>';
  }

  const h = locale === 'de' ? CONTRACT_EXPORT_HEADERS.de : CONTRACT_EXPORT_HEADERS.en;
  const statusLabels = locale === 'de' ? CONTRACT_STATUS_LABELS.de : CONTRACT_STATUS_LABELS.en;
  const statusMap = new Map(Object.entries(statusLabels));

  const thead = `
    <tr>
      <th scope="col">${escapeHtml(h.contractNumber)}</th>
      <th scope="col">${escapeHtml(h.title)}</th>
      <th scope="col">${escapeHtml(h.project)}</th>
      <th scope="col">${escapeHtml(h.status)}</th>
      <th scope="col">${escapeHtml(h.sentAt)}</th>
      <th scope="col">${escapeHtml(h.signedAt)}</th>
      <th scope="col">${escapeHtml(h.signer)}</th>
      <th scope="col">${escapeHtml(h.verificationHash)}</th>
    </tr>
  `;

  const tbody = items
    .map((item) => {
      const statusText = statusMap.get(item.status) ?? item.status;
      const formattedSentAt = item.sent_at ? formatDate(item.sent_at, locale) : '-';
      const formattedSignedAt = item.signed_at ? formatDate(item.signed_at, locale) : '-';

      const signerText =
        item.signer_name || item.signer_email
          ? [item.signer_name, item.signer_email ? `(${item.signer_email})` : null]
              .filter(Boolean)
              .join(' ')
          : '-';

      const hashParts = [item.canonical_body_sha256];
      if (item.pdf_sha256) {
        hashParts.push(`PDF: ${item.pdf_sha256}`);
      }

      return `<tr>
        <td><code>${escapeHtml(item.contract_number)}</code></td>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td>${escapeHtml(item.project_title ?? '-')}</td>
        <td>${escapeHtml(statusText)}</td>
        <td>${escapeHtml(formattedSentAt)}</td>
        <td>${escapeHtml(formattedSignedAt)}</td>
        <td>${escapeHtml(signerText)}</td>
        <td><code>${escapeHtml(hashParts.join(' | '))}</code></td>
      </tr>`;
    })
    .join('');

  const regionLabel = locale === 'de' ? 'Verträge & Signaturen' : 'Contracts & Signatures';

  return `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escapeHtml(regionLabel)}">
  <table class="data-table">
    <thead>
      ${thead}
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>
</div>`;
}

/**
 * DSAR Export Provider for contracts & electronic signatures (TASK-0066 / GDPR Art. 15 / ADR-0019 §7.1).
 * Exports client and contact contracts adhering to ownlight.dsar.v1 while strictly omitting
 * internal secret tokens (token_hash), private internal_notes, and internal pdf_storage_key.
 */
export const contractsExportProvider: ExportProvider = {
  id: 'contracts',
  category: 'contracts',
  coveredTables: ['contracts'] as const,
  subjectKinds: ['client', 'contact'] as const,

  collect: async (subject: ExportSubject, tx: DbClient): Promise<FormattedContractExport[]> => {
    if (subject.kind === 'lead') {
      return [];
    }

    const clientContracts = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.clientId, subject.clientId))
      .orderBy(asc(contracts.createdAt));

    if (clientContracts.length === 0) {
      return [];
    }

    const projectIds = Array.from(new Set(clientContracts.map((c) => c.projectId)));
    const projectRows = await tx
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    const projectMap = new Map(projectRows.map((p) => [p.id, p.title]));

    return clientContracts.map((c) => ({
      id: c.id,
      project_id: c.projectId,
      project_title: projectMap.get(c.projectId) ?? null,
      contract_number: c.contractNumber,
      title: c.title,
      locale: c.locale,
      status: c.status,
      valid_until: c.validUntil ? c.validUntil.toISOString() : null,
      sent_at: c.sentAt ? c.sentAt.toISOString() : null,
      signed_at: c.clientSignedAt ? c.clientSignedAt.toISOString() : null,
      studio_signed_at: c.studioSignedAt ? c.studioSignedAt.toISOString() : null,
      signer_name: c.clientSignerName ?? null,
      signer_email: c.clientSignerEmail ?? null,
      signature_type: c.clientSignatureType ?? null,
      canonical_body_sha256: c.canonicalBodySha256,
      pdf_sha256: c.pdfSha256 ?? null,
      created_at: c.createdAt.toISOString(),
    }));
  },
};

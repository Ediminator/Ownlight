import 'server-only';
import { eq, inArray, asc } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { projects } from '@/server/db/schema/projects';
import type { ExportProvider, ExportSubject } from '@/server/privacy/export/types';
import { escapeHtml } from '@/server/privacy/export/html';
import { formatCurrency, formatDate } from '@/lib/formatters';

export interface ProposalLineItemExport {
  id: string;
  proposal_id: string;
  name: string;
  item_name: string;
  item_type: string;
  description: string | null;
  unit_price: number;
  unit_price_minor: number;
  quantity: number;
  tax_rate: number;
  tax_rate_basis_points: number;
  is_optional: boolean;
  is_selected: boolean;
  selection_state: boolean;
  position: number;
}

export interface FormattedProposalExport {
  id: string;
  project_id: string;
  project_title: string | null;
  title: string;
  status: string;
  currency: string;
  subtotal: number;
  subtotal_minor: number;
  tax: number;
  tax_minor: number;
  total: number;
  total_minor: number;
  prices_include_tax: boolean;
  is_kleinunternehmer: boolean;
  valid_until: string | null;
  validity_date: string | null;
  sent_at: string | null;
  sent_date: string | null;
  accepted_at: string | null;
  acceptance_timestamp: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  acceptance_ip_anonymized: string | null;
  anonymized_ip: string | null;
  acceptance_user_agent: string | null;
  user_agent: string | null;
  line_items: ProposalLineItemExport[];
  created_at: string;
  updated_at: string;

  // Human-readable summary columns for DSAR table views
  proposal?: string;
  project?: string;
}

export const PROPOSAL_EXPORT_HEADERS = {
  en: {
    proposal: 'Proposal',
    project: 'Project',
    status: 'Status',
    subtotal: 'Subtotal',
    tax: 'Tax',
    total: 'Total',
    validUntil: 'Valid Until',
    sentAt: 'Sent Date',
    acceptedAt: 'Accepted Date',
    acceptedBy: 'Accepted By',
    deliverables: 'Deliverables & Line Items',
  },
  de: {
    proposal: 'Angebot',
    project: 'Projekt',
    status: 'Status',
    subtotal: 'Zwischensumme',
    tax: 'Umsatzsteuer',
    total: 'Gesamtbetrag',
    validUntil: 'Gültig bis',
    sentAt: 'Gesendet am',
    acceptedAt: 'Angenommen am',
    acceptedBy: 'Angenommen von',
    deliverables: 'Leistungen & Positionen',
  },
} as const;

export const PROPOSAL_STATUS_LABELS = {
  en: {
    draft: 'Draft',
    sent: 'Sent',
    accepted: 'Accepted',
    declined: 'Declined',
    expired: 'Expired',
    superseded: 'Superseded',
  },
  de: {
    draft: 'Entwurf',
    sent: 'Versendet',
    accepted: 'Angenommen',
    declined: 'Abgelehnt',
    expired: 'Abgelaufen',
    superseded: 'Ersetzt',
  },
} as const;

/**
 * Formats a clean, accessible HTML table for proposals DSAR exports.
 */
export function formatProposalsHtml(
  items: FormattedProposalExport[],
  locale: 'en' | 'de' = 'en',
): string {
  if (items.length === 0) {
    return locale === 'de'
      ? '<p class="empty-notice">In dieser Kategorie sind derzeit keine Datensätze gespeichert.</p>'
      : '<p class="empty-notice">No records stored in this category.</p>';
  }

  const h = locale === 'de' ? PROPOSAL_EXPORT_HEADERS.de : PROPOSAL_EXPORT_HEADERS.en;
  const statusLabels = locale === 'de' ? PROPOSAL_STATUS_LABELS.de : PROPOSAL_STATUS_LABELS.en;
  const numLocale = locale === 'de' ? 'de-DE' : 'en-US';

  const thead = `
    <tr>
      <th scope="col">${escapeHtml(h.proposal)}</th>
      <th scope="col">${escapeHtml(h.project)}</th>
      <th scope="col">${escapeHtml(h.status)}</th>
      <th scope="col">${escapeHtml(h.total)}</th>
      <th scope="col">${escapeHtml(h.validUntil)}</th>
      <th scope="col">${escapeHtml(h.acceptedAt)}</th>
      <th scope="col">${escapeHtml(h.acceptedBy)}</th>
      <th scope="col">${escapeHtml(h.deliverables)}</th>
    </tr>
  `;

  const statusMap = new Map(Object.entries(statusLabels));

  const tbody = items
    .map((item) => {
      const statusText = statusMap.get(item.status) ?? item.status;
      const formattedTotal = formatCurrency(item.total_minor, item.currency, numLocale);
      const formattedValidUntil = item.valid_until ? formatDate(item.valid_until, locale) : '-';
      const formattedAcceptedAt = item.accepted_at ? formatDate(item.accepted_at, locale) : '-';

      let acceptedByText = '-';
      if (item.accepted_by_name || item.accepted_by_email) {
        acceptedByText = [
          item.accepted_by_name,
          item.accepted_by_email ? `(${item.accepted_by_email})` : null,
        ]
          .filter(Boolean)
          .join(' ');
      }

      const deliverablesText =
        item.line_items.length > 0
          ? item.line_items
              .map((li) => {
                const price = formatCurrency(li.unit_price_minor, item.currency, numLocale);
                return `${li.item_name} (×${String(li.quantity)}, ${price})`;
              })
              .join('; ')
          : '-';

      return `<tr>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td>${escapeHtml(item.project_title ?? '-')}</td>
        <td>${escapeHtml(statusText)}</td>
        <td>${escapeHtml(formattedTotal)}</td>
        <td>${escapeHtml(formattedValidUntil)}</td>
        <td>${escapeHtml(formattedAcceptedAt)}</td>
        <td>${escapeHtml(acceptedByText)}</td>
        <td>${escapeHtml(deliverablesText)}</td>
      </tr>`;
    })
    .join('');

  const regionLabel = locale === 'de' ? 'Angebote & Kostenvoranschläge' : 'Proposals & Quotes';

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
 * DSAR Export Provider for proposals & quotes (TASK-0059 / GDPR Art. 15 / ADR-0018 §6).
 * Exports all proposals and line items for the data subject (client or contact).
 */
export const proposalsExportProvider: ExportProvider = {
  id: 'proposals',
  category: 'proposals',
  coveredTables: ['proposals', 'proposal_line_items'] as const,
  subjectKinds: ['client', 'contact'] as const,

  collect: async (subject: ExportSubject, tx: DbClient): Promise<FormattedProposalExport[]> => {
    if (subject.kind === 'lead') {
      return [];
    }

    // Both client and contact subjects map proposals by clientId
    const clientProposals = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.clientId, subject.clientId))
      .orderBy(asc(proposals.createdAt));

    if (clientProposals.length === 0) {
      return [];
    }

    const proposalIds = clientProposals.map((p) => p.id);
    const projectIds = Array.from(new Set(clientProposals.map((p) => p.projectId)));

    // Fetch line items
    const allLineItems = await tx
      .select()
      .from(proposalLineItems)
      .where(inArray(proposalLineItems.proposalId, proposalIds))
      .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

    // Fetch project titles
    const projectRows = await tx
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    const projectMap = new Map(projectRows.map((p) => [p.id, p.title]));

    return clientProposals.map((p) => {
      const itemsForProposal = allLineItems.filter((li) => li.proposalId === p.id);
      const projectTitle = projectMap.get(p.projectId) ?? null;

      const lineItems: ProposalLineItemExport[] = itemsForProposal.map((li) => ({
        id: li.id,
        proposal_id: li.proposalId,
        name: li.name,
        item_name: li.name,
        item_type: li.itemType,
        description: li.description ?? null,
        unit_price: li.unitPriceMinor,
        unit_price_minor: li.unitPriceMinor,
        quantity: li.quantity,
        tax_rate: li.taxRateBasisPoints,
        tax_rate_basis_points: li.taxRateBasisPoints,
        is_optional: li.isOptional,
        is_selected: li.isSelected,
        selection_state: li.isSelected,
        position: li.position,
      }));

      return {
        id: p.id,
        project_id: p.projectId,
        project_title: projectTitle,
        title: p.title,
        status: p.status,
        currency: p.currency,
        subtotal: p.subtotalMinor,
        subtotal_minor: p.subtotalMinor,
        tax: p.taxMinor,
        tax_minor: p.taxMinor,
        total: p.totalMinor,
        total_minor: p.totalMinor,
        prices_include_tax: p.pricesIncludeTax,
        is_kleinunternehmer: p.isKleinunternehmer,
        valid_until: p.validUntil ? p.validUntil.toISOString() : null,
        validity_date: p.validUntil ? p.validUntil.toISOString() : null,
        sent_at: p.sentAt ? p.sentAt.toISOString() : null,
        sent_date: p.sentAt ? p.sentAt.toISOString() : null,
        accepted_at: p.acceptedAt ? p.acceptedAt.toISOString() : null,
        acceptance_timestamp: p.acceptedAt ? p.acceptedAt.toISOString() : null,
        declined_at: p.declinedAt ? p.declinedAt.toISOString() : null,
        decline_reason: p.declineReason ?? null,
        accepted_by_name: p.acceptedByName ?? null,
        accepted_by_email: p.acceptedByEmail ?? null,
        acceptance_ip_anonymized: p.acceptanceIpAnonymized ?? null,
        anonymized_ip: p.acceptanceIpAnonymized ?? null,
        acceptance_user_agent: p.acceptanceUserAgent ?? null,
        user_agent: p.acceptanceUserAgent ?? null,
        line_items: lineItems,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),

        // High-level summary columns matching AC-1 / AC-2
        proposal: p.title,
        project: projectTitle ?? '-',
      };
    });
  },
};

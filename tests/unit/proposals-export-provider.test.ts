import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  proposalsExportProvider,
  PROPOSAL_EXPORT_HEADERS,
  formatProposalsHtml,
  type FormattedProposalExport,
} from '@/server/proposals/privacy';
import { getCategoryDefinition } from '@/server/privacy/export/categories';
import { formatColumnHeader } from '@/server/privacy/export/html';
import { dsarExportSchema } from '@/server/privacy/export/schema';
import { generateJsonExport } from '@/server/privacy/export/json';
import type { ExportCollectedData } from '@/server/privacy/export/types';
import type { DbClient } from '@/server/db/client';

describe('TASK-0059: Proposals DSAR Export Provider (AC-1, AC-2)', () => {
  const mockProposals = [
    {
      id: '01910000-0000-7000-8000-000000000001',
      projectId: '01910000-0000-7000-8000-000000000010',
      clientId: '01910000-0000-7000-8000-0000000000aa',
      title: 'Full Day Wedding Photography',
      status: 'accepted',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 250000,
      taxMinor: 47500,
      totalMinor: 297500,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      taxNotice: null,
      validUntil: new Date('2026-06-30T23:59:59.000Z'),
      tokenHash: 'tokenhash123',
      tokenRevokedAt: null,
      sentAt: new Date('2026-05-01T10:00:00.000Z'),
      acceptedAt: new Date('2026-05-15T14:30:00.000Z'),
      declinedAt: null,
      declineReason: null,
      acceptedByName: 'Alice Smith',
      acceptedByEmail: 'alice@example.com',
      acceptanceIpAnonymized: '192.168.1.0/24',
      acceptanceUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      acceptedOptionsSnapshot: null,
      internalNotes: 'Client booked via referral',
      createdAt: new Date('2026-05-01T09:00:00.000Z'),
      updatedAt: new Date('2026-05-15T14:30:00.000Z'),
    },
    {
      id: '01910000-0000-7000-8000-000000000002',
      projectId: '01910000-0000-7000-8000-000000000099',
      clientId: '01910000-0000-7000-8000-0000000000aa',
      title: 'Engagement Shoot Add-on',
      status: 'declined',
      version: 1,
      currency: 'EUR',
      subtotalMinor: 40000,
      taxMinor: 7600,
      totalMinor: 47600,
      pricesIncludeTax: true,
      isKleinunternehmer: false,
      taxNotice: null,
      validUntil: null,
      tokenHash: 'tokenhash456',
      tokenRevokedAt: null,
      sentAt: null,
      acceptedAt: null,
      declinedAt: new Date('2026-06-01T12:00:00.000Z'),
      declineReason: 'Client chose alternative photographer',
      acceptedByName: null,
      acceptedByEmail: null,
      acceptanceIpAnonymized: null,
      acceptanceUserAgent: null,
      acceptedOptionsSnapshot: null,
      internalNotes: null,
      createdAt: new Date('2026-05-20T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    },
  ];

  const mockLineItems = [
    {
      id: '01910000-0000-7000-8000-00000000000a',
      proposalId: '01910000-0000-7000-8000-000000000001',
      packageId: '01910000-0000-7000-8000-0000000000c1',
      catalogueItemId: null,
      itemType: 'base_package',
      name: '8-Hour Wedding Coverage',
      description: 'Includes 2 photographers and online gallery',
      unitPriceMinor: 250000,
      quantity: 1,
      minQuantity: 1,
      maxQuantity: 1,
      taxRateBasisPoints: 1900,
      isOptional: false,
      isSelected: true,
      position: 0,
      createdAt: new Date('2026-05-01T09:00:00.000Z'),
      updatedAt: new Date('2026-05-01T09:00:00.000Z'),
    },
    {
      id: '01910000-0000-7000-8000-00000000000b',
      proposalId: '01910000-0000-7000-8000-000000000002',
      packageId: null,
      catalogueItemId: null,
      itemType: 'addon',
      name: 'Sunset Mini Session',
      description: null,
      unitPriceMinor: 40000,
      quantity: 1,
      minQuantity: 0,
      maxQuantity: 1,
      taxRateBasisPoints: 1900,
      isOptional: true,
      isSelected: false,
      position: 0,
      createdAt: new Date('2026-05-20T10:00:00.000Z'),
      updatedAt: new Date('2026-05-20T10:00:00.000Z'),
    },
  ];

  function createMockTx(
    proposalsList = mockProposals,
    lineItemsList = mockLineItems,
    projectTitle = 'Emma & Liam Wedding',
  ): DbClient {
    let callIndex = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            callIndex++;
            if (callIndex === 1) {
              // proposals query
              return {
                orderBy: () => Promise.resolve(proposalsList),
              };
            }
            if (callIndex === 2) {
              // line items query
              return {
                orderBy: () => Promise.resolve(lineItemsList),
              };
            }
            if (callIndex === 3) {
              // project titles query
              return Promise.resolve([
                { id: '01910000-0000-7000-8000-000000000010', title: projectTitle },
              ]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    } as unknown as DbClient;
  }

  describe('Category registration & i18n disclosures', () => {
    it('AC-1: proposals category is registered with statutory Art. 15 disclosures', () => {
      const def = getCategoryDefinition('proposals');
      expect(def).toBeDefined();
      expect(def?.id).toBe('proposals');
      expect(def?.title.en).toBe('Proposals & Quotes');
      expect(def?.title.de).toBe('Angebote & Kostenvoranschläge');
      expect(def?.purpose.en).toContain('proposals');
      expect(def?.purpose.de).toContain('Angeboten');
      expect(def?.lawfulBasis.en).toContain('Art. 6(1)(b) GDPR');
      expect(def?.lawfulBasis.de).toContain('Art. 6 Abs. 1 lit. b DSGVO');
      expect(def?.retention.en).toContain('§ 147 AO');
      expect(def?.retention.de).toContain('§ 147 AO');
      expect(def?.recipients.en).toContain('None (stored locally');
      expect(def?.recipients.de).toContain('Keine (ausschließlich lokale');
      expect(def?.source.en).toContain('studio owner and client');
      expect(def?.source.de).toContain('Studioinhaber und Kunden');
    });

    it('AC-2: formatColumnHeader localizes proposal column headers into German', () => {
      expect(formatColumnHeader('proposal', 'de')).toBe('Angebot');
      expect(formatColumnHeader('proposal_title', 'de')).toBe('Angebot');
      expect(formatColumnHeader('subtotal', 'de')).toBe('Zwischensumme');
      expect(formatColumnHeader('tax', 'de')).toBe('Umsatzsteuer');
      expect(formatColumnHeader('total', 'de')).toBe('Gesamtbetrag');
      expect(formatColumnHeader('valid_until', 'de')).toBe('Gültig bis');
      expect(formatColumnHeader('sent_at', 'de')).toBe('Gesendet am');
      expect(formatColumnHeader('accepted_at', 'de')).toBe('Angenommen am');
      expect(formatColumnHeader('accepted_by', 'de')).toBe('Angenommen von');

      // English fallback
      expect(formatColumnHeader('proposal', 'en')).toBe('Proposal');
      expect(formatColumnHeader('subtotal', 'en')).toBe('Subtotal');
      expect(formatColumnHeader('tax', 'en')).toBe('Tax');
      expect(formatColumnHeader('total', 'en')).toBe('Total');

      expect(PROPOSAL_EXPORT_HEADERS.de.proposal).toBe('Angebot');
      expect(PROPOSAL_EXPORT_HEADERS.en.proposal).toBe('Proposal');
    });
  });

  describe('AC-1: Structured JSON export matching ownlight.dsar.v1', () => {
    it('AC-1: exports structured JSON matching ownlight.dsar.v1 with proposals, line items, and acceptance metadata', async () => {
      const mockTx = createMockTx();
      const subject = {
        kind: 'client' as const,
        clientId: '01910000-0000-7000-8000-0000000000aa',
        contactId: '01910000-0000-7000-8000-0000000000bb',
        contact: {} as never,
        client: {} as never,
      };

      const items = (await proposalsExportProvider.collect(
        subject,
        mockTx,
      )) as FormattedProposalExport[];

      expect(items).toHaveLength(2);

      const acceptedProposal = items[0];
      if (!acceptedProposal) throw new Error('Expected acceptedProposal');

      expect(acceptedProposal.id).toBe('01910000-0000-7000-8000-000000000001');
      expect(acceptedProposal.project_id).toBe('01910000-0000-7000-8000-000000000010');
      expect(acceptedProposal.title).toBe('Full Day Wedding Photography');
      expect(acceptedProposal.status).toBe('accepted');
      expect(acceptedProposal.currency).toBe('EUR');
      expect(acceptedProposal.subtotal).toBe(250000);
      expect(acceptedProposal.subtotal_minor).toBe(250000);
      expect(acceptedProposal.tax).toBe(47500);
      expect(acceptedProposal.tax_minor).toBe(47500);
      expect(acceptedProposal.total).toBe(297500);
      expect(acceptedProposal.total_minor).toBe(297500);
      expect(acceptedProposal.valid_until).toBe('2026-06-30T23:59:59.000Z');
      expect(acceptedProposal.sent_at).toBe('2026-05-01T10:00:00.000Z');
      expect(acceptedProposal.accepted_at).toBe('2026-05-15T14:30:00.000Z');
      expect(acceptedProposal.acceptance_timestamp).toBe('2026-05-15T14:30:00.000Z');
      expect(acceptedProposal.accepted_by_name).toBe('Alice Smith');
      expect(acceptedProposal.accepted_by_email).toBe('alice@example.com');
      expect(acceptedProposal.acceptance_ip_anonymized).toBe('192.168.1.0/24');
      expect(acceptedProposal.anonymized_ip).toBe('192.168.1.0/24');
      expect(acceptedProposal.acceptance_user_agent).toContain('Mozilla/5.0');
      expect(acceptedProposal.user_agent).toContain('Mozilla/5.0');

      // Line items check
      expect(acceptedProposal.line_items).toHaveLength(1);
      const li = acceptedProposal.line_items[0];
      if (!li) throw new Error('Expected line item');
      expect(li.item_name).toBe('8-Hour Wedding Coverage');
      expect(li.description).toBe('Includes 2 photographers and online gallery');
      expect(li.unit_price).toBe(250000);
      expect(li.quantity).toBe(1);
      expect(li.tax_rate).toBe(1900);
      expect(li.is_selected).toBe(true);
      expect(li.selection_state).toBe(true);

      // Verify overall DSAR JSON export matches schema
      const collectedData: ExportCollectedData = {
        schema: 'ownlight.dsar.v1',
        generated_at: new Date().toISOString(),
        studio: { name: 'Sunset Studio' },
        subject: {
          id: '01910000-0000-7000-8000-0000000000aa',
          display_name: 'Alice Smith',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: null,
          role: 'client',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        categories: {
          proposals: items,
        },
      };

      const jsonString = generateJsonExport(collectedData);
      const parsed = JSON.parse(jsonString) as unknown;
      const parseResult = dsarExportSchema.safeParse(parsed);
      expect(parseResult.success).toBe(true);
    });

    it('AC-1: handles contact subject correctly by scoping proposals to clientId', async () => {
      const mockTx = createMockTx();
      const subject = {
        kind: 'contact' as const,
        contactId: '01910000-0000-7000-8000-0000000000bb',
        clientId: '01910000-0000-7000-8000-0000000000aa',
        contact: {} as never,
        client: {} as never,
      };

      const items = (await proposalsExportProvider.collect(
        subject,
        mockTx,
      )) as FormattedProposalExport[];
      expect(items).toHaveLength(2);
    });

    it('AC-1: returns empty array for lead subjects', async () => {
      const mockTx = {} as DbClient;
      const subject = {
        kind: 'lead' as const,
        leadId: '01910000-0000-7000-8000-0000000000cc',
        lead: {} as never,
      };

      const items = await proposalsExportProvider.collect(subject, mockTx);
      expect(items).toEqual([]);
    });

    it('AC-1: returns empty array when client has zero proposals', async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const subject = {
        kind: 'client' as const,
        clientId: '01910000-0000-7000-8000-0000000000empty',
        contactId: '01910000-0000-7000-8000-0000000000empty',
        contact: {} as never,
        client: {} as never,
      };

      const items = await proposalsExportProvider.collect(subject, mockTx);
      expect(items).toEqual([]);
    });
  });

  describe('AC-2: Human-readable localized HTML export table (en/de)', () => {
    it('AC-2: renders accessible HTML table in English with currency formatting and line items', () => {
      const sampleItems: FormattedProposalExport[] = [
        {
          id: '01910000-0000-7000-8000-000000000001',
          project_id: '01910000-0000-7000-8000-000000000010',
          project_title: 'Emma & Liam Wedding',
          title: 'Full Day Wedding Photography',
          status: 'accepted',
          currency: 'EUR',
          subtotal: 250000,
          subtotal_minor: 250000,
          tax: 47500,
          tax_minor: 47500,
          total: 297500,
          total_minor: 297500,
          prices_include_tax: true,
          is_kleinunternehmer: false,
          valid_until: '2026-06-30T23:59:59.000Z',
          validity_date: '2026-06-30T23:59:59.000Z',
          sent_at: '2026-05-01T10:00:00.000Z',
          sent_date: '2026-05-01T10:00:00.000Z',
          accepted_at: '2026-05-15T14:30:00.000Z',
          acceptance_timestamp: '2026-05-15T14:30:00.000Z',
          declined_at: null,
          decline_reason: null,
          accepted_by_name: 'Alice Smith',
          accepted_by_email: 'alice@example.com',
          acceptance_ip_anonymized: '192.168.1.0/24',
          anonymized_ip: '192.168.1.0/24',
          acceptance_user_agent: 'Mozilla/5.0',
          user_agent: 'Mozilla/5.0',
          line_items: [
            {
              id: 'li-1',
              proposal_id: '01910000-0000-7000-8000-000000000001',
              name: '8-Hour Wedding Coverage',
              item_name: '8-Hour Wedding Coverage',
              item_type: 'base_package',
              description: 'Includes 2 photographers',
              unit_price: 250000,
              unit_price_minor: 250000,
              quantity: 1,
              tax_rate: 1900,
              tax_rate_basis_points: 1900,
              is_optional: false,
              is_selected: true,
              selection_state: true,
              position: 0,
            },
          ],
          created_at: '2026-05-01T09:00:00.000Z',
          updated_at: '2026-05-15T14:30:00.000Z',
        },
      ];

      const htmlEn = formatProposalsHtml(sampleItems, 'en');

      expect(htmlEn).toContain('Full Day Wedding Photography');
      expect(htmlEn).toContain('Emma &amp; Liam Wedding');
      expect(htmlEn).toContain('Accepted');
      expect(htmlEn).toContain('€2,975.00'); // Proper currency formatting
      expect(htmlEn).toContain('8-Hour Wedding Coverage');
      expect(htmlEn).toContain('Alice Smith');
      expect(htmlEn).toContain('alice@example.com');
      expect(htmlEn).toContain('<table class="data-table">');
      expect(htmlEn).toContain('aria-label="Proposals &amp; Quotes"');
    });

    it('AC-2: renders accessible HTML table in German with German currency formatting and line items', () => {
      const sampleItems: FormattedProposalExport[] = [
        {
          id: '01910000-0000-7000-8000-000000000001',
          project_id: '01910000-0000-7000-8000-000000000010',
          project_title: 'Hochzeit Emma & Liam',
          title: 'Ganztägige Hochzeitsfotografie',
          status: 'accepted',
          currency: 'EUR',
          subtotal: 250000,
          subtotal_minor: 250000,
          tax: 47500,
          tax_minor: 47500,
          total: 297500,
          total_minor: 297500,
          prices_include_tax: true,
          is_kleinunternehmer: false,
          valid_until: '2026-06-30T23:59:59.000Z',
          validity_date: '2026-06-30T23:59:59.000Z',
          sent_at: '2026-05-01T10:00:00.000Z',
          sent_date: '2026-05-01T10:00:00.000Z',
          accepted_at: '2026-05-15T14:30:00.000Z',
          acceptance_timestamp: '2026-05-15T14:30:00.000Z',
          declined_at: null,
          decline_reason: null,
          accepted_by_name: 'Alice Smith',
          accepted_by_email: 'alice@example.com',
          acceptance_ip_anonymized: '192.168.1.0/24',
          anonymized_ip: '192.168.1.0/24',
          acceptance_user_agent: 'Mozilla/5.0',
          user_agent: 'Mozilla/5.0',
          line_items: [
            {
              id: 'li-1',
              proposal_id: '01910000-0000-7000-8000-000000000001',
              name: '8 Stunden Reportage',
              item_name: '8 Stunden Reportage',
              item_type: 'base_package',
              description: 'Inkl. 2 Fotografen',
              unit_price: 250000,
              unit_price_minor: 250000,
              quantity: 1,
              tax_rate: 1900,
              tax_rate_basis_points: 1900,
              is_optional: false,
              is_selected: true,
              selection_state: true,
              position: 0,
            },
          ],
          created_at: '2026-05-01T09:00:00.000Z',
          updated_at: '2026-05-15T14:30:00.000Z',
        },
      ];

      const htmlDe = formatProposalsHtml(sampleItems, 'de');

      expect(htmlDe).toContain('Ganztägige Hochzeitsfotografie');
      expect(htmlDe).toContain('Hochzeit Emma &amp; Liam');
      expect(htmlDe).toContain('Angenommen');
      expect(htmlDe).toContain('2.975,00 €'); // German currency formatting
      expect(htmlDe).toContain('8 Stunden Reportage');
      expect(htmlDe).toContain('Alice Smith');
      expect(htmlDe).toContain('alice@example.com');
      expect(htmlDe).toContain('aria-label="Angebote &amp; Kostenvoranschläge"');
    });

    it('AC-2: renders empty notice when items array is empty', () => {
      const emptyEn = formatProposalsHtml([], 'en');
      expect(emptyEn).toContain('No records stored in this category.');

      const emptyDe = formatProposalsHtml([], 'de');
      expect(emptyDe).toContain('In dieser Kategorie sind derzeit keine Datensätze gespeichert.');
    });

    it('AC-2: formats proposals with null project_title, valid_until, accepted_at, and empty line items', () => {
      const minimalItems: FormattedProposalExport[] = [
        {
          id: 'prop-min',
          project_id: 'proj-min',
          project_title: null,
          title: 'Minimal Draft Proposal',
          status: 'draft',
          currency: 'EUR',
          subtotal: 10000,
          subtotal_minor: 10000,
          tax: 1900,
          tax_minor: 1900,
          total: 11900,
          total_minor: 11900,
          prices_include_tax: true,
          is_kleinunternehmer: false,
          valid_until: null,
          validity_date: null,
          sent_at: null,
          sent_date: null,
          accepted_at: null,
          acceptance_timestamp: null,
          declined_at: null,
          decline_reason: null,
          accepted_by_name: null,
          accepted_by_email: null,
          acceptance_ip_anonymized: null,
          anonymized_ip: null,
          acceptance_user_agent: null,
          user_agent: null,
          line_items: [],
          created_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-01T00:00:00.000Z',
          proposal: 'Minimal Draft Proposal',
          project: '-',
        },
      ];

      const html = formatProposalsHtml(minimalItems, 'en');
      expect(html).toContain('Minimal Draft Proposal');
      expect(html).toContain('<td>-</td>');
    });

    it('collect: returns empty array when subject is a lead', async () => {
      const tx = {} as DbClient;
      const res = await proposalsExportProvider.collect(
        { kind: 'lead', leadId: 'lead-1', lead: {} as never },
        tx,
      );
      expect(res).toEqual([]);
    });

    it('collect: returns empty array when client has no proposals', async () => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as DbClient;

      const res = await proposalsExportProvider.collect(
        {
          kind: 'client',
          clientId: 'client-empty',
          contactId: 'contact-empty',
          client: {} as never,
          contact: {} as never,
        },
        tx,
      );
      expect(res).toEqual([]);
    });
  });
});

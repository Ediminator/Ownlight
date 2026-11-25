import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  contractsExportProvider,
  CONTRACT_EXPORT_HEADERS,
  CONTRACT_STATUS_LABELS,
  formatContractsHtml,
  type FormattedContractExport,
} from '@/server/contracts/privacy';
import { getCategoryDefinition } from '@/server/privacy/export/categories';
import { formatColumnHeader, generateHtmlExport } from '@/server/privacy/export/html';
import { dsarExportSchema } from '@/server/privacy/export/schema';
import { generateJsonExport } from '@/server/privacy/export/json';
import type { ExportCollectedData } from '@/server/privacy/export/types';
import type { DbClient } from '@/server/db/client';

describe('TASK-0066: Contracts DSAR Export Provider Unit Tests (AC-1, AC-2, AC-7)', () => {
  const mockContracts = [
    {
      id: '01910000-0000-7000-8000-000000000101',
      projectId: '01910000-0000-7000-8000-000000000010',
      clientId: '01910000-0000-7000-8000-0000000000aa',
      proposalId: null,
      templateId: null,
      contractNumber: 'CTR-2026-0001',
      title: 'Wedding Photography Agreement',
      locale: 'en',
      status: 'signed',
      renderedBody: 'Contract terms body',
      mergeValuesSnapshot: {},
      canonicalBodySha256: 'a'.repeat(64),
      validUntil: new Date('2026-07-15T23:59:59.000Z'),
      tokenHash: 'secret-token-hash-must-not-leak-1',
      tokenRevokedAt: null,
      sentAt: new Date('2026-06-01T10:00:00.000Z'),
      remindedAt: null,
      reminderCount: 0,
      clientSignedAt: new Date('2026-06-05T15:30:00.000Z'),
      clientSignerName: 'Alice Smith',
      clientSignerEmail: 'alice@example.com',
      clientSignatureType: 'drawn',
      clientSignatureData: 'data:image/png;base64,iVBORw0KGgo=',
      clientIpAnonymized: '192.0.2.0/24',
      clientUserAgent: 'Mozilla/5.0',
      studioSignedAt: new Date('2026-06-05T15:30:00.000Z'),
      studioSignerName: 'Studio Owner',
      studioSignerTitle: 'Photographer',
      studioSignatureData: 'Studio Owner',
      pdfStorageKey: 'contracts/2026/CTR-2026-0001.pdf',
      pdfSha256: 'b'.repeat(64),
      pdfByteSize: 42000,
      pdfGeneratedAt: new Date('2026-06-05T15:30:05.000Z'),
      internalNotes: 'Private studio negotiation note',
      createdAt: new Date('2026-05-30T09:00:00.000Z'),
      updatedAt: new Date('2026-06-05T15:30:05.000Z'),
    },
    {
      id: '01910000-0000-7000-8000-000000000102',
      projectId: '01910000-0000-7000-8000-000000000010',
      clientId: '01910000-0000-7000-8000-0000000000aa',
      proposalId: null,
      templateId: null,
      contractNumber: 'CTR-2026-0002',
      title: 'Engagement Session Draft',
      locale: 'de',
      status: 'draft',
      renderedBody: 'Draft terms',
      mergeValuesSnapshot: {},
      canonicalBodySha256: 'c'.repeat(64),
      validUntil: null,
      tokenHash: 'secret-token-hash-must-not-leak-2',
      tokenRevokedAt: null,
      sentAt: null,
      remindedAt: null,
      reminderCount: 0,
      clientSignedAt: null,
      clientSignerName: null,
      clientSignerEmail: null,
      clientSignatureType: null,
      clientSignatureData: null,
      clientIpAnonymized: null,
      clientUserAgent: null,
      studioSignedAt: null,
      studioSignerName: null,
      studioSignerTitle: null,
      studioSignatureData: null,
      pdfStorageKey: null,
      pdfSha256: null,
      pdfByteSize: null,
      pdfGeneratedAt: null,
      internalNotes: null,
      createdAt: new Date('2026-06-10T09:00:00.000Z'),
      updatedAt: new Date('2026-06-10T09:00:00.000Z'),
    },
  ];

  function createMockTx(
    contractsList = mockContracts,
    projectTitle = 'Alice & Bob Wedding',
  ): DbClient {
    let callIndex = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            callIndex++;
            if (callIndex === 1) {
              return {
                orderBy: () => Promise.resolve(contractsList),
              };
            }
            return Promise.resolve([
              { id: '01910000-0000-7000-8000-000000000010', title: projectTitle },
            ]);
          },
        }),
      }),
    } as unknown as DbClient;
  }

  describe('Category registration & localization headers', () => {
    it('AC-1: contracts category is registered with Art. 15 disclosures in en and de', () => {
      const def = getCategoryDefinition('contracts');
      expect(def).toBeDefined();
      expect(def?.id).toBe('contracts');
      expect(def?.title.en).toBe('Contracts & Signatures');
      expect(def?.title.de).toBe('Verträge & Signaturen');
      expect(def?.lawfulBasis.en).toContain('Art. 6(1)(b) GDPR');
      expect(def?.lawfulBasis.de).toContain('Art. 6 Abs. 1 lit. b DSGVO');
      expect(def?.retention.en).toContain('§ 147 AO');
      expect(def?.retention.de).toContain('§ 257 HGB');
    });

    it('AC-2: formatColumnHeader localizes contract column headers into German and English', () => {
      expect(formatColumnHeader('contract_number', 'de')).toBe('Vertragsnummer');
      expect(formatColumnHeader('signed_at', 'de')).toBe('Unterzeichnet am');
      expect(formatColumnHeader('signer_name', 'de')).toBe('Unterzeichnet von (Name)');
      expect(formatColumnHeader('signer_email', 'de')).toBe('Unterzeichnet von (E-Mail)');
      expect(formatColumnHeader('signature_type', 'de')).toBe('Signaturart');
      expect(formatColumnHeader('canonical_body_sha256', 'de')).toBe('Text-Prüfsumme (SHA-256)');
      expect(formatColumnHeader('pdf_sha256', 'de')).toBe('PDF-Prüfsumme (SHA-256)');

      expect(formatColumnHeader('contract_number', 'en')).toBe('Contract Number');
      expect(CONTRACT_EXPORT_HEADERS.en.contractNumber).toBe('Contract Number');
      expect(CONTRACT_EXPORT_HEADERS.de.contractNumber).toBe('Vertragsnummer');
      expect(CONTRACT_STATUS_LABELS.de.signed).toBe('Unterzeichnet');
    });
  });

  describe('AC-1 & AC-7: Structured JSON export conforming to ownlight.dsar.v1', () => {
    it('AC-1 & AC-7: exports contract fields and verification hashes while omitting token_hash and internal_notes', async () => {
      const mockTx = createMockTx();
      const subject = {
        kind: 'client' as const,
        clientId: '01910000-0000-7000-8000-0000000000aa',
        contactId: '01910000-0000-7000-8000-0000000000bb',
        contact: {} as never,
        client: {} as never,
      };

      const items = (await contractsExportProvider.collect(
        subject,
        mockTx,
      )) as FormattedContractExport[];

      expect(items).toHaveLength(2);

      const signed = items[0];
      if (!signed) throw new Error('Expected signed contract');

      expect(signed.id).toBe('01910000-0000-7000-8000-000000000101');
      expect(signed.contract_number).toBe('CTR-2026-0001');
      expect(signed.title).toBe('Wedding Photography Agreement');
      expect(signed.locale).toBe('en');
      expect(signed.status).toBe('signed');
      expect(signed.valid_until).toBe('2026-07-15T23:59:59.000Z');
      expect(signed.sent_at).toBe('2026-06-01T10:00:00.000Z');
      expect(signed.signed_at).toBe('2026-06-05T15:30:00.000Z');
      expect(signed.signer_name).toBe('Alice Smith');
      expect(signed.signer_email).toBe('alice@example.com');
      expect(signed.signature_type).toBe('drawn');
      expect(signed.canonical_body_sha256).toBe('a'.repeat(64));
      expect(signed.pdf_sha256).toBe('b'.repeat(64));
      expect(signed.created_at).toBe('2026-05-30T09:00:00.000Z');

      // AC-7: Omit internal secrets and private notes
      const rawRecord = signed as unknown as Record<string, unknown>;
      expect(rawRecord.token_hash).toBeUndefined();
      expect(rawRecord.tokenHash).toBeUndefined();
      expect(rawRecord.internal_notes).toBeUndefined();
      expect(rawRecord.internalNotes).toBeUndefined();
      expect(rawRecord.pdf_storage_key).toBeUndefined();

      // Validate against ownlight.dsar.v1
      const collectedData: ExportCollectedData = {
        schema: 'ownlight.dsar.v1',
        generated_at: new Date().toISOString(),
        studio: { name: 'Ownlight Studio' },
        subject: {
          id: '01910000-0000-7000-8000-0000000000aa',
          display_name: 'Alice Smith',
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
          phone: null,
          role: 'primary',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        categories: {
          contracts: items,
        },
      };

      const jsonString = generateJsonExport(collectedData);
      expect(jsonString).not.toContain('secret-token-hash-must-not-leak');
      expect(jsonString).not.toContain('token_hash');
      expect(jsonString).not.toContain('Private studio negotiation note');

      const parsed = JSON.parse(jsonString) as unknown;
      expect(dsarExportSchema.safeParse(parsed).success).toBe(true);
    });

    it('AC-1: collects contracts for contact subject and returns empty array for lead or empty client', async () => {
      const contactRes = (await contractsExportProvider.collect(
        {
          kind: 'contact',
          contactId: 'ct-1',
          clientId: '01910000-0000-7000-8000-0000000000aa',
          contact: {} as never,
          client: {} as never,
        },
        createMockTx(),
      )) as FormattedContractExport[];
      expect(contactRes).toHaveLength(2);

      const leadRes = await contractsExportProvider.collect(
        { kind: 'lead', leadId: 'lead-1', lead: {} as never },
        {} as DbClient,
      );
      expect(leadRes).toEqual([]);

      const emptyRes = await contractsExportProvider.collect(
        {
          kind: 'client',
          clientId: 'c-empty',
          contactId: 'ct-empty',
          contact: {} as never,
          client: {} as never,
        },
        createMockTx([]),
      );
      expect(emptyRes).toEqual([]);
    });
  });

  describe('AC-2: Human-readable localized HTML rendering (en/de)', () => {
    const sampleItems: FormattedContractExport[] = [
      {
        id: 'ctr-1',
        project_id: 'proj-1',
        project_title: 'Emma & Liam Wedding',
        contract_number: 'CTR-2026-0001',
        title: 'Wedding Agreement <script>alert(1)</script>',
        locale: 'en',
        status: 'signed',
        valid_until: '2026-07-01T00:00:00.000Z',
        sent_at: '2026-06-01T10:00:00.000Z',
        signed_at: '2026-06-05T15:30:00.000Z',
        studio_signed_at: '2026-06-05T15:30:00.000Z',
        signer_name: 'Emma Watson',
        signer_email: 'emma@example.com',
        signature_type: 'drawn',
        canonical_body_sha256: 'a'.repeat(64),
        pdf_sha256: 'b'.repeat(64),
        created_at: '2026-05-30T09:00:00.000Z',
      },
      {
        id: 'ctr-2',
        project_id: 'proj-2',
        project_title: null,
        contract_number: 'CTR-2026-0002',
        title: 'Portrait Agreement',
        locale: 'de',
        status: 'custom_unknown_status',
        valid_until: null,
        sent_at: null,
        signed_at: null,
        studio_signed_at: null,
        signer_name: 'Signer Only',
        signer_email: null,
        signature_type: null,
        canonical_body_sha256: 'c'.repeat(64),
        pdf_sha256: null,
        created_at: '2026-06-10T09:00:00.000Z',
      },
      {
        id: 'ctr-3',
        project_id: 'proj-3',
        project_title: null,
        contract_number: 'CTR-2026-0003',
        title: 'Email Only Agreement',
        locale: 'de',
        status: 'draft',
        valid_until: null,
        sent_at: null,
        signed_at: null,
        studio_signed_at: null,
        signer_name: null,
        signer_email: 'only@example.com',
        signature_type: null,
        canonical_body_sha256: 'd'.repeat(64),
        pdf_sha256: null,
        created_at: '2026-06-11T09:00:00.000Z',
      },
      {
        id: 'ctr-4',
        project_id: 'proj-4',
        project_title: null,
        contract_number: 'CTR-2026-0004',
        title: 'Unsigned Agreement',
        locale: 'de',
        status: 'sent',
        valid_until: null,
        sent_at: null,
        signed_at: null,
        studio_signed_at: null,
        signer_name: null,
        signer_email: null,
        signature_type: null,
        canonical_body_sha256: 'e'.repeat(64),
        pdf_sha256: null,
        created_at: '2026-06-12T09:00:00.000Z',
      },
    ];

    it('AC-2: renders accessible escaped HTML table in English and German', () => {
      const htmlEn = formatContractsHtml(sampleItems, 'en');
      expect(htmlEn).toContain('<table class="data-table">');
      expect(htmlEn).toContain('aria-label="Contracts &amp; Signatures"');
      expect(htmlEn).toContain('<th scope="col">Contract Number</th>');
      expect(htmlEn).toContain('CTR-2026-0001');
      expect(htmlEn).toContain('Emma &amp; Liam Wedding');
      expect(htmlEn).toContain('Signed');
      expect(htmlEn).toContain('Emma Watson (emma@example.com)');
      expect(htmlEn).toContain('Signer Only');
      expect(htmlEn).toContain('(only@example.com)');
      expect(htmlEn).toContain('custom_unknown_status');
      expect(htmlEn).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(htmlEn).not.toContain('<script>alert(1)</script>');

      const htmlDe = formatContractsHtml(sampleItems, 'de');
      expect(htmlDe).toContain('aria-label="Verträge &amp; Signaturen"');
      expect(htmlDe).toContain('<th scope="col">Vertragsnummer</th>');
      expect(htmlDe).toContain('<th scope="col">Unterzeichnet am</th>');
      expect(htmlDe).toContain('Unterzeichnet');
      expect(htmlDe).toContain('Entwurf');
    });

    it('AC-2: renders empty notice when contracts list is empty and integrates into generateHtmlExport', () => {
      expect(formatContractsHtml([], 'en')).toContain('No records stored in this category.');
      expect(formatContractsHtml([], 'de')).toContain(
        'In dieser Kategorie sind derzeit keine Datensätze gespeichert.',
      );

      const fullHtml = generateHtmlExport(
        {
          schema: 'ownlight.dsar.v1',
          generated_at: '2026-06-15T12:00:00.000Z',
          studio: { name: 'Test Studio' },
          subject: {
            id: 's-1',
            display_name: 'Emma Watson',
            first_name: 'Emma',
            last_name: 'Watson',
            email: 'emma@example.com',
            phone: null,
            role: 'primary',
            created_at: '2026-05-01T00:00:00.000Z',
            updated_at: '2026-05-01T00:00:00.000Z',
          },
          categories: { contracts: sampleItems },
        },
        'de',
      );

      expect(fullHtml).toContain('Verträge &amp; Signaturen');
      expect(fullHtml).toContain('<th scope="col">Vertragsnummer</th>');
      expect(fullHtml).toContain('CTR-2026-0001');
    });
  });
});

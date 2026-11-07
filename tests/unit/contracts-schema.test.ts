import { describe, it, expect } from 'vitest';
import {
  createContractTemplateSchema,
  updateContractTemplateSchema,
  createContractDraftSchema,
  updateContractDraftSchema,
  voidContractSchema,
  updateStudioSigningProfileSchema,
  contractStatusSchema,
  contractSignatureTypeSchema,
  contractCountersignatureModeSchema,
  CONTRACT_LOCALES,
} from '@/server/contracts/schema';

describe('Contracts Schema Validation Unit Tests (AC-8)', () => {
  describe('createContractTemplateSchema', () => {
    it('AC-8: validates a valid contract template payload successfully', () => {
      const valid = {
        name: 'Wedding Photography Agreement',
        slug: 'wedding-photography-agreement',
        description: 'Standard wedding agreement',
        projectTypeKey: 'wedding',
        contentEn: 'Clause 1: Photography services for {{client.name}}',
        contentDe: 'Klausel 1: Fotografische Leistungen für {{client.name}}',
        isDefault: true,
        isActive: true,
      };

      const parsed = createContractTemplateSchema.parse(valid);
      expect(parsed.name).toBe('Wedding Photography Agreement');
      expect(parsed.slug).toBe('wedding-photography-agreement');
      expect(parsed.isDefault).toBe(true);
      expect(parsed.isActive).toBe(true);
    });

    it('AC-8: rejects empty template name', () => {
      expect(() =>
        createContractTemplateSchema.parse({
          name: '   ',
          slug: 'valid-slug',
          contentEn: 'content',
          contentDe: 'inhalt',
        }),
      ).toThrow(/Template name is required/);
    });

    it('AC-8: rejects malformed slug formats', () => {
      const invalidSlugs = [
        'Invalid Slug With Spaces',
        'UPPERCASE-SLUG',
        'slug_with_underscores',
        '-leading-hyphen',
        'trailing-hyphen-',
        'double--hyphens',
        'special$chars!',
      ];

      for (const slug of invalidSlugs) {
        expect(() =>
          createContractTemplateSchema.parse({
            name: 'Template Name',
            slug,
            contentEn: 'content',
            contentDe: 'inhalt',
          }),
        ).toThrow();
      }
    });

    it('AC-8: rejects empty content in English or German', () => {
      expect(() =>
        createContractTemplateSchema.parse({
          name: 'Template',
          slug: 'valid-slug',
          contentEn: '',
          contentDe: 'German content',
        }),
      ).toThrow(/English content is required/);

      expect(() =>
        createContractTemplateSchema.parse({
          name: 'Template',
          slug: 'valid-slug',
          contentEn: 'English content',
          contentDe: '',
        }),
      ).toThrow(/German content is required/);
    });

    it('AC-8: rejects unknown extra properties due to strict validation', () => {
      expect(() =>
        createContractTemplateSchema.parse({
          name: 'Template',
          slug: 'valid-slug',
          contentEn: 'En',
          contentDe: 'De',
          forbiddenProperty: 'attack',
        }),
      ).toThrow();
    });
  });

  describe('updateContractTemplateSchema', () => {
    it('AC-8: allows partial updates with valid fields', () => {
      const parsed = updateContractTemplateSchema.parse({
        name: 'Updated Template Name',
        isDefault: false,
      });

      expect(parsed.name).toBe('Updated Template Name');
      expect(parsed.isDefault).toBe(false);
    });

    it('AC-8: rejects malformed slug in update', () => {
      expect(() =>
        updateContractTemplateSchema.parse({
          slug: 'Not Kebab',
        }),
      ).toThrow();
    });
  });

  describe('createContractDraftSchema', () => {
    const validDraft = {
      projectId: '01920000-0000-7000-8000-000000000071',
      clientId: '01920000-0000-7000-8000-000000000081',
      title: 'Wedding Photography Agreement — Emma & Liam',
      locale: 'en',
    };

    it('AC-8: validates a valid contract draft payload', () => {
      const parsed = createContractDraftSchema.parse(validDraft);
      expect(parsed.title).toBe('Wedding Photography Agreement — Emma & Liam');
      expect(parsed.locale).toBe('en');
    });

    it('AC-8: rejects non-UUID project and client identifiers', () => {
      expect(() =>
        createContractDraftSchema.parse({
          ...validDraft,
          projectId: 'not-a-uuid',
        }),
      ).toThrow(/Project ID must be a valid UUID/);

      expect(() =>
        createContractDraftSchema.parse({
          ...validDraft,
          clientId: 'not-a-uuid',
        }),
      ).toThrow(/Client ID must be a valid UUID/);
    });

    it('AC-8: rejects empty title', () => {
      expect(() =>
        createContractDraftSchema.parse({
          ...validDraft,
          title: '   ',
        }),
      ).toThrow(/Contract title is required/);
    });

    it('AC-8: rejects unsupported locale values', () => {
      expect(() =>
        createContractDraftSchema.parse({
          ...validDraft,
          locale: 'fr',
        }),
      ).toThrow();
    });
  });

  describe('updateStudioSigningProfileSchema', () => {
    it('AC-8: validates studio signing profile and physical address input', () => {
      const valid = {
        contractSignatoryName: 'Jane Doe',
        contractSignatoryTitle: 'Lead Photographer & Studio Owner',
        contractCountersignatureMode: 'pre_signed',
        studioAddressLine1: 'Torstraße 100',
        studioPostalCode: '10119',
        studioCity: 'Berlin',
        studioCountryCode: 'DE',
        studioPhone: '+49 30 1234567',
        studioEmail: 'photographer@example.org',
      };

      const parsed = updateStudioSigningProfileSchema.parse(valid);
      expect(parsed.contractSignatoryName).toBe('Jane Doe');
      expect(parsed.contractCountersignatureMode).toBe('pre_signed');
      expect(parsed.studioCountryCode).toBe('DE');
    });

    it('AC-8: rejects invalid countersignature mode', () => {
      expect(() =>
        updateStudioSigningProfileSchema.parse({
          contractCountersignatureMode: 'unsupported_mode',
        }),
      ).toThrow();
    });

    it('AC-8: transforms empty strings in optional fields to null', () => {
      const parsed = updateStudioSigningProfileSchema.parse({
        contractSignatoryName: '',
        contractSignatoryTitle: '',
        studioAddressLine1: '',
        studioAddressLine2: '',
        studioPostalCode: '',
        studioCity: '',
        studioPhone: '',
        studioEmail: '',
      });
      expect(parsed.contractSignatoryName).toBeNull();
      expect(parsed.contractSignatoryTitle).toBeNull();
      expect(parsed.studioAddressLine1).toBeNull();
      expect(parsed.studioAddressLine2).toBeNull();
      expect(parsed.studioPostalCode).toBeNull();
      expect(parsed.studioCity).toBeNull();
      expect(parsed.studioPhone).toBeNull();
      expect(parsed.studioEmail).toBeNull();
    });

    it('AC-8: rejects invalid country code length and malformed email', () => {
      expect(() =>
        updateStudioSigningProfileSchema.parse({
          studioCountryCode: 'DEU',
        }),
      ).toThrow(/Country code must be exactly 2 characters/);

      expect(() =>
        updateStudioSigningProfileSchema.parse({
          studioEmail: 'not-an-email',
        }),
      ).toThrow(/Invalid email address/);
    });
  });

  describe('contractStatusSchema & contractSignatureTypeSchema', () => {
    it('AC-8: verifies contract status enum options', () => {
      const validStatuses = [
        'draft',
        'sent',
        'signed_by_client',
        'signed',
        'declined',
        'voided',
        'superseded',
      ];

      for (const status of validStatuses) {
        expect(contractStatusSchema.parse(status)).toBe(status);
      }

      expect(() => contractStatusSchema.parse('invalid_status')).toThrow();
    });

    it('AC-8: verifies signature types drawn and typed', () => {
      expect(contractSignatureTypeSchema.parse('drawn')).toBe('drawn');
      expect(contractSignatureTypeSchema.parse('typed')).toBe('typed');
      expect(() => contractSignatureTypeSchema.parse('biometric')).toThrow();
    });

    it('AC-8: verifies countersignature mode and contract locales', () => {
      expect(contractCountersignatureModeSchema.parse('explicit')).toBe('explicit');
      expect(contractCountersignatureModeSchema.parse('pre_signed')).toBe('pre_signed');
      expect(() => contractCountersignatureModeSchema.parse('automatic')).toThrow();
      expect(CONTRACT_LOCALES).toEqual(['en', 'de']);
    });

    it('AC-8: validates updateContractDraftSchema and voidContractSchema', () => {
      const updateDraft = updateContractDraftSchema.parse({
        title: 'Updated Contract Title',
        locale: 'de',
        internalNotes: 'Reviewed with studio manager',
      });
      expect(updateDraft.title).toBe('Updated Contract Title');
      expect(updateDraft.locale).toBe('de');

      const voidPayload = voidContractSchema.parse({
        reason: 'Client requested cancellation',
      });
      expect(voidPayload.reason).toBe('Client requested cancellation');
    });
  });
});

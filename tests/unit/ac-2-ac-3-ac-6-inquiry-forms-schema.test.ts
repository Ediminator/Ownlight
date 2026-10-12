import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FORM_FIELDS,
  validateFormFields,
  validateEventTypes,
  noticeVersionInputSchema,
  successRedirectUrlSchema,
} from '@/server/inquiry-forms/schema';

describe('TASK-0024: AC-2, AC-3, AC-6 Form Schema Validation', () => {
  describe('AC-2: Fixed field catalogue validation', () => {
    it('AC-2: allows valid field catalogue with mandatory fields enabled and required', () => {
      const res = validateFormFields(DEFAULT_FORM_FIELDS);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toHaveLength(8);
      }
    });

    it('AC-2: rejects fields update that disables email, naming "email"', () => {
      const fields = DEFAULT_FORM_FIELDS.map((f) =>
        f.key === 'email' ? { ...f, enabled: false } : f,
      );
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('email');
        expect(res.error).toContain('email');
      }
    });

    it('AC-2: rejects fields update that makes email optional, naming "email"', () => {
      const fields = DEFAULT_FORM_FIELDS.map((f) =>
        f.key === 'email' ? { ...f, required: false } : f,
      );
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('email');
        expect(res.error).toContain('email');
      }
    });

    it('AC-2: rejects fields update that disables given_name, naming "given_name"', () => {
      const fields = DEFAULT_FORM_FIELDS.map((f) =>
        f.key === 'given_name' ? { ...f, enabled: false } : f,
      );
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('given_name');
        expect(res.error).toContain('given_name');
      }
    });

    it('AC-2: rejects fields update that makes given_name optional, naming "given_name"', () => {
      const fields = DEFAULT_FORM_FIELDS.map((f) =>
        f.key === 'given_name' ? { ...f, required: false } : f,
      );
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('given_name');
        expect(res.error).toContain('given_name');
      }
    });

    it('AC-2: rejects fields update with duplicate key, naming the repeated key', () => {
      const fields = [
        ...DEFAULT_FORM_FIELDS,
        { key: 'phone', enabled: true, required: false, order: 8 },
      ];
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('phone');
        expect(res.error).toContain('phone');
      }
    });

    it('AC-2: rejects fields update with unknown key, naming the offending key', () => {
      const fields = [
        ...DEFAULT_FORM_FIELDS,
        { key: 'custom_survey_question', enabled: true, required: false, order: 8 },
      ];
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('custom_survey_question');
        expect(res.error).toContain('custom_survey_question');
      }
    });

    it('AC-2: rejects fields update missing mandatory field email, naming "email"', () => {
      const fields = DEFAULT_FORM_FIELDS.filter((f) => f.key !== 'email');
      const res = validateFormFields(fields);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('email');
        expect(res.error).toContain('email');
      }
    });

    it('AC-2: rejects non-array input', () => {
      const res = validateFormFields('not-an-array');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.field).toBe('fields');
      }
    });
  });

  describe('AC-3: Event types validation', () => {
    it('AC-3: accepts valid event types array', () => {
      const eventTypes = [
        { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
        { key: 'portrait', label_en: 'Portrait Session', label_de: 'Porträt-Shooting' },
      ];
      const res = validateEventTypes(eventTypes, true);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toHaveLength(2);
      }
    });

    it('AC-3: rejects event_type enabled with zero event types', () => {
      const res = validateEventTypes([], true);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('at least one event type');
      }
    });

    it('AC-3: allows zero event types when event_type field is disabled', () => {
      const res = validateEventTypes([], false);
      expect(res.success).toBe(true);
    });

    it('AC-3: rejects more than 20 event types (21 entries)', () => {
      const eventTypes = Array.from({ length: 21 }, (_, i) => ({
        key: `event-${String(i)}`,
        label_en: `Event ${String(i)}`,
        label_de: `Ereignis ${String(i)}`,
      }));
      const res = validateEventTypes(eventTypes, true);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('20');
      }
    });

    it('AC-3: rejects duplicate event type keys', () => {
      const eventTypes = [
        { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
        { key: 'wedding', label_en: 'Civil Wedding', label_de: 'Standesamt' },
      ];
      const res = validateEventTypes(eventTypes, true);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('Duplicate event type key "wedding"');
      }
    });

    it('AC-3: rejects event type label exceeding 60 characters', () => {
      const eventTypes = [
        {
          key: 'wedding',
          label_en: 'A'.repeat(61),
          label_de: 'Hochzeit',
        },
      ];
      const res = validateEventTypes(eventTypes, true);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('60 characters');
      }
    });

    it('AC-3: rejects invalid event type key slug format', () => {
      const eventTypes = [
        {
          key: 'Invalid Key With Spaces',
          label_en: 'Wedding',
          label_de: 'Hochzeit',
        },
      ];
      const res = validateEventTypes(eventTypes, true);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('/^[a-z0-9-]{1,40}$/');
      }
    });
  });

  describe('AC-6: Notice version plain-text & HTTPS validation', () => {
    const validNotice = {
      acknowledgement_text_en: 'I have read and acknowledge the privacy policy.',
      acknowledgement_text_de: 'Ich habe die Datenschutzerklärung zur Kenntnis genommen.',
      privacy_policy_url: 'https://example.com/privacy',
    };

    it('AC-6: accepts valid notice version with plain text and https URL', () => {
      const res = noticeVersionInputSchema.safeParse(validNotice);
      expect(res.success).toBe(true);
    });

    it('AC-6: rejects notice text containing <script> or HTML tags (< or >)', () => {
      const scriptNotice = {
        ...validNotice,
        acknowledgement_text_en: 'I acknowledge <script>alert(1)</script>',
      };
      const res = noticeVersionInputSchema.safeParse(scriptNotice);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('plain text');
      }

      const tagNotice = {
        ...validNotice,
        acknowledgement_text_de: 'Ich stimme zu <b>jetzt</b>',
      };
      const tagRes = noticeVersionInputSchema.safeParse(tagNotice);
      expect(tagRes.success).toBe(false);
    });

    it('AC-6: rejects privacy_policy_url with http://', () => {
      const httpNotice = {
        ...validNotice,
        privacy_policy_url: 'http://insecure.example.com/privacy',
      };
      const res = noticeVersionInputSchema.safeParse(httpNotice);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('https://');
      }
    });

    it('AC-6: rejects privacy_policy_url with javascript:', () => {
      const jsNotice = {
        ...validNotice,
        privacy_policy_url: 'javascript:alert(1)',
      };
      const res = noticeVersionInputSchema.safeParse(jsNotice);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('https://');
      }
    });

    it('AC-6: rejects notice text exceeding 500 characters', () => {
      const longNotice = {
        ...validNotice,
        acknowledgement_text_en: 'A'.repeat(501),
      };
      const res = noticeVersionInputSchema.safeParse(longNotice);
      expect(res.success).toBe(false);
    });
  });

  describe('Success redirect URL validation', () => {
    it('accepts null, undefined, or valid https URL', () => {
      expect(successRedirectUrlSchema.safeParse(null).success).toBe(true);
      expect(successRedirectUrlSchema.safeParse(undefined).success).toBe(true);
      expect(successRedirectUrlSchema.safeParse('https://studio.example.com/thanks').success).toBe(
        true,
      );
    });

    it('rejects non-https URLs', () => {
      expect(successRedirectUrlSchema.safeParse('http://studio.example.com/thanks').success).toBe(
        false,
      );
      expect(successRedirectUrlSchema.safeParse('javascript:void(0)').success).toBe(false);
      expect(successRedirectUrlSchema.safeParse('https://[').success).toBe(false);
    });

    it('rejects malformed https URL syntax in noticeVersionInputSchema', () => {
      const badSyntaxNotice = {
        acknowledgement_text_en: 'Valid text',
        acknowledgement_text_de: 'Gültiger Text',
        privacy_policy_url: 'https://[',
      };
      expect(noticeVersionInputSchema.safeParse(badSyntaxNotice).success).toBe(false);
    });

    it('rejects non-array or invalid field configurations in validateFormFields and validateEventTypes', () => {
      expect(validateFormFields(null).success).toBe(false);
      expect(validateFormFields([{ invalid: true }]).success).toBe(false);
      expect(validateEventTypes(null).success).toBe(false);
    });
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildDynamicInquirySchema } from '@/server/inquiry-forms/submit';
import type {
  InquiryFormFieldConfig,
  InquiryFormEventType,
} from '@/server/db/schema/inquiry-forms';

describe('TASK-0027: Dynamic Inquiry Schema Validation (AC-9)', () => {
  const defaultFields: InquiryFormFieldConfig[] = [
    { key: 'given_name', enabled: true, required: true, order: 0 },
    { key: 'family_name', enabled: true, required: false, order: 1 },
    { key: 'email', enabled: true, required: true, order: 2 },
    { key: 'phone', enabled: true, required: false, order: 3 },
    { key: 'event_type', enabled: true, required: true, order: 4 },
    { key: 'event_date', enabled: true, required: false, order: 5 },
    { key: 'event_location', enabled: true, required: false, order: 6 },
    { key: 'message', enabled: true, required: false, order: 7 },
  ];

  const defaultEventTypes: InquiryFormEventType[] = [
    { key: 'wedding', label_en: 'Wedding', label_de: 'Hochzeit' },
    { key: 'portrait', label_en: 'Portrait', label_de: 'Porträt' },
  ];

  const timezone = 'Europe/Berlin';

  const validPayload = {
    given_name: 'Jane',
    family_name: 'Doe',
    email: 'jane.doe@example.com',
    phone: '+49 30 12345678',
    event_type: 'wedding',
    event_date: '2027-06-15',
    event_location: 'Berlin City Hall',
    message: 'We are planning our wedding shoot.',
    notice_acknowledged: true,
  };

  it('AC-9: accepts valid submission matching configured enabled fields', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it('AC-9: rejects crafted submission with an unknown field key (.strict())', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      malicious_field: 'injected_value',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      expect(issue?.code).toBe('unrecognized_keys');
    }
  });

  it('AC-9: rejects submission containing a disabled field key', () => {
    // Disable phone field in form configuration
    const fieldsWithPhoneDisabled = defaultFields.map((f) =>
      f.key === 'phone' ? { ...f, enabled: false } : f,
    );
    const schema = buildDynamicInquirySchema(fieldsWithPhoneDisabled, defaultEventTypes, timezone);

    const parsed = schema.safeParse({
      ...validPayload,
      phone: '+49 30 12345678',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      expect(issue?.code).toBe('unrecognized_keys');
    }
  });

  it('AC-9: rejects event_type not in configured keys', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      event_type: 'corporate_gala', // Not in ['wedding', 'portrait']
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('event_type');
    }
  });

  it('AC-9: rejects event_date in the past', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      event_date: '2020-01-01',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('event_date');
    }
  });

  it('AC-9: rejects event_date more than 5 years ahead', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      event_date: '2035-01-01',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('event_date');
    }
  });

  it('AC-9: rejects message exceeding 2000 characters', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      message: 'a'.repeat(2001),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('message');
    }
  });

  it('AC-9: rejects email containing CRLF (\\r or \\n) to prevent header injection', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsedCRLF = schema.safeParse({
      ...validPayload,
      email: 'attacker@example.com\r\nBcc: victim@example.com',
    });
    expect(parsedCRLF.success).toBe(false);

    const parsedLF = schema.safeParse({
      ...validPayload,
      email: 'attacker@example.com\nBcc: victim@example.com',
    });
    expect(parsedLF.success).toBe(false);
  });

  it('AC-9: rejects missing privacy notice acknowledgement', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      notice_acknowledged: false,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('notice_acknowledged');
    }
  });

  it('AC-9: accepts HTML checkbox "on" value for notice_acknowledged', () => {
    const schema = buildDynamicInquirySchema(defaultFields, defaultEventTypes, timezone);
    const parsed = schema.safeParse({
      ...validPayload,
      notice_acknowledged: 'on',
    });
    expect(parsed.success).toBe(true);
  });
});

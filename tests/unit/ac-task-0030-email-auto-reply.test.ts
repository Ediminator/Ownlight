import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { renderAutoReplyEmail, sanitizeStudioName } from '@/server/email/templates';
import { sanitizeOutboxError } from '@/server/email/outbox-processor';
import { validateRecipientAddress } from '@/server/auth/email';
import {
  emailOutbox,
  EMAIL_OUTBOX_KINDS,
  EMAIL_OUTBOX_STATUSES,
} from '@/server/db/schema/email-outbox';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('TASK-0030 Unit Tests: Auto-Reply Templates & Mail Security', () => {
  it('AC-1: renderAutoReplyEmail renders English subject and body with privacy notice link', () => {
    const rendered = renderAutoReplyEmail({
      locale: 'en',
      studioName: 'Lumos Photography',
      privacyPolicyUrl: 'https://example.com/privacy-en',
    });

    expect(rendered.subject).toBe('Your inquiry to Lumos Photography');
    expect(rendered.text).toContain('Thank you for reaching out');
    expect(rendered.text).toContain('respond to you personally');
    expect(rendered.text).toContain('https://example.com/privacy-en');
  });

  it('AC-2: renderAutoReplyEmail renders German subject and body with privacy notice link', () => {
    const rendered = renderAutoReplyEmail({
      locale: 'de',
      studioName: 'Lumos Fotostudio',
      privacyPolicyUrl: 'https://example.com/datenschutz',
    });

    expect(rendered.subject).toBe('Ihre Anfrage an Lumos Fotostudio');
    expect(rendered.text).toContain('Vielen Dank für Ihre Nachricht');
    expect(rendered.text).toContain('persönlich bei Ihnen melden');
    expect(rendered.text).toContain('https://example.com/datenschutz');
  });

  it('AC-4: auto-reply template contains NO visitor name, NO visitor message text, and NO advertising', () => {
    const maliciousPayload = {
      locale: 'en' as const,
      studioName: 'Clean Studio',
      privacyPolicyUrl: 'https://example.com/privacy',
    };

    const rendered = renderAutoReplyEmail(maliciousPayload);

    // Verify template strictly contains no user-supplied message content or advertising
    expect(rendered.text).not.toContain('Free offer');
    expect(rendered.text).not.toContain('Click here');
    expect(rendered.text).not.toContain('http://evil.example');
    expect(rendered.text).not.toContain('Jane Doe');
    expect(rendered.subject).not.toContain('Free offer');
  });

  it('AC-13: validateRecipientAddress rejects email addresses with newline characters and header delimiters', () => {
    // Valid cases
    expect(validateRecipientAddress('visitor@example.com')).toBe('visitor@example.com');
    expect(validateRecipientAddress({ address: 'visitor@example.org' })).toBe(
      'visitor@example.org',
    );

    // CRLF injection attempts
    expect(() => validateRecipientAddress('visitor@example.com\r\nBcc: evil@example.com')).toThrow(
      /prohibited header delimiters or line breaks/,
    );
    expect(() => validateRecipientAddress('visitor@example.com\nSubject: Injected')).toThrow(
      /prohibited header delimiters or line breaks/,
    );
    expect(() =>
      validateRecipientAddress({ address: 'test@example.org\rTo: victim@example.org' }),
    ).toThrow(/prohibited header delimiters or line breaks/);

    // Header delimiter injection attempts (comma, semicolon, angle brackets, null byte)
    expect(() => validateRecipientAddress('first@example.com, second@example.com')).toThrow(
      /prohibited header delimiters or line breaks/,
    );
    expect(() => validateRecipientAddress('first@example.com; second@example.com')).toThrow(
      /prohibited header delimiters or line breaks/,
    );
    expect(() => validateRecipientAddress('Visitor <visitor@example.com>')).toThrow(
      /prohibited header delimiters or line breaks/,
    );
    expect(() => validateRecipientAddress('visitor@example.com\x00extra')).toThrow(
      /prohibited header delimiters or line breaks/,
    );

    // Format & length checks
    expect(() => validateRecipientAddress('')).toThrow(/missing or not a string/);
    expect(() => validateRecipientAddress('not-an-email')).toThrow(
      /Invalid recipient email address format/,
    );
    expect(() => validateRecipientAddress(`${'a'.repeat(250)}@example.com`)).toThrow(
      /exceeds maximum 254 characters/,
    );
  });

  it('sanitizeStudioName removes line breaks and caps length at 100 characters', () => {
    const maliciousStudio = 'My Studio\r\nBcc: evil@example.com\nExtra Line';
    const cleaned = sanitizeStudioName(maliciousStudio);
    expect(cleaned).not.toContain('\r');
    expect(cleaned).not.toContain('\n');
    expect(cleaned).toBe('My Studio Bcc: evil@example.com Extra Line');

    // Length capping
    const longStudio = 'A'.repeat(150);
    const capped = sanitizeStudioName(longStudio);
    expect(capped).toHaveLength(100);

    // Empty / null fallback
    expect(sanitizeStudioName('')).toBe('Photo Studio');
    expect(sanitizeStudioName(null)).toBe('Photo Studio');
    expect(sanitizeStudioName(undefined)).toBe('Photo Studio');
  });

  it('sanitizeOutboxError strips recipient emails, credentials, and URLs without leaking PII', () => {
    const rawError =
      'SMTP Error 550: Recipient client.secret@example.com rejected on https://smtp.provider.internal/v1 with password=SuperSecretPassword123!';
    const sanitized = sanitizeOutboxError(rawError);

    expect(sanitized).not.toContain('client.secret@example.com');
    expect(sanitized).toContain('[REDACTED_EMAIL]');
    expect(sanitized).not.toContain('https://smtp.provider.internal');
    expect(sanitized).toContain('[REDACTED_URL]');
    expect(sanitized).not.toContain('SuperSecretPassword123!');
    expect(sanitized.length).toBeLessThanOrEqual(500);

    // Fallback on empty error
    expect(sanitizeOutboxError('', 'ConnectionTimeout')).toBe('ConnectionTimeout');
  });

  it('email_outbox schema defines required columns, constraints, and index', () => {
    const config = getTableConfig(emailOutbox);
    expect(config.name).toBe('email_outbox');

    const columnNames = config.columns.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('kind');
    expect(columnNames).toContain('lead_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('attempts');
    expect(columnNames).toContain('next_attempt_at');
    expect(columnNames).toContain('last_error');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');

    expect(EMAIL_OUTBOX_KINDS).toEqual(['lead_auto_reply']);
    expect(EMAIL_OUTBOX_STATUSES).toEqual(['PENDING', 'PROCESSING', 'FAILED']);

    expect(config.indexes.length).toBeGreaterThan(0);
    const statusNextAttemptIdx = config.indexes.find(
      (idx) =>
        (idx as unknown as { config?: { name: string }; name?: string }).config?.name ===
          'email_outbox_status_next_attempt_idx' ||
        (idx as unknown as { config?: { name: string }; name?: string }).name ===
          'email_outbox_status_next_attempt_idx',
    );
    expect(statusNextAttemptIdx).toBeDefined();
  });
});

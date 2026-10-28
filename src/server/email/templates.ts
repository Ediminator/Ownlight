import type { LeadLocale } from '@/server/db/schema/leads';

export interface RenderAutoReplyParams {
  locale: LeadLocale;
  studioName?: string | null;
  privacyPolicyUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sanitizes studio name by stripping carriage returns and newlines, trimming,
 * and capping at 100 characters to prevent header injection or layout corruption.
 */
export function sanitizeStudioName(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') {
    return 'Photo Studio';
  }
  const cleaned = rawName.replace(/[\r\n\x00]+/g, ' ').trim();
  if (cleaned.length === 0) {
    return 'Photo Studio';
  }
  return cleaned.slice(0, 100);
}

/**
 * Renders the localized plain-text auto-reply email for verified inquiries.
 * Strict backscatter & abuse prevention:
 * - NO visitor name is echoed
 * - NO visitor inquiry message is echoed
 * - NO advertising or marketing text is included (BGH VI ZR 134/15)
 */
export function renderAutoReplyEmail({
  locale,
  studioName,
  privacyPolicyUrl,
}: RenderAutoReplyParams): RenderedEmail {
  const sanitizedStudio = sanitizeStudioName(studioName);
  const privacyUrl = privacyPolicyUrl?.trim() ?? '';

  if (locale === 'de') {
    const subject = `Ihre Anfrage an ${sanitizedStudio}`;
    const text =
      `Vielen Dank für Ihre Nachricht. Wir haben Ihre Anfrage erhalten und werden uns schnellstmöglich persönlich bei Ihnen melden.` +
      (privacyUrl
        ? `\n\nInformationen zur Verarbeitung Ihrer personenbezogenen Daten finden Sie in unserer Datenschutzerklärung:\n${privacyUrl}`
        : '');

    return { subject, text };
  }

  const subject = `Your inquiry to ${sanitizedStudio}`;
  const text =
    `Thank you for reaching out. We have received your inquiry and will respond to you personally as soon as possible.` +
    (privacyUrl
      ? `\n\nFor details on how we process your personal data, please review our privacy policy:\n${privacyUrl}`
      : '');

  return { subject, text };
}

export * from './templates/proposal';
export * from './templates/proposal-sent';
export * from './templates/proposal-accepted-client';
export * from './templates/proposal-accepted-owner';

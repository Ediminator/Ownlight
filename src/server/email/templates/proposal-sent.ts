import 'server-only';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { sanitizeStudioName, type RenderedEmail } from '@/server/email/templates';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

export interface ProposalSentEmailPayload {
  id: string;
  title: string;
  totalMinor: number;
  currency: string;
  validUntil?: Date | string | null;
  token?: string | null;
  tokenUrl?: string | null;
}

export interface RenderProposalSentEmailParams {
  proposal: ProposalSentEmailPayload;
  clientName?: string | null;
  studioName?: string | null;
  locale?: string | null;
  baseUrl?: string | null;
}

/**
 * Sanitizes single-line fields against header and CRLF injection.
 */
function sanitizeSingleLine(input?: string | null, fallback = ''): string {
  if (!input || typeof input !== 'string') {
    return fallback;
  }
  return input.replaceAll(/[\r\n\x00]+/g, ' ').trim() || fallback;
}

/**
 * Escapes HTML special characters for safe inclusion in HTML templates.
 */
function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Renders the localized proposal-sent email in both plain-text and responsive HTML (TASK-0060 / AC-1, AC-2, AC-6).
 */
export function renderProposalSentEmail({
  proposal,
  clientName,
  studioName,
  locale = 'en',
  baseUrl = '',
}: RenderProposalSentEmailParams): RenderedEmail {
  const isGerman = locale?.toLowerCase().startsWith('de');
  const activeLocale = isGerman ? 'de' : 'en';
  const dict = isGerman ? deMessages.emails.proposal.sent : enMessages.emails.proposal.sent;

  const sanitizedStudio = sanitizeStudioName(studioName);
  const sanitizedTitle = sanitizeSingleLine(proposal.title, 'Proposal');
  const sanitizedClient = sanitizeSingleLine(clientName, isGerman ? 'Kunde' : 'Client');

  const formattedAmount = formatCurrency(proposal.totalMinor, proposal.currency, activeLocale);

  let formattedValidUntil = '';
  if (proposal.validUntil) {
    const validUntilDate =
      proposal.validUntil instanceof Date ? proposal.validUntil : new Date(proposal.validUntil);
    if (!Number.isNaN(validUntilDate.getTime())) {
      formattedValidUntil = formatDate(validUntilDate, activeLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  // Construct proposal acceptance link
  const safeBaseUrl = (baseUrl ?? '').replaceAll(/\/+$/g, '');
  const rawUrl =
    proposal.tokenUrl ??
    (proposal.token
      ? safeBaseUrl
        ? `${safeBaseUrl}/p/${proposal.token}`
        : `/p/${proposal.token}`
      : '');

  const subject = dict.subject
    .replace('{title}', sanitizedTitle)
    .replace('{studioName}', sanitizedStudio)
    .replaceAll(/[\r\n\x00]+/g, ' ')
    .trim();

  // --- Plain-text template ---
  const textLines: string[] = [
    dict.greeting.replace('{clientName}', sanitizedClient),
    '',
    dict.intro.replace('{studioName}', sanitizedStudio),
    '',
    dict.proposalTitle.replace('{title}', sanitizedTitle),
    dict.totalAmount.replace('{amount}', formattedAmount),
  ];

  if (formattedValidUntil) {
    textLines.push(dict.validUntil.replace('{date}', formattedValidUntil));
  }

  if (rawUrl) {
    textLines.push('');
    textLines.push(dict.linkText.replace('{url}', rawUrl));
  }

  textLines.push('');
  textLines.push(dict.contactInfo.replace('{studioName}', sanitizedStudio));
  textLines.push('');
  textLines.push(dict.footer);

  const text = textLines.join('\n');

  // --- Responsive HTML template ---
  const htmlGreeting = escapeHtml(dict.greeting.replace('{clientName}', sanitizedClient));
  const htmlIntro = escapeHtml(dict.intro.replace('{studioName}', sanitizedStudio));
  const htmlProposalTitle = escapeHtml(sanitizedTitle);
  const htmlAmount = escapeHtml(formattedAmount);
  const htmlContactInfo = escapeHtml(dict.contactInfo.replace('{studioName}', sanitizedStudio));
  const htmlFooter = escapeHtml(dict.footer);
  const htmlButtonText = escapeHtml(dict.buttonText);

  const html = `<!DOCTYPE html>
<html lang="${activeLocale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
    <tr>
      <td style="padding: 32px 32px 16px 32px;">
        <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">${escapeHtml(sanitizedStudio)}</h2>
        <p style="margin: 0 0 12px 0; font-size: 16px; line-height: 24px;">${htmlGreeting}</p>
        <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 24px;">${htmlIntro}</p>
        <div style="background-color: #f1f5f9; border-radius: 6px; padding: 20px; margin-bottom: 24px;">
          <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">${escapeHtml(isGerman ? 'Angebot' : 'Proposal')}</div>
          <div style="font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">${htmlProposalTitle}</div>
          <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">${escapeHtml(isGerman ? 'Gesamtbetrag' : 'Total Quote')}</div>
          <div style="font-size: 22px; font-weight: 700; color: #0f172a;">${htmlAmount}</div>
          ${
            formattedValidUntil
              ? `<div style="font-size: 13px; color: #64748b; margin-top: 8px;">${escapeHtml(dict.validUntil.replace('{date}', formattedValidUntil))}</div>`
              : ''
          }
        </div>
        ${
          rawUrl
            ? `<div style="text-align: center; margin: 32px 0;">
          <a href="${escapeHtml(rawUrl)}" style="display: inline-block; padding: 12px 28px; background-color: #0f172a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;">${htmlButtonText}</a>
        </div>
        <p style="font-size: 13px; line-height: 20px; color: #64748b; word-break: break-all;">
          ${escapeHtml(dict.linkText.replace('{url}', ''))} <a href="${escapeHtml(rawUrl)}" style="color: #2563eb;">${escapeHtml(rawUrl)}</a>
        </p>`
            : ''
        }
        <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 20px; color: #475569;">${htmlContactInfo}</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 32px 24px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
        ${htmlFooter}
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    text,
    html,
  };
}

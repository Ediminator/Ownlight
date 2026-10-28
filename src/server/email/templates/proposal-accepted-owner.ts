import 'server-only';
import { formatCurrency } from '@/lib/formatters';
import { sanitizeStudioName, type RenderedEmail } from '@/server/email/templates';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

export interface ProposalAcceptedOwnerEmailPayload {
  id: string;
  projectId: string;
  title: string;
  packageName?: string | null;
  totalMinor: number;
  currency: string;
  acceptedByName?: string | null;
  acceptedByEmail?: string | null;
}

export interface RenderProposalAcceptedOwnerParams {
  proposal: ProposalAcceptedOwnerEmailPayload;
  clientName?: string | null;
  studioName?: string | null;
  locale?: string | null;
  baseUrl?: string | null;
}

function sanitizeSingleLine(input?: string | null, fallback = ''): string {
  if (!input || typeof input !== 'string') {
    return fallback;
  }
  return input.replaceAll(/[\r\n\x00]+/g, ' ').trim() || fallback;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Renders the studio owner notification for proposal acceptance (TASK-0060 / AC-4, AC-6).
 */
export function renderProposalAcceptedOwnerEmail({
  proposal,
  clientName,
  studioName,
  locale = 'en',
  baseUrl = '',
}: RenderProposalAcceptedOwnerParams): RenderedEmail {
  const isGerman = locale?.toLowerCase().startsWith('de');
  const activeLocale = isGerman ? 'de' : 'en';
  const dict = isGerman
    ? deMessages.emails.proposal.acceptedOwner
    : enMessages.emails.proposal.acceptedOwner;

  const sanitizedStudio = sanitizeStudioName(studioName);
  const sanitizedTitle = sanitizeSingleLine(proposal.title, 'Proposal');
  const sanitizedClient = sanitizeSingleLine(clientName, isGerman ? 'Kunde' : 'Client');
  const packageName = sanitizeSingleLine(proposal.packageName, isGerman ? 'Paket' : 'Package');
  const acceptedByName = sanitizeSingleLine(proposal.acceptedByName, sanitizedClient);
  const acceptedByEmail = sanitizeSingleLine(proposal.acceptedByEmail, '');

  const formattedAmount = formatCurrency(proposal.totalMinor, proposal.currency, activeLocale);

  const safeBaseUrl = (baseUrl ?? '').replaceAll(/\/+$/g, '');
  const projectUrl = safeBaseUrl
    ? `${safeBaseUrl}/projects/${proposal.projectId}`
    : `/projects/${proposal.projectId}`;

  const subject = dict.subject
    .replace('{title}', sanitizedTitle)
    .replaceAll(/[\r\n\x00]+/g, ' ')
    .trim();

  // --- Plain-text template ---
  const textLines: string[] = [
    dict.greeting.replace('{studioName}', sanitizedStudio),
    '',
    dict.intro.replace('{title}', sanitizedTitle).replace('{clientName}', sanitizedClient),
    '',
    dict.proposalTitle.replace('{title}', sanitizedTitle),
    dict.packageTitle.replace('{packageName}', packageName),
    dict.totalAmount.replace('{amount}', formattedAmount),
  ];

  if (acceptedByName || acceptedByEmail) {
    textLines.push(
      dict.acceptedBy
        .replace('{acceptedByName}', acceptedByName)
        .replace('{acceptedByEmail}', acceptedByEmail || 'N/A'),
    );
  }

  textLines.push('');
  textLines.push(dict.linkText.replace('{url}', projectUrl));
  textLines.push('');
  textLines.push(dict.footer);

  const text = textLines.join('\n');

  // --- Responsive HTML template ---
  const htmlGreeting = escapeHtml(dict.greeting.replace('{studioName}', sanitizedStudio));
  const htmlIntro = escapeHtml(
    dict.intro.replace('{title}', sanitizedTitle).replace('{clientName}', sanitizedClient),
  );
  const htmlPackageTitle = escapeHtml(packageName);
  const htmlAmount = escapeHtml(formattedAmount);
  const htmlAcceptedBy = escapeHtml(
    dict.acceptedBy
      .replace('{acceptedByName}', acceptedByName)
      .replace('{acceptedByEmail}', acceptedByEmail || 'N/A'),
  );
  const htmlButtonText = escapeHtml(dict.buttonText);
  const htmlFooter = escapeHtml(dict.footer);

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
          <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">${escapeHtml(isGerman ? 'Paket' : 'Package')}</div>
          <div style="font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">${htmlPackageTitle}</div>
          <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">${escapeHtml(isGerman ? 'Gesamtbetrag' : 'Total Amount')}</div>
          <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">${htmlAmount}</div>
          <div style="font-size: 13px; color: #475569;">${htmlAcceptedBy}</div>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${escapeHtml(projectUrl)}" style="display: inline-block; padding: 12px 28px; background-color: #0f172a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;">${htmlButtonText}</a>
        </div>
        <p style="font-size: 13px; line-height: 20px; color: #64748b; word-break: break-all;">
          ${escapeHtml(dict.linkText.replace('{url}', ''))} <a href="${escapeHtml(projectUrl)}" style="color: #2563eb;">${escapeHtml(projectUrl)}</a>
        </p>
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

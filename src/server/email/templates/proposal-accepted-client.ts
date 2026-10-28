import 'server-only';
import { formatCurrency } from '@/lib/formatters';
import { sanitizeStudioName, type RenderedEmail } from '@/server/email/templates';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

export interface AcceptedAddonItem {
  name: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface ProposalAcceptedClientEmailPayload {
  id: string;
  title: string;
  packageName?: string | null;
  includedItems?: string[];
  selectedAddons?: AcceptedAddonItem[];
  totalMinor: number;
  currency: string;
}

export interface RenderProposalAcceptedClientParams {
  proposal: ProposalAcceptedClientEmailPayload;
  clientName?: string | null;
  studioName?: string | null;
  locale?: string | null;
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
 * Renders the localized proposal acceptance confirmation for the client (TASK-0060 / AC-4, AC-6).
 */
export function renderProposalAcceptedClientEmail({
  proposal,
  clientName,
  studioName,
  locale = 'en',
}: RenderProposalAcceptedClientParams): RenderedEmail {
  const isGerman = locale?.toLowerCase().startsWith('de');
  const activeLocale = isGerman ? 'de' : 'en';
  const dict = isGerman
    ? deMessages.emails.proposal.acceptedClient
    : enMessages.emails.proposal.acceptedClient;

  const sanitizedStudio = sanitizeStudioName(studioName);
  const sanitizedTitle = sanitizeSingleLine(proposal.title, 'Proposal');
  const sanitizedClient = sanitizeSingleLine(clientName, isGerman ? 'Kunde' : 'Client');
  const packageName = sanitizeSingleLine(proposal.packageName, isGerman ? 'Paket' : 'Package');

  const formattedAmount = formatCurrency(proposal.totalMinor, proposal.currency, activeLocale);

  const subject = dict.subject
    .replace('{title}', sanitizedTitle)
    .replaceAll(/[\r\n\x00]+/g, ' ')
    .trim();

  // --- Plain-text template ---
  const textLines: string[] = [
    dict.greeting.replace('{clientName}', sanitizedClient),
    '',
    dict.intro,
    '',
    dict.proposalTitle.replace('{title}', sanitizedTitle),
    dict.packageTitle.replace('{packageName}', packageName),
  ];

  if (proposal.includedItems && proposal.includedItems.length > 0) {
    textLines.push('');
    textLines.push(dict.includedItems);
    for (const item of proposal.includedItems) {
      textLines.push(`  - ${sanitizeSingleLine(item)}`);
    }
  }

  textLines.push('');
  textLines.push(dict.addonsTitle);
  if (proposal.selectedAddons && proposal.selectedAddons.length > 0) {
    for (const addon of proposal.selectedAddons) {
      const addonPrice = formatCurrency(
        addon.unitPriceMinor * addon.quantity,
        proposal.currency,
        activeLocale,
      );
      const qtyStr = addon.quantity > 1 ? ` (${String(addon.quantity)}x)` : '';
      textLines.push(`  - ${sanitizeSingleLine(addon.name)}${qtyStr}: ${addonPrice}`);
    }
  } else {
    textLines.push(`  ${dict.noAddons}`);
  }

  textLines.push('');
  textLines.push(dict.totalAmount.replace('{amount}', formattedAmount));
  textLines.push('');
  textLines.push(dict.nextSteps);
  textLines.push('');
  textLines.push(dict.contactInfo.replace('{studioName}', sanitizedStudio));
  textLines.push('');
  textLines.push(dict.footer);

  const text = textLines.join('\n');

  // --- Responsive HTML template ---
  const htmlGreeting = escapeHtml(dict.greeting.replace('{clientName}', sanitizedClient));
  const htmlIntro = escapeHtml(dict.intro);
  const htmlPackageTitle = escapeHtml(packageName);
  const htmlAmount = escapeHtml(formattedAmount);
  const htmlNextSteps = escapeHtml(dict.nextSteps);
  const htmlContactInfo = escapeHtml(dict.contactInfo.replace('{studioName}', sanitizedStudio));
  const htmlFooter = escapeHtml(dict.footer);

  let includedHtml = '';
  if (proposal.includedItems && proposal.includedItems.length > 0) {
    const listItems = proposal.includedItems
      .map((item) => `<li style="margin-bottom: 6px;">${escapeHtml(sanitizeSingleLine(item))}</li>`)
      .join('');
    includedHtml = `
      <div style="margin-top: 16px;">
        <div style="font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 8px;">${escapeHtml(dict.includedItems)}</div>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 20px; color: #334155;">
          ${listItems}
        </ul>
      </div>`;
  }

  let addonsHtml = '';
  if (proposal.selectedAddons && proposal.selectedAddons.length > 0) {
    const addonRows = proposal.selectedAddons
      .map((addon) => {
        const price = formatCurrency(
          addon.unitPriceMinor * addon.quantity,
          proposal.currency,
          activeLocale,
        );
        const qty = addon.quantity > 1 ? ` (${String(addon.quantity)}x)` : '';
        return `
          <tr>
            <td style="padding: 6px 0; font-size: 14px; color: #334155;">${escapeHtml(sanitizeSingleLine(addon.name))}${escapeHtml(qty)}</td>
            <td style="padding: 6px 0; font-size: 14px; color: #0f172a; text-align: right; font-weight: 500;">${escapeHtml(price)}</td>
          </tr>`;
      })
      .join('');
    addonsHtml = `
      <div style="margin-top: 16px;">
        <div style="font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 8px;">${escapeHtml(dict.addonsTitle)}</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0;">
          ${addonRows}
        </table>
      </div>`;
  }

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
          <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">${escapeHtml(isGerman ? 'Ausgewähltes Paket' : 'Accepted Package')}</div>
          <div style="font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 8px;">${htmlPackageTitle}</div>
          ${includedHtml}
          ${addonsHtml}
          <div style="border-top: 1px solid #cbd5e1; margin-top: 16px; padding-top: 12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size: 16px; font-weight: 600; color: #0f172a;">${escapeHtml(isGerman ? 'Gesamtbetrag' : 'Total Amount')}</td>
                <td style="font-size: 20px; font-weight: 700; color: #0f172a; text-align: right;">${htmlAmount}</td>
              </tr>
            </table>
          </div>
        </div>
        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 14px; line-height: 20px; color: #065f46;">${htmlNextSteps}</p>
        </div>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: #475569;">${htmlContactInfo}</p>
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

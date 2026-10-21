import { getAllCategoryDefinitions } from './categories';
import type { ExportCollectedData } from './types';

/**
 * Escapes characters with special meaning in HTML to prevent XSS.
 * Guarantees that injected tags like `<img src=x onerror=alert(1)>`
 * are rendered as inert text entities.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = '';
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const GERMAN_COLUMN_HEADERS: Record<string, string> = {
  project: 'Projekt',
  project_title: 'Projekt',
  stage: 'Phase',
  stage_name: 'Phase',
  shoot_date: 'Shooting-Datum',
  shooting_date: 'Shooting-Datum',
  locations: 'Orte',
  timeline: 'Zeitplan',
  tasks: 'Aufgaben',
  participants: 'Teilnehmer',
  role: 'Rolle',
  starts_at: 'Beginn',
  ends_at: 'Ende',
  duration_minutes: 'Dauer (Min.)',
  location_type: 'Ort / Typ',
  location_details: 'Ortsdetails',
  meet_url: 'Google Meet',
  attendee_name: 'Teilnehmer',
  attendee_email: 'E-Mail',
  attendee_phone: 'Telefon',
  attendee_notes: 'Notizen',
  cancellation_reason: 'Grund der Absage',
  cancelled_at: 'Abgesagt am',
};

/**
 * Formats a raw database / schema column identifier (e.g. `display_name`, `client.created`, `occurred_at`)
 * into a human-readable Title Case column header, localized for en/de.
 */
export function formatColumnHeader(key: string, locale: 'en' | 'de' = 'en'): string {
  if (!key) return '';
  if (locale === 'de') {
    const germanHeader = GERMAN_COLUMN_HEADERS[key.toLowerCase()];
    if (germanHeader) {
      return germanHeader;
    }
  }
  const acronyms = new Set(['id', 'ip', 'url', 'vat', 'gdpr', 'ccpa', 'dsar']);
  return key
    .replace(/[._]/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => {
      if (acronyms.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Renders an accessible, localized HTML table for DSAR export categories.
 */
export function formatHtmlTable(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  label = 'Data Table',
): string {
  const thead = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '-')}</td>`).join('')}</tr>`)
    .join('');

  return `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escapeHtml(label)}">
  <table class="data-table">
    <thead>
      <tr>${thead}</tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>
</div>`;
}

const UI_STRINGS = {
  en: {
    docTitle: 'Personal Data Export (GDPR Art. 15 / CCPA)',
    headerTitle: 'Personal Data Export',
    subtitle: 'Data Subject Access Request per Art. 15 GDPR & CCPA',
    generatedAt: 'Generated at',
    controller: 'Data Controller (Studio)',
    subjectTitle: 'Data Subject',
    subjectId: 'Subject ID',
    fullName: 'Name',
    firstName: 'First Name',
    lastName: 'Last Name',
    email: 'Email Address',
    phone: 'Phone Number',
    role: 'Role',
    createdAt: 'Created At',
    updatedAt: 'Updated At',
    disclosuresHeading: 'GDPR Processing Information (Art. 15(1))',
    purposeLabel: 'Purpose of Processing',
    lawfulBasisLabel: 'Lawful Basis',
    retentionLabel: 'Retention Period',
    recipientsLabel: 'Recipients',
    sourceLabel: 'Source of Data',
    noData: 'No records stored in this category.',
    rightsHeading: 'Your Rights as a Data Subject',
    rightsIntro:
      'Pursuant to Chapter III of Regulation (EU) 2016/679 (GDPR), you possess the following rights regarding the personal data processed by the studio:',
    art16Title: 'Right to Rectification (Art. 16 GDPR)',
    art16Desc:
      'You have the right to request the correction of inaccurate personal data or completion of incomplete data without undue delay.',
    art17Title: 'Right to Erasure / "To Be Forgotten" (Art. 17 GDPR)',
    art17Desc:
      'You may request the deletion of your personal data when it is no longer necessary for the original purposes, provided no statutory retention obligations (e.g. tax laws) preclude deletion.',
    art18Title: 'Right to Restriction of Processing (Art. 18 GDPR)',
    art18Desc:
      'You have the right to demand the restriction of processing while accuracy is contested or if processing is unlawful and you oppose erasure.',
    art20Title: 'Right to Data Portability (Art. 20 GDPR)',
    art20Desc:
      'You have the right to receive the personal data concerning you in a structured, commonly used and machine-readable format (JSON).',
    art21Title: 'Right to Object (Art. 21 GDPR)',
    art21Desc:
      'You have the right to object at any time to the processing of personal data based on legitimate interests (Art. 6(1)(f) GDPR).',
    art7Title: 'Right to Withdraw Consent (Art. 7(3) GDPR)',
    art7Desc:
      'Where processing is based on consent (e.g. marketing or portfolio image usage), you may withdraw that consent at any time with future effect.',
    art77Title: 'Right to Lodge a Complaint with a Supervisory Authority (Art. 77 GDPR)',
    art77Desc:
      'You have the right to lodge a complaint with a competent data protection supervisory authority if you believe that processing of your personal data infringes data protection law.',
    fieldLabel: 'Attribute',
    valueLabel: 'Stored Value',
  },
  de: {
    docTitle: 'Datenauskunft (Art. 15 DSGVO / CCPA)',
    headerTitle: 'Auskunft über personenbezogene Daten',
    subtitle: 'Auskunftsersuchen der betroffenen Person gemäß Art. 15 DSGVO & CCPA',
    generatedAt: 'Erstellt am',
    controller: 'Verantwortliche Stelle (Studio)',
    subjectTitle: 'Betroffene Person',
    subjectId: 'Personen-ID',
    fullName: 'Name',
    firstName: 'Vorname',
    lastName: 'Nachname',
    email: 'E-Mail-Adresse',
    phone: 'Telefonnummer',
    role: 'Rolle',
    createdAt: 'Erfasst am',
    updatedAt: 'Zuletzt aktualisiert am',
    disclosuresHeading: 'Verarbeitungsinformationen gemäß Art. 15 Abs. 1 DSGVO',
    purposeLabel: 'Verarbeitungszweck',
    lawfulBasisLabel: 'Rechtsgrundlage',
    retentionLabel: 'Speicherdauer',
    recipientsLabel: 'Empfänger',
    sourceLabel: 'Datenherkunft',
    noData: 'In dieser Kategorie sind derzeit keine Datensätze gespeichert.',
    rightsHeading: 'Ihre Rechte als betroffene Person',
    rightsIntro:
      'Gemäß Kapitel III der Verordnung (EU) 2016/679 (DSGVO) stehen Ihnen gegenüber der verantwortlichen Stelle die folgenden Rechte zu:',
    art16Title: 'Recht auf Berichtigung (Art. 16 DSGVO)',
    art16Desc:
      'Sie haben das Recht, unverzüglich die Berichtigung Sie betreffender unrichtiger personenbezogener Daten oder deren Vervollständigung zu verlangen.',
    art17Title: 'Recht auf Löschung / „Recht auf Vergessenwerden“ (Art. 17 DSGVO)',
    art17Desc:
      'Sie können die Löschung Ihrer Daten verlangen, wenn diese für die Zwecke nicht mehr erforderlich sind und keine gesetzlichen Aufbewahrungspflichten (z. B. steuerrechtliche Pflichten) entgegenstehen.',
    art18Title: 'Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)',
    art18Desc:
      'Sie haben das Recht, die Einschränkung der Verarbeitung zu verlangen, solange die Richtigkeit der Daten geprüft wird oder wenn eine Löschung abgelehnt wird.',
    art20Title: 'Recht auf Datenübertragbarkeit (Art. 20 DSGVO)',
    art20Desc:
      'Sie haben das Recht, die Sie betreffenden personenbezogenen Daten in einem strukturierten, gängigen und maschinenlesbaren Format (JSON) zu erhalten.',
    art21Title: 'Widerspruchsrecht (Art. 21 DSGVO)',
    art21Desc:
      'Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung Sie betreffender Daten Widerspruch einzulegen (Art. 6 Abs. 1 lit. f DSGVO).',
    art7Title: 'Recht auf Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO)',
    art7Desc:
      'Beruht eine Verarbeitung auf Ihrer Einwilligung (z. B. Werbekontakt oder Bildnutzung), können Sie diese jederzeit mit Wirkung für die Zukunft widerrufen.',
    art77Title: 'Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)',
    art77Desc:
      'Sie haben das Recht auf Beschwerde bei einer zuständigen Datenschutz-Aufsichtsbehörde, wenn Sie der Ansicht sind, dass die Verarbeitung Ihrer Daten gegen Datenschutzrecht verstößt.',
    fieldLabel: 'Attribut',
    valueLabel: 'Gespeicherter Wert',
  },
};

/**
 * Generates a clean, accessible, print-optimized self-contained HTML document.
 * Adheres strictly to security directives: ZERO script tags, ZERO event handlers,
 * ZERO external resource URLs (http:/https://).
 */
export function generateHtmlExport(data: ExportCollectedData, locale: 'en' | 'de'): string {
  const strings = UI_STRINGS[locale];
  const s = data.subject;
  const studio = data.studio;

  const titleText = `${strings.docTitle} – ${s.display_name} · ${studio.name}`;

  // Assemble HTML tables for each category
  const categoriesHtml: string[] = [];
  const registeredCats = getAllCategoryDefinitions();

  for (const catDef of registeredCats) {
    // Subject is rendered separately in the top section
    if (catDef.id === 'subject') continue;

    const items = data.categories[catDef.id] ?? [];
    const catTitle = catDef.title[locale];
    const catPurpose = catDef.purpose[locale];
    const catLawfulBasis = catDef.lawfulBasis[locale];
    const catRetention = catDef.retention[locale];
    const catRecipients = catDef.recipients[locale];
    const catSource = catDef.source[locale];

    let itemsTableHtml = '';
    if (items.length === 0) {
      itemsTableHtml = `<p class="empty-notice">${escapeHtml(strings.noData)}</p>`;
    } else {
      // Build accessible table for category items
      const keys = Array.from(
        new Set(
          items.flatMap((item) => (item && typeof item === 'object' ? Object.keys(item) : [])),
        ),
      );

      itemsTableHtml = `
        <div class="table-wrapper" tabindex="0" role="region" aria-label="${escapeHtml(catTitle)}">
          <table class="data-table">
            <thead>
              <tr>
                ${keys.map((k) => `<th scope="col">${escapeHtml(formatColumnHeader(k, locale))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (item) => `
                <tr>
                  ${keys
                    .map((k) => {
                      const val = (item as Record<string, unknown>)[k];
                      return `<td>${escapeHtml(val)}</td>`;
                    })
                    .join('')}
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    categoriesHtml.push(`
      <section class="category-card" aria-labelledby="cat-heading-${escapeHtml(catDef.id)}">
        <h2 id="cat-heading-${escapeHtml(catDef.id)}" class="category-heading">${escapeHtml(catTitle)}</h2>
        <div class="disclosures-card">
          <h3 class="disclosures-subheading">${escapeHtml(strings.disclosuresHeading)}</h3>
          <dl class="disclosures-grid">
            <dt>${escapeHtml(strings.purposeLabel)}:</dt>
            <dd>${escapeHtml(catPurpose)}</dd>
            <dt>${escapeHtml(strings.lawfulBasisLabel)}:</dt>
            <dd>${escapeHtml(catLawfulBasis)}</dd>
            <dt>${escapeHtml(strings.retentionLabel)}:</dt>
            <dd>${escapeHtml(catRetention)}</dd>
            <dt>${escapeHtml(strings.recipientsLabel)}:</dt>
            <dd>${escapeHtml(catRecipients)}</dd>
            <dt>${escapeHtml(strings.sourceLabel)}:</dt>
            <dd>${escapeHtml(catSource)}</dd>
          </dl>
        </div>
        ${itemsTableHtml}
      </section>
    `);
  }

  // Construct complete document
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(titleText)}</title>
  <style>
    /* Reset & Base Typography */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      color: #1a1a1a;
      background-color: #f9fafb;
      padding: 2rem 1.5rem;
    }
    .document-container {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 2.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    header.document-header {
      border-bottom: 2px solid #111827;
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #111827;
      margin-bottom: 0.5rem;
    }
    .doc-subtitle {
      font-size: 0.95rem;
      color: #4b5563;
      margin-bottom: 1rem;
    }
    .header-metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 0.75rem;
      background: #f3f4f6;
      padding: 1rem;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    .header-metadata strong {
      color: #111827;
    }
    section.subject-section {
      margin-bottom: 2.5rem;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 1.5rem;
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #111827;
      margin-bottom: 1rem;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 0.5rem;
    }
    h3 {
      font-size: 0.95rem;
      font-weight: 600;
      color: #374151;
      margin-bottom: 0.75rem;
    }
    .subject-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
      font-size: 0.875rem;
    }
    .subject-item {
      display: flex;
      flex-direction: column;
    }
    .subject-item span.label {
      font-weight: 500;
      color: #6b7280;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .subject-item span.value {
      font-weight: 600;
      color: #111827;
      word-break: break-word;
    }
    .category-card {
      margin-bottom: 2.5rem;
      page-break-inside: avoid;
    }
    .disclosures-card {
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      padding: 1rem;
      margin-bottom: 1rem;
      font-size: 0.825rem;
    }
    .disclosures-grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      row-gap: 0.4rem;
      column-gap: 0.75rem;
    }
    .disclosures-grid dt {
      font-weight: 600;
      color: #475569;
    }
    .disclosures-grid dd {
      color: #1e293b;
    }
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      margin-top: 0.75rem;
    }
    .table-wrapper:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 1px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.825rem;
      text-align: left;
    }
    table.data-table th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: 600;
      padding: 0.6rem 0.75rem;
      border: 1px solid #cbd5e1;
      white-space: nowrap;
    }
    table.data-table td {
      padding: 0.6rem 0.75rem;
      border: 1px solid #e2e8f0;
      color: #334155;
      word-break: break-word;
    }
    table.data-table tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }
    .empty-notice {
      font-size: 0.875rem;
      color: #64748b;
      font-style: italic;
      padding: 0.5rem 0;
    }
    .rights-section {
      background: #fafaf9;
      border: 1px solid #e7e5e4;
      border-radius: 6px;
      padding: 1.5rem;
      margin-top: 3rem;
      page-break-inside: avoid;
    }
    .rights-intro {
      font-size: 0.875rem;
      color: #44403c;
      margin-bottom: 1rem;
    }
    .rights-list {
      list-style: none;
      font-size: 0.825rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .rights-list li {
      padding-left: 1.25rem;
      position: relative;
      color: #292524;
    }
    .rights-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #78716c;
      font-weight: bold;
    }
    .rights-list strong {
      color: #1c1917;
    }
    /* Print Optimization */
    @media print {
      body {
        background: #ffffff;
        color: #000000;
        padding: 0;
      }
      .document-container {
        border: none;
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
      .category-card {
        break-inside: avoid;
      }
      table.data-table {
        page-break-inside: auto;
      }
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      thead {
        display: table-header-group;
      }
    }
  </style>
</head>
<body>
  <div class="document-container">
    <header class="document-header">
      <h1>${escapeHtml(strings.headerTitle)}</h1>
      <p class="doc-subtitle">${escapeHtml(strings.subtitle)}</p>
      <div class="header-metadata">
        <div><strong>${escapeHtml(strings.controller)}:</strong> ${escapeHtml(studio.name)}</div>
        <div><strong>${escapeHtml(strings.generatedAt)}:</strong> ${escapeHtml(data.generated_at)}</div>
      </div>
    </header>

    <main>
      <!-- Subject Details -->
      <section class="subject-section" aria-labelledby="subject-heading">
        <h2 id="subject-heading">${escapeHtml(strings.subjectTitle)}</h2>
        <div class="subject-grid">
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.fullName)}</span>
            <span class="value">${escapeHtml(s.display_name)}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.firstName)}</span>
            <span class="value">${escapeHtml(s.first_name ?? '-')}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.lastName)}</span>
            <span class="value">${escapeHtml(s.last_name ?? '-')}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.email)}</span>
            <span class="value">${escapeHtml(s.email ?? '-')}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.phone)}</span>
            <span class="value">${escapeHtml(s.phone ?? '-')}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.role)}</span>
            <span class="value">${escapeHtml(s.role)}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.subjectId)}</span>
            <span class="value">${escapeHtml(s.id)}</span>
          </div>
          <div class="subject-item">
            <span class="label">${escapeHtml(strings.createdAt)}</span>
            <span class="value">${escapeHtml(s.created_at)}</span>
          </div>
        </div>
      </section>

      <!-- Category Data & Art. 15 Disclosures -->
      ${categoriesHtml.join('\n')}

      <!-- GDPR Chapter III Rights Disclosures -->
      <section class="rights-section" aria-labelledby="rights-heading">
        <h2 id="rights-heading">${escapeHtml(strings.rightsHeading)}</h2>
        <p class="rights-intro">${escapeHtml(strings.rightsIntro)}</p>
        <ul class="rights-list">
          <li><strong>${escapeHtml(strings.art16Title)}:</strong> ${escapeHtml(strings.art16Desc)}</li>
          <li><strong>${escapeHtml(strings.art17Title)}:</strong> ${escapeHtml(strings.art17Desc)}</li>
          <li><strong>${escapeHtml(strings.art18Title)}:</strong> ${escapeHtml(strings.art18Desc)}</li>
          <li><strong>${escapeHtml(strings.art20Title)}:</strong> ${escapeHtml(strings.art20Desc)}</li>
          <li><strong>${escapeHtml(strings.art21Title)}:</strong> ${escapeHtml(strings.art21Desc)}</li>
          <li><strong>${escapeHtml(strings.art7Title)}:</strong> ${escapeHtml(strings.art7Desc)}</li>
          <li><strong>${escapeHtml(strings.art77Title)}:</strong> ${escapeHtml(strings.art77Desc)}</li>
        </ul>
      </section>
    </main>
  </div>
</body>
</html>`;
}

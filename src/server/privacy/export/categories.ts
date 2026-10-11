/**
 * Typed category registry for GDPR Art. 15(1) disclosures.
 *
 * Maps each export data category to its processing purpose, lawful basis,
 * retention period, recipients, and source.
 */

export interface CategoryDisclosureText {
  en: string;
  de: string;
}

export interface CategoryDefinition {
  id: string;
  titleKey: string;
  purposeKey: string;
  lawfulBasisKey: string;
  retentionKey: string;
  recipientsKey: string;
  sourceKey: string;
  title: CategoryDisclosureText;
  purpose: CategoryDisclosureText;
  lawfulBasis: CategoryDisclosureText;
  retention: CategoryDisclosureText;
  recipients: CategoryDisclosureText;
  source: CategoryDisclosureText;
}

export const INITIAL_CATEGORIES: readonly CategoryDefinition[] = [
  {
    id: 'subject',
    titleKey: 'privacy.export.categories.subject.title',
    purposeKey: 'privacy.export.categories.subject.purpose',
    lawfulBasisKey: 'privacy.export.categories.subject.lawful_basis',
    retentionKey: 'privacy.export.categories.subject.retention',
    recipientsKey: 'privacy.export.categories.subject.recipients',
    sourceKey: 'privacy.export.categories.subject.source',
    title: {
      en: 'Contact Details',
      de: 'Kontaktdaten',
    },
    purpose: {
      en: 'Direct communication, identification, and client relationship management.',
      de: 'Direkte Kommunikation, Identifikation und Kundenbetreuung.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract / pre-contractual measures).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung / vorvertragliche Maßnahmen).',
    },
    retention: {
      en: '36 months following last activity, unless statutory retention applies.',
      de: '36 Monate nach der letzten Aktivität, sofern keine gesetzlichen Aufbewahrungsfristen bestehen.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Provided directly by the data subject.',
      de: 'Direkt von der betroffenen Person bereitgestellt.',
    },
  },
  {
    id: 'client',
    titleKey: 'privacy.export.categories.client.title',
    purposeKey: 'privacy.export.categories.client.purpose',
    lawfulBasisKey: 'privacy.export.categories.client.lawful_basis',
    retentionKey: 'privacy.export.categories.client.retention',
    recipientsKey: 'privacy.export.categories.client.recipients',
    sourceKey: 'privacy.export.categories.client.source',
    title: {
      en: 'Client Profile',
      de: 'Kundenprofil',
    },
    purpose: {
      en: 'Customer account management, language preference, and project organization.',
      de: 'Verwaltung des Kundenkontos, Sprachpräferenz und Projektorganisation.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).',
    },
    retention: {
      en: '36 months following last activity.',
      de: '36 Monate nach der letzten Kundenaktivität.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Provided directly by the data subject or collected upon inquiry.',
      de: 'Direkt von der betroffenen Person bereitgestellt oder bei Anfrage erfasst.',
    },
  },
  {
    id: 'addresses',
    titleKey: 'privacy.export.categories.addresses.title',
    purposeKey: 'privacy.export.categories.addresses.purpose',
    lawfulBasisKey: 'privacy.export.categories.addresses.lawful_basis',
    retentionKey: 'privacy.export.categories.addresses.retention',
    recipientsKey: 'privacy.export.categories.addresses.recipients',
    sourceKey: 'privacy.export.categories.addresses.source',
    title: {
      en: 'Addresses',
      de: 'Adressen',
    },
    purpose: {
      en: 'Postal correspondence, shoot location logistics, and invoice preparation.',
      de: 'Postalischer Schriftverkehr, Logistik des Aufnahmeortes und Rechnungsstellung.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) & (c) GDPR (Contract performance and statutory tax obligations).',
      de: 'Art. 6 Abs. 1 lit. b und c DSGVO (Vertragserfüllung und steuerrechtliche Aufbewahrungspflichten).',
    },
    retention: {
      en: '10 years for billing addresses (§ 147 AO, § 257 HGB); 36 months post-inactivity for postal addresses.',
      de: '10 Jahre für Rechnungsadressen (§ 147 AO, § 257 HGB); 36 Monate nach Inaktivität für Postadressen.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Provided directly by the data subject.',
      de: 'Direkt von der betroffenen Person bereitgestellt.',
    },
  },
  {
    id: 'tags',
    titleKey: 'privacy.export.categories.tags.title',
    purposeKey: 'privacy.export.categories.tags.purpose',
    lawfulBasisKey: 'privacy.export.categories.tags.lawful_basis',
    retentionKey: 'privacy.export.categories.tags.retention',
    recipientsKey: 'privacy.export.categories.tags.recipients',
    sourceKey: 'privacy.export.categories.tags.source',
    title: {
      en: 'Tags & Labels',
      de: 'Schlagwörter & Kennzeichnungen',
    },
    purpose: {
      en: 'Internal studio workflow categorization and service segmentation.',
      de: 'Interne Arbeitsablauf-Kategorisierung und Kundensegmentierung des Studios.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(f) GDPR (Legitimate interest in efficient studio administration).',
      de: 'Art. 6 Abs. 1 lit. f DSGVO (Berechtigtes Interesse an effizienter Studioverwaltung).',
    },
    retention: {
      en: 'Associated for the duration of the client profile.',
      de: 'Zugeordnet für die Dauer des Kundenprofils.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Assigned internally by the studio owner.',
      de: 'Intern durch die Studioinhaberin / den Studioinhaber vergeben.',
    },
  },
  {
    id: 'notes',
    titleKey: 'privacy.export.categories.notes.title',
    purposeKey: 'privacy.export.categories.notes.purpose',
    lawfulBasisKey: 'privacy.export.categories.notes.lawful_basis',
    retentionKey: 'privacy.export.categories.notes.retention',
    recipientsKey: 'privacy.export.categories.notes.recipients',
    sourceKey: 'privacy.export.categories.notes.source',
    title: {
      en: 'Notes & Memoranda',
      de: 'Notizen & Vermerke',
    },
    purpose: {
      en: 'Operational notes, creative preferences, and project requirements.',
      de: 'Betriebliche Notizen, gestalterische Wünsche und Projektanforderungen.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) & (f) GDPR (Contract preparation, execution, and client care).',
      de: 'Art. 6 Abs. 1 lit. b und f DSGVO (Vertragsvorbereitung, Ausführung und Kundenbetreuung).',
    },
    retention: {
      en: '36 months following last activity.',
      de: '36 Monate nach der letzten Aktivität.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Recorded by the studio owner based on client consultations.',
      de: 'Vom Studioinhaber auf Grundlage von Kundengesprächen erfasst.',
    },
  },
  {
    id: 'timeline',
    titleKey: 'privacy.export.categories.timeline.title',
    purposeKey: 'privacy.export.categories.timeline.purpose',
    lawfulBasisKey: 'privacy.export.categories.timeline.lawful_basis',
    retentionKey: 'privacy.export.categories.timeline.retention',
    recipientsKey: 'privacy.export.categories.timeline.recipients',
    sourceKey: 'privacy.export.categories.timeline.source',
    title: {
      en: 'Timeline & History',
      de: 'Verlauf & Historie',
    },
    purpose: {
      en: 'Chronological tracking of communications, project milestones, and relationship lifecycle.',
      de: 'Chronologische Nachverfolgung von Kommunikation, Projektmeilensteinen und Kundenbeziehung.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) & (f) GDPR (Documentation of contractual execution).',
      de: 'Art. 6 Abs. 1 lit. b und f DSGVO (Dokumentation der vertraglichen Ausführung).',
    },
    retention: {
      en: '36 months following last activity.',
      de: '36 Monate nach der letzten Aktivität.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Automatically recorded upon system events and client interactions.',
      de: 'Automatisch protokolliert bei Systemereignissen und Kundeninteraktionen.',
    },
  },
  {
    id: 'consents',
    titleKey: 'privacy.export.categories.consents.title',
    purposeKey: 'privacy.export.categories.consents.purpose',
    lawfulBasisKey: 'privacy.export.categories.consents.lawful_basis',
    retentionKey: 'privacy.export.categories.consents.retention',
    recipientsKey: 'privacy.export.categories.consents.recipients',
    sourceKey: 'privacy.export.categories.consents.source',
    title: {
      en: 'Consent Records',
      de: 'Einwilligungsnachweise',
    },
    purpose: {
      en: 'Accountability and compliance proof for marketing and portrait image usage.',
      de: 'Nachweisbarkeit und Dokumentation erteilter Einwilligungen für Werbung und Bildnutzung.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(a), Art. 7(1) GDPR & § 22 KUG (Consent and accountability obligation).',
      de: 'Art. 6 Abs. 1 lit. a, Art. 7 Abs. 1 DSGVO & § 22 KUG (Einwilligung und Rechenschaftspflicht).',
    },
    retention: {
      en: '36 months after consent withdrawal or expiration for evidence and legal defense.',
      de: '36 Monate nach Widerruf oder Ablauf der Einwilligung zu Beweiszwecken.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Declared directly by the data subject.',
      de: 'Direkt von der betroffenen Person erklärt.',
    },
  },
  {
    id: 'audit',
    titleKey: 'privacy.export.categories.audit.title',
    purposeKey: 'privacy.export.categories.audit.purpose',
    lawfulBasisKey: 'privacy.export.categories.audit.lawful_basis',
    retentionKey: 'privacy.export.categories.audit.retention',
    recipientsKey: 'privacy.export.categories.audit.recipients',
    sourceKey: 'privacy.export.categories.audit.source',
    title: {
      en: 'Security & Access Audit',
      de: 'Sicherheits- & Zugriffsprotokoll',
    },
    purpose: {
      en: 'Security of processing, detection of unauthorized access, and accountability.',
      de: 'Sicherheit der Verarbeitung, Erkennung unbefugter Zugriffe und Nachweisführung.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(c) & Art. 32 GDPR (Legal obligation for technical and organizational security).',
      de: 'Art. 6 Abs. 1 lit. c und Art. 32 DSGVO (Rechtliche Verpflichtung zur technischen Sicherheit).',
    },
    retention: {
      en: '24 months (statutory log retention period).',
      de: '24 Monate (gesetzliche Protokollaufbewahrungsfrist).',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Recorded by the security subsystem.',
      de: 'Automatisch durch das Sicherheitssubsystem erfasst.',
    },
  },
  {
    id: 'legal_hold',
    titleKey: 'privacy.export.categories.legal_hold.title',
    purposeKey: 'privacy.export.categories.legal_hold.purpose',
    lawfulBasisKey: 'privacy.export.categories.legal_hold.lawful_basis',
    retentionKey: 'privacy.export.categories.legal_hold.retention',
    recipientsKey: 'privacy.export.categories.legal_hold.recipients',
    sourceKey: 'privacy.export.categories.legal_hold.source',
    title: {
      en: 'Legal Hold',
      de: 'Gesetzliche / rechtliche Aufbewahrungssperre',
    },
    purpose: {
      en: 'Preservation of records for statutory compliance or defense of legal claims.',
      de: 'Aufbewahrung von Daten zur Erf\u00fcllung gesetzlicher Pflichten oder zur Abwehr von Rechtsanspr\u00fcchen.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(c) & Art. 6(1)(f) GDPR (Legal obligation and legitimate interests).',
      de: 'Art. 6 Abs. 1 lit. c und lit. f DSGVO (Rechtliche Verpflichtung und berechtigte Interessen).',
    },
    retention: {
      en: 'Until release of legal hold or expiry of statutory retention period.',
      de: 'Bis zur Aufhebung der Sperre oder Ablauf der gesetzlichen Aufbewahrungsfrist.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschlie\u00dflich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Recorded by the studio owner.',
      de: 'Vom Studio-Inhaber erfasst.',
    },
  },
];

const categoryRegistry = new Map<string, CategoryDefinition>();

function initDefaultCategories(): void {
  for (const cat of INITIAL_CATEGORIES) {
    categoryRegistry.set(cat.id, cat);
  }
}

initDefaultCategories();

export function registerCategoryDefinition(def: CategoryDefinition): void {
  categoryRegistry.set(def.id, def);
}

export function getCategoryDefinition(id: string): CategoryDefinition | undefined {
  return categoryRegistry.get(id);
}

export function getAllCategoryDefinitions(): CategoryDefinition[] {
  return Array.from(categoryRegistry.values());
}

export function resetCategoryRegistry(): void {
  categoryRegistry.clear();
  initDefaultCategories();
}

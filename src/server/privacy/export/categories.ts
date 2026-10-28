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
  {
    id: 'google_contacts',
    titleKey: 'privacy.export.categories.google_contacts.title',
    purposeKey: 'privacy.export.categories.google_contacts.purpose',
    lawfulBasisKey: 'privacy.export.categories.google_contacts.lawful_basis',
    retentionKey: 'privacy.export.categories.google_contacts.retention',
    recipientsKey: 'privacy.export.categories.google_contacts.recipients',
    sourceKey: 'privacy.export.categories.google_contacts.source',
    title: {
      en: 'Third-Party Sync: Google Contacts',
      de: 'Drittanbieter-Synchronisierung: Google Kontakte',
    },
    purpose: {
      en: 'Caller ID identification on mobile devices during shoot days.',
      de: 'Anruferkennung auf Mobilgeräten an Drehtagen.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(f) GDPR (Legitimate interests: operational shoot day communication).',
      de: 'Art. 6 Abs. 1 lit. f DSGVO (Berechtigte Interessen: operative Kommunikation an Drehtagen).',
    },
    retention: {
      en: 'Synchronized during active opt-in; deleted upon toggle off, contact deletion, or erasure.',
      de: 'Synchronisiert während aktivem Opt-in; gelöscht bei Deaktivierung, Kontaktaufhebung oder Löschantrag.',
    },
    recipients: {
      en: 'Google LLC (1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA). Transfer safeguards: EU-U.S. Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs). Categories transmitted: Given name, family name, phone number(s).',
      de: 'Google LLC (1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA). Garantien: EU-U.S. Data Privacy Framework (DPF) und Standardvertragsklauseln (SCCs). Übermittelte Datenkategorien: Vorname, Nachname, Telefonnummer(n).',
    },
    source: {
      en: 'Synchronized from Ownlight contact details upon explicit client opt-in.',
      de: 'Synchronisiert aus Ownlight-Kontaktdaten nach ausdrücklichem Opt-in.',
    },
  },
  {
    id: 'leads',
    titleKey: 'privacy.export.categories.leads.title',
    purposeKey: 'privacy.export.categories.leads.purpose',
    lawfulBasisKey: 'privacy.export.categories.leads.lawful_basis',
    retentionKey: 'privacy.export.categories.leads.retention',
    recipientsKey: 'privacy.export.categories.leads.recipients',
    sourceKey: 'privacy.export.categories.leads.source',
    title: {
      en: 'Inquiry & Lead Details',
      de: 'Anfrage- & Lead-Details',
    },
    purpose: {
      en: 'Answering the inquiry and pre-contractual communication.',
      de: 'Beantwortung der Anfrage und vorvertragliche Kommunikation.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Pre-contractual measures upon request).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vorvertragliche Maßnahmen auf Anfrage).',
    },
    retention: {
      en: '12 months following last owner activity (configurable 1–36 months via LEAD_RETENTION_MONTHS).',
      de: '12 Monate nach der letzten Aktivität (konfigurierbar 1–36 Monate via LEAD_RETENTION_MONTHS).',
    },
    recipients: {
      en: "The studio's email provider, for the confirmation email.",
      de: 'Der E-Mail-Provider des Studios für die Bestätigungs-E-Mail.',
    },
    source: {
      en: 'Inquiry form submitted by the data subject.',
      de: 'Von der betroffenen Person übermitteltes Anfrageformular.',
    },
  },
  {
    id: 'converted_leads',
    titleKey: 'privacy.export.categories.converted_leads.title',
    purposeKey: 'privacy.export.categories.converted_leads.purpose',
    lawfulBasisKey: 'privacy.export.categories.converted_leads.lawful_basis',
    retentionKey: 'privacy.export.categories.converted_leads.retention',
    recipientsKey: 'privacy.export.categories.converted_leads.recipients',
    sourceKey: 'privacy.export.categories.converted_leads.source',
    title: {
      en: 'Inquiry & Conversion History',
      de: 'Anfrage- & Konvertierungshistorie',
    },
    purpose: {
      en: 'Documentation of pre-contractual inquiry and conversion history.',
      de: 'Dokumentation der vorvertraglichen Anfrage und Konvertierungshistorie.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract / pre-contractual measures).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung / vorvertragliche Maßnahmen).',
    },
    retention: {
      en: 'Retained for the duration of the client profile.',
      de: 'Gespeichert für die Dauer des Kundenprofils.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Inquiry form submitted by the data subject prior to conversion.',
      de: 'Von der betroffenen Person vor Konvertierung übermitteltes Anfrageformular.',
    },
  },
  {
    id: 'projects',
    titleKey: 'privacy.export.categories.projects.title',
    purposeKey: 'privacy.export.categories.projects.purpose',
    lawfulBasisKey: 'privacy.export.categories.projects.lawful_basis',
    retentionKey: 'privacy.export.categories.projects.retention',
    recipientsKey: 'privacy.export.categories.projects.recipients',
    sourceKey: 'privacy.export.categories.projects.source',
    title: {
      en: 'Projects & Shoots',
      de: 'Projekte & Shootings',
    },
    purpose: {
      en: 'Execution and fulfillment of photography commissions, shoot logistics, and client communication.',
      de: 'Durchführung und Erfüllung von Fotografieaufträgen, Shooting-Logistik und Kundenkommunikation.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract / pre-contractual measures).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung / vorvertragliche Maßnahmen).',
    },
    retention: {
      en: 'Statutory commercial and tax retention period (6 to 10 years for contracts and financial commission records under § 257 HGB / § 147 AO), or until project archive retention period expires.',
      de: 'Handels- und steuerrechtliche Aufbewahrungsfristen (6 bis 10 Jahre für Verträge und buchungsrelevante Unterlagen gemäß § 257 HGB / § 147 AO) bzw. Ablauf der Projektarchivierungsfrist.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Provided by the client or generated during project fulfillment.',
      de: 'Vom Kunden bereitgestellt oder im Rahmen der Projektdurchführung erfasst.',
    },
  },
  {
    id: 'appointments',
    titleKey: 'privacy.export.categories.appointments.title',
    purposeKey: 'privacy.export.categories.appointments.purpose',
    lawfulBasisKey: 'privacy.export.categories.appointments.lawful_basis',
    retentionKey: 'privacy.export.categories.appointments.retention',
    recipientsKey: 'privacy.export.categories.appointments.recipients',
    sourceKey: 'privacy.export.categories.appointments.source',
    title: {
      en: 'Appointments & Consultations',
      de: 'Termine & Beratungsgespräche',
    },
    purpose: {
      en: 'Scheduling and conducting client consultations, pre-shoot meetings, and booking sessions.',
      de: 'Planung und Durchführung von Kundenberatungen, Vorgesprächen und Buchungsterminen.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract / pre-contractual measures).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung / vorvertragliche Maßnahmen).',
    },
    retention: {
      en: 'Retained for schedule continuity; personal details anonymized upon subject erasure or retention expiry.',
      de: 'Gespeichert zur Wahrung der Terminübersicht; personenbezogene Angaben werden bei Betroffenenlöschung anonymisiert.',
    },
    recipients: {
      en: 'Calendar sync providers if enabled by studio owner (Google Calendar, CalDAV); otherwise stored locally.',
      de: 'Kalendersynchronisations-Dienste, sofern vom Studioinhaber aktiviert (Google Calendar, CalDAV); andernfalls ausschließlich lokal.',
    },
    source: {
      en: 'Provided by the attendee during booking or consultation scheduling.',
      de: 'Von der teilnehmenden Person bei der Terminvereinbarung angegeben.',
    },
  },
  {
    id: 'proposals',
    titleKey: 'privacy.export.categories.proposals.title',
    purposeKey: 'privacy.export.categories.proposals.purpose',
    lawfulBasisKey: 'privacy.export.categories.proposals.lawful_basis',
    retentionKey: 'privacy.export.categories.proposals.retention',
    recipientsKey: 'privacy.export.categories.proposals.recipients',
    sourceKey: 'privacy.export.categories.proposals.source',
    title: {
      en: 'Proposals & Quotes',
      de: 'Angebote & Kostenvoranschläge',
    },
    purpose: {
      en: 'Preparation, submission, negotiation, and formal acceptance of service proposals and fee quotes.',
      de: 'Erstellung, Übermittlung, Verhandlung und formelle Annahme von Angeboten und Kostenvoranschlägen.',
    },
    lawfulBasis: {
      en: 'Art. 6(1)(b) GDPR (Performance of a contract / pre-contractual measures) and § 147 AO / § 257 HGB (Statutory accounting & tax obligations for accepted proposals).',
      de: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung / vorvertragliche Maßnahmen) und § 147 AO / § 257 HGB (Steuer- und handelsrechtliche Aufbewahrungspflichten für angenommene Angebote).',
    },
    retention: {
      en: 'Unaccepted/declined proposals are pruned after 12 months; accepted proposals are retained for 10 years pursuant to § 147 AO and § 257 HGB.',
      de: 'Nicht angenommene/abgelehnte Angebote werden nach 12 Monaten gelöscht; angenommene Angebote werden 10 Jahre gemäß § 147 AO und § 257 HGB aufbewahrt.',
    },
    recipients: {
      en: 'None (stored locally on the self-hosted studio instance).',
      de: 'Keine (ausschließlich lokale Speicherung auf der selbst gehosteten Studio-Instanz).',
    },
    source: {
      en: 'Provided by the studio owner and client during proposal negotiation and acceptance.',
      de: 'Vom Studioinhaber und Kunden im Rahmen der Angebotsverhandlung und -annahme bereitgestellt.',
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

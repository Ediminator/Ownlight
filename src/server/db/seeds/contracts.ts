import { eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { contractTemplates } from '@/server/db/schema/contracts';

export const SEED_TEMPLATE_WEDDING_ID = '01920000-0000-7000-8000-000000000301';
export const SEED_TEMPLATE_PORTRAIT_ID = '01920000-0000-7000-8000-000000000302';
export const SEED_TEMPLATE_COMMERCIAL_ID = '01920000-0000-7000-8000-000000000303';

export interface SeedContractTemplatesResult {
  seededTemplates: number;
}

export const SEED_CONTRACT_TEMPLATES = [
  {
    id: SEED_TEMPLATE_WEDDING_ID,
    name: 'Wedding Photography Agreement',
    slug: 'wedding-photography-agreement',
    description: 'Standard contract for full-day and half-day wedding photography commissions.',
    projectTypeKey: 'wedding',
    isDefault: true,
    isActive: true,
    contentEn: `# Wedding Photography Agreement

This Agreement is entered into between **{{studio.name}}** ("Photographer") and **{{client.name}}** ("Client").

## 1. Scope of Work
Photographer agrees to provide professional wedding photography services for Client's event:
- **Project**: {{project.title}}
- **Shoot Date**: {{shoot.date}}
- **Time**: {{shoot.time}}
- **Location**: {{shoot.location}}, {{shoot.address}}
- **Package**: {{package.name}}
- **Deliverables**: {{package.deliverables}}
- **Selected Add-ons**: {{package.addons}}

## 2. Fees & Payment Terms
- **Total Amount**: {{package.total}}
- **Subtotal**: {{package.subtotal}}
- **Tax**: {{package.tax}}
- Studio VAT ID: {{studio.vat_id}}
- Studio Tax Number: {{studio.tax_number}}

## 3. Copyright & Image Usage
Photographer retains all copyright in all images created during the event. Client is granted a private, non-exclusive license for personal use and reproduction.

## 4. Contract Details
- **Contract Number**: {{contract.number}}
- **Issue Date**: {{contract.issue_date}}
- **Valid Until**: {{contract.valid_until}}`,
    contentDe: `# Vertrag über Hochzeitsfotografie

Dieser Vertrag wird geschlossen zwischen **{{studio.name}}** („Fotograf“) und **{{client.name}}** („Auftraggeber“).

## 1. Leistungsumfang
Der Fotograf erbringt fotografische Dienstleistungen für die folgende Veranstaltung:
- **Projekt**: {{project.title}}
- **Termin**: {{shoot.date}}
- **Uhrzeit**: {{shoot.time}}
- **Ort**: {{shoot.location}}, {{shoot.address}}
- **Paket**: {{package.name}}
- **Leistungsumfang**: {{package.deliverables}}
- **Zusatzoptionen**: {{package.addons}}

## 2. Honorar und Zahlungsbedingungen
- **Gesamtbetrag**: {{package.total}}
- **Nettobetrag**: {{package.subtotal}}
- **Umsatzsteuer**: {{package.tax}}
- USt-IdNr.: {{studio.vat_id}}
- Steuernummer: {{studio.tax_number}}

## 3. Urheberrecht und Nutzungsrechte
Dem Fotografen steht das Urheberrecht an allen Lichtbildern zu. Dem Auftraggeber wird ein einfaches, nicht übertragbares Nutzungsrecht für private Zwecke eingeräumt.

## 4. Vertragsdaten
- **Vertragsnummer**: {{contract.number}}
- **Ausstellungsdatum**: {{contract.issue_date}}
- **Gültig bis**: {{contract.valid_until}}`,
  },
  {
    id: SEED_TEMPLATE_PORTRAIT_ID,
    name: 'Portrait Session Terms',
    slug: 'portrait-session-terms',
    description:
      'Standard terms and conditions for individual, family, and editorial portrait sessions.',
    projectTypeKey: 'portrait',
    isDefault: true,
    isActive: true,
    contentEn: `# Portrait Photography Agreement

This Agreement is made between **{{studio.name}}** ("Photographer") and **{{client.name}}** ("Client").

## 1. Session Details
- **Project**: {{project.title}}
- **Session Date**: {{shoot.date}} at {{shoot.time}}
- **Location**: {{shoot.location}}, {{shoot.address}}
- **Package**: {{package.name}}
- **Deliverables**: {{package.deliverables}}

## 2. Payment
- Total Fee: **{{package.total}}** (Subtotal: {{package.subtotal}}, Tax: {{package.tax}}).
- Payment is due upon receipt of invoice or prior to delivery of digital files.

## 3. License
Client receives high-resolution edited images for personal, non-commercial use.

## 4. Execution
Contract Reference: **{{contract.number}}**
Date: **{{contract.issue_date}}**
Expires: **{{contract.valid_until}}**`,
    contentDe: `# Vertrag über Portraitfotografie

Dieser Vertrag wird geschlossen zwischen **{{studio.name}}** („Fotograf“) und **{{client.name}}** („Auftraggeber“).

## 1. Details des Fotoshootings
- **Projekt**: {{project.title}}
- **Aufnahmetermin**: {{shoot.date}} um {{shoot.time}}
- **Aufnahmeort**: {{shoot.location}}, {{shoot.address}}
- **Paket**: {{package.name}}
- **Leistungsumfang**: {{package.deliverables}}

## 2. Vergütung
- Gesamthonorar: **{{package.total}}** (Netto: {{package.subtotal}}, USt: {{package.tax}}).
- Fälligkeit gemäß Rechnungsstellung bzw. vor Freigabe der hochauflösenden Bilddateien.

## 3. Nutzungsrechte
Der Auftraggeber erhält hochauflösende bearbeitete Bilddateien zur privaten, nicht-kommerziellen Nutzung.

## 4. Vertragsabschluss
Vertragsnummer: **{{contract.number}}**
Datum: **{{contract.issue_date}}**
Gültig bis: **{{contract.valid_until}}**`,
  },
  {
    id: SEED_TEMPLATE_COMMERCIAL_ID,
    name: 'Commercial Licensing Agreement',
    slug: 'commercial-licensing-agreement',
    description:
      'Commercial photography licensing, usage rights, and commercial commission agreement.',
    projectTypeKey: 'commercial',
    isDefault: true,
    isActive: true,
    contentEn: `# Commercial Photography & Licensing Agreement

This Commercial Photography Agreement is entered into by **{{studio.name}}** ("Licensor") and **{{client.company}}** ("Licensee", Contact: {{client.name}}).

## 1. Assignment Scope
- **Project**: {{project.title}}
- **Production Date**: {{shoot.date}}
- **Location**: {{shoot.location}}, {{shoot.address}}
- **Deliverables**: {{package.deliverables}}

## 2. Compensation & Commercial Terms
- Total Contract Value: **{{package.total}}** + applicable taxes.
- Studio Tax ID: {{studio.tax_number}} / VAT: {{studio.vat_id}}

## 3. Grant of Rights & License
Licensor grants Licensee a commercial, non-transferable license for specified media channels and territories.

## 4. Verification
Contract: **{{contract.number}}** | Issued: **{{contract.issue_date}}** | Valid: **{{contract.valid_until}}**`,
    contentDe: `# Vertrag über kommerzielle Auftragsfotografie und Lizenzierung

Dieser Vertrag wird geschlossen zwischen **{{studio.name}}** („Lizenzgeber“) und **{{client.company}}** („Lizenznehmer“, Ansprechpartner: {{client.name}}).

## 1. Auftragsgegenstand
- **Projekt**: {{project.title}}
- **Produktionstag**: {{shoot.date}}
- **Drehort / Location**: {{shoot.location}}, {{shoot.address}}
- **Lieferumfang**: {{package.deliverables}}

## 2. Vergütung
- Gesamtauftragswert: **{{package.total}}** zzgl. gesetzlicher USt.
- Steuernummer: {{studio.tax_number}} / USt-IdNr.: {{studio.vat_id}}

## 3. Rechteeinräumung
Der Lizenzgeber räumt dem Lizenznehmer die vereinbarten gewerblichen Nutzungsrechte für die definierten Medien und Gebiete ein.

## 4. Vertragsdaten
Vertragsnummer: **{{contract.number}}** | Ausgestellt: **{{contract.issue_date}}** | Gültig bis: **{{contract.valid_until}}**`,
  },
] as const;

/**
 * Seeds default contract templates into database idempotently (TASK-0064).
 */
export async function seedContracts(db: DbClient): Promise<SeedContractTemplatesResult> {
  let seededCount = 0;

  for (const tpl of SEED_CONTRACT_TEMPLATES) {
    const existing = await db
      .select({ id: contractTemplates.id })
      .from(contractTemplates)
      .where(eq(contractTemplates.slug, tpl.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(contractTemplates).values({
        id: tpl.id,
        name: tpl.name,
        slug: tpl.slug,
        description: tpl.description,
        projectTypeKey: tpl.projectTypeKey,
        contentEn: tpl.contentEn,
        contentDe: tpl.contentDe,
        isDefault: tpl.isDefault,
        isActive: tpl.isActive,
      });
      seededCount++;
    }
  }

  return { seededTemplates: seededCount };
}

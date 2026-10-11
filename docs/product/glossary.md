# Glossary (en ↔ de)

Use these terms consistently in code, UI strings and docs. The UX reviewer checks this.

| Concept              | English UI            | German UI                      | Code identifier      | Definition                                                                 |
| -------------------- | --------------------- | ------------------------------ | -------------------- | -------------------------------------------------------------------------- |
| Studio               | Studio                | Studio                         | `studio`             | The business operating this instance                                       |
| Owner                | Owner                 | Inhaber:in                     | `owner`              | The studio's administrator account                                         |
| Lead                 | Lead / Inquiry        | Anfrage                        | `lead`               | An unqualified enquiry, not yet a client                                   |
| Client               | Client                | Kund:in                        | `client`             | A person or company the studio works with                                  |
| Contact              | Contact               | Kontakt                        | `contact`            | A person belonging to a client (for example both partners of a couple)     |
| Project              | Project               | Projekt                        | `project`            | A job for a client (for example a wedding), moving through pipeline stages |
| Shoot / Session      | Shoot                 | Shooting                       | `shoot`              | A scheduled photo or video session within a project                        |
| Pipeline stage       | Stage                 | Phase                          | `stage`              | Position of a project in the workflow                                      |
| Package              | Package               | Paket                          | `package`            | A predefined offering with a price                                         |
| Proposal / Quote     | Proposal              | Angebot                        | `proposal`           | Offer sent to a client, built from packages                                |
| Contract             | Contract              | Vertrag                        | `contract`           | Document signed electronically by client and studio                        |
| Questionnaire        | Questionnaire         | Fragebogen                     | `questionnaire`      | Form the client fills in (timeline, shot list…)                            |
| Automation           | Automation            | Automatisierung                | `automation`         | Trigger leading to actions                                                 |
| Client portal        | Client portal         | Kundenportal                   | `portal`             | The client-facing area for a project                                       |
| Gallery              | Gallery               | Galerie                        | `gallery`            | Set of delivered images or videos                                          |
| Favourite / Proofing | Favourite / Selection | Favorit / Auswahl              | `selection`          | Client's picks within a gallery                                            |
| Consent              | Consent               | Einwilligung                   | `consent`            | Recorded permission (marketing, image usage)                               |
| Retention            | Retention             | Aufbewahrung                   | `retention`          | How long data is kept before deletion or anonymisation                     |
| Data export (DSAR)   | Data export           | Datenauskunft / Datenexport    | `dataExport`         | Export of all data about a person                                          |
| CLI                  | CLI / Terminal client | Befehlszeile / Terminal-Client | `cli`                | Headless command-line tool (`pcrm`)                                        |
| MCP Server           | MCP Server            | MCP-Server                     | `mcp`                | Model Context Protocol service for AI agents                               |
| Accounting connector | Accounting connector  | Buchhaltungs-Schnittstelle     | `accountingProvider` | Provider interface for external accounting platforms                       |
| Invoice              | Invoice               | Rechnung                       | `invoice`            | Legally sealed accounting voucher created via connector                    |
| Down payment         | Down payment          | Anzahlung                      | `downPayment`        | Upfront deposit invoice (_Anzahlungsrechnung_)                             |
| Address              | Address               | Adresse                        | `address`            | Physical postal or billing location of a client                            |
| Preferred language   | Preferred language    | Bevorzugte Sprache             | `preferredLocale`    | Language used for communication and generated documents                    |
| Possible duplicate   | Possible duplicate    | Mögliches Duplikat             | `duplicateEmail`     | Warning when a contact email is already registered to another client       |
| Primary contact      | Primary contact       | Hauptkontakt                   | `primaryContact`     | The designated main person representing a client for communication         |
| Tag                  | Tag                   | Schlagwort                     | `tag`                | Studio-defined label for categorizing and filtering clients                |
| Timeline             | Timeline              | Verlauf                        | `timeline`           | Unified chronological event log of interactions, changes and notes         |
| Note                 | Note                  | Notiz                          | `note`               | Free-text annotation attached to a client profile                          |
| Marketing consent    | Marketing consent     | Werbeeinwilligung              | `marketingConsent`   | Explicit permission to send direct marketing communications (Art. 7 GDPR)  |
| Image usage consent  | Image usage consent   | Einwilligung zur Bildnutzung   | `imageUsageConsent`  | Specific permission to publish or exhibit portrait images (KUG §22)        |
| Withdrawal           | Withdrawal            | Widerruf                       | `withdrawal`         | Revocation of previously granted consent, terminating lawful basis         |

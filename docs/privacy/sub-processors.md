# Sub-Processors and External Data Recipients

This document records the external sub-processors and third-party data recipients engaged by Ownlight, as required by GDPR Art. 28 and Art. 13/14 transparency obligations.

As a self-hosted single-studio CRM (ADR-0003), Ownlight does not route client personal data through central Ownlight project infrastructure. Any external services are operated directly under the studio's own provider accounts.

## 1. Third-Party Service Registry

| Sub-Processor                                                          | Location | Purpose                                                                                                   | Personal Data Transferred                      | Lawful Basis                     | Transfer Safeguard                                                       | Status                        |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| **Google LLC**<br>1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA | USA      | Google Workspace integration: caller ID identification on mobile shoot days (Epic E1; ADR-0008, ADR-0014) | Given name, family name, phone number(s) only. | Art. 6(1)(f) legitimate interest | EU-US Data Privacy Framework (DPF) + Standard Contractual Clauses (SCCs) | **Opt-in only** (default OFF) |

## 2. Google Workspace Integration Details (ADR-0014)

### Data Minimization (Art. 5(1)(c) GDPR)

When the studio connects Google Workspace and syncs a client contact:

- **Transferred:** Given name, family name, and primary/mobile phone number(s).
- **Excluded:** Email addresses, postal addresses, private shoot notes, questionnaires, contracts, proposals, and invoices are strictly excluded.

### Data Protection Agreements (Art. 28 GDPR)

Studio operators must accept the Google Cloud / Google Workspace Data Processing Amendment (DPA) within their Google Admin Console.

### Data Subject Rights Integration

- **Right of Access / DSAR Export (Art. 15 GDPR):** When contact synchronization is enabled for a client, DSAR exports record Google LLC as a third-party recipient.
- **Right to Erasure (Art. 17 GDPR):** Erasing a client or contact automatically triggers deletion from the linked Google account via the Google People API.
- **Disconnection & Revocation:** Disconnecting Google Workspace revokes OAuth credentials and gives the studio operator the choice to delete all synced contacts from Google Contacts immediately.

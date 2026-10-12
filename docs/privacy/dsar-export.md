# Data Subject Access Request (DSAR) Export

## 1. Overview & Regulatory Purpose

Under the General Data Protection Regulation (GDPR / DSGVO Art. 15 _Right of access_, Art. 20 _Right to data portability_) and California Consumer Privacy Act (CCPA/CPRA _Right to know_), individuals have the legal right to obtain confirmation as to whether their personal data is being processed, and to receive a copy of that data in a transparent, intelligible, and machine-readable format.

In Ownlight, the photography studio operates as the independent **Data Controller** (GDPR Art. 4(7)). The software provides built-in mechanisms for the studio owner to generate per-person data exports on demand.

The export focus is an individual **contact** (a natural person client contact) or an individual **lead** (a natural person who submitted an unqualified inquiry, TASK-0026 / ADR-0015 §10). When a client entity has multiple contacts (e.g., both partners in a couple or commercial representatives), each contact's personal data is isolated to safeguard third-party rights. Inquirers who have not yet converted to clients may exercise access rights under their `lead` subject identity.

---

## 2. Operating Procedure: Answering a Subject Request

When a contact submits a data access request (DSAR), the studio owner follows these steps:

1. **Verify Identity:** Verify the identity of the requester to confirm they are the actual data subject or an authorised legal representative.
2. **Generate Export via Studio UI:**
   - Navigate to **Clients** and select the client profile containing the contact.
   - In the **Contacts** section, locate the data subject's card and click **Export personal data** (`Datenauskunft`).
   - If the studio owner has not authenticated within the last 5 minutes, enter the account password to satisfy the **step-up re-authentication** security requirement.
   - Select the desired format:
     - **Machine-readable data (JSON):** Recommended for technical data portability requests (Art. 20).
     - **Printable document (HTML):** Recommended for direct human reading and PDF printing via the browser (Art. 15).
   - Select the document language (English or German, defaulting to the client's preferred language).
   - Confirm by clicking **Generate and download**.
3. **Mandatory Art. 15(4) Review for Third-Party Data:**
   > [!IMPORTANT]
   > Under GDPR Art. 15(4), the right to obtain a copy must not adversely affect the rights and freedoms of others. Before delivering the file to the data subject, the studio owner must inspect the export for mentions of third parties (e.g. partner details, guest notes, vendor communications) and redact or sanitize them as appropriate.
4. **Deliver via Secure Channel:** Deliver the finalized document to the subject using a secure, confidential communication channel (e.g. encrypted email, password-protected download, or physical handover).
5. **Data Retention & Disposal:**
   - **Zero Server-Side Storage:** Ownlight streams the export directly to the browser with `Cache-Control: no-store` and never persists the export file in the database, file system, or object storage.
   - **Downloaded Files:** The studio owner is responsible for securely deleting local copies once transmission to the data subject is complete.
   - **Audit Record:** An audit log event (`privacy.export.generated`) is recorded server-side for compliance proof (retained for 24 months, containing no personal data).

---

## 3. Data Formats

### 3.1. Machine-Readable JSON (`ownlight.dsar.v1`)

The JSON export adheres to the `ownlight.dsar.v1` schema and contains:

- Header metadata (`schema`, `generated_at`, `studio.name`).
- Data subject profile (`subject` contact details, excluding internal lookup columns such as `email_normalized`).
- Domain-categorized records (`categories`).

```json
{
  "schema": "ownlight.dsar.v1",
  "generated_at": "2026-10-11T12:00:00.000Z",
  "studio": {
    "name": "Lumière Photo Studio"
  },
  "subject": {
    "id": "c0000000-0000-4000-8000-000000000001",
    "client_id": "b0000000-0000-4000-8000-000000000001",
    "is_primary": true,
    "given_name": "Jane",
    "familyName": "Doe",
    "email": "jane@example.com",
    "phone": "+49 151 12345678",
    "created_at": "2026-01-15T09:30:00.000Z",
    "updated_at": "2026-03-20T14:15:00.000Z"
  },
  "categories": {
    "client": [
      {
        "id": "b0000000-0000-4000-8000-000000000001",
        "display_name": "Jane & John Wedding",
        "kind": "person",
        "preferred_language": "en",
        "created_at": "2026-01-15T09:30:00.000Z",
        "last_activity_at": "2026-03-20T14:15:00.000Z"
      }
    ],
    "addresses": [
      {
        "id": "a0000000-0000-4000-8000-000000000001",
        "type": "postal",
        "line1": "Musterstraße 42",
        "line2": "Apt 3",
        "postal_code": "10115",
        "city": "Berlin",
        "region": "Berlin",
        "country": "DE",
        "created_at": "2026-01-15T09:30:00.000Z"
      }
    ],
    "tags": ["wedding", "portrait"],
    "notes": [
      {
        "id": "n0000000-0000-4000-8000-000000000001",
        "body": "Client requested golden hour outdoor portrait session.",
        "created_at": "2026-02-01T10:00:00.000Z"
      }
    ],
    "timeline": [
      {
        "id": "e0000000-0000-4000-8000-000000000001",
        "occurred_at": "2026-01-15T09:30:00.000Z",
        "type": "client.created",
        "actor_type": "user",
        "content": "Client created"
      }
    ],
    "consents": [
      {
        "id": "c0000000-0000-4000-8000-000000000002",
        "purpose": "marketing",
        "status": "granted",
        "method": "form",
        "scope": null,
        "effective_on": "2026-01-15T09:30:00.000Z"
      }
    ],
    "audit": [
      {
        "action": "client.updated",
        "occurred_at": "2026-03-20T14:15:00.000Z",
        "outcome": "success"
      }
    ]
  }
}
```

### 3.2. Printable Human-Readable HTML

The HTML export is designed to be directly printed or saved as a PDF via the browser. Key characteristics:

- **Fully Self-Contained:** Uses embedded inline CSS. Contains **no external resources** (no fonts, CDNs, scripts, or tracker pixels).
- **Strictly Sanitized:** All data values are escaped for HTML entities. Zero `<script>` tags, inline event handlers (`onclick`, `onerror`), or external URL references.
- **GDPR Art. 15(1) Disclosures:** Each data category includes:
  - Purpose of processing.
  - Lawful basis (e.g. Art. 6(1)(b) Contract, Art. 6(1)(a) Consent, Art. 6(1)(f) Legitimate Interests).
  - Storage retention period (e.g. 24 months, statutory 10 years for invoices, or until withdrawal of consent).
- **Subject Rights & Supervisory Authority:** Includes a dedicated section informing the data subject of their statutory rights under GDPR Art. 16–21 (rectification, erasure, restriction, objection, portability) and their right to lodge a complaint with a supervisory authority under Art. 77.
- **Accessibility:** Semantic HTML structure with header landmarks, descriptive tables with `<th scope="col">` headers, and WCAG 2.2 AA compliant contrast.

### 3.3. Lead Subject Export & Art. 15 Disclosures (TASK-0026)

When exporting an inquiry lead (`POST /api/privacy/exports` with `{ leadId, format, locale }`):

- **Subject Identity:** `subject.role` is `'lead'`, identified by `leadId`.
- **`leads` Category:** Contains the submitted inquiry fields (given name, family name, email, phone, message, event type, date, location), form name, exact notice version text and URL acknowledged, verification status, delivery mode, auto-reply status, and chronological audit actions targeting the lead.
- **`converted_leads` Category:** Included in client/contact exports when the client originated from a converted inquiry, documenting received date, form name, event type label, date, and location.
- **Statutory Art. 15 Disclosures for Leads:**
  - **Purpose:** Answering the inquiry and pre-contractual communication.
  - **Lawful Basis:** Art. 6(1)(b) GDPR (Pre-contractual measures upon request) / Art. 6(1)(f) for company contact persons.
  - **Retention:** 12 months following last owner activity (configurable 1–36 months via `LEAD_RETENTION_MONTHS`); 30 days for spam inquiries.
  - **Recipients:** The studio's email provider, for the confirmation email.
  - **Source:** Inquiry form submitted by the data subject.

---

## 4. Architecture & Domain Provider Registry

The export subsystem uses an extensible provider registry located at `src/server/privacy/export/`:

```text
src/server/privacy/export/
├── types.ts          # Core provider and export data types
├── categories.ts     # Category metadata and GDPR Art. 15 disclosures
├── allowlist.ts      # Table schema coverage allowlist for justified non-exportable tables
├── registry.ts       # Provider registry and data collector
├── schema.ts         # Zod schemas for request and JSON export
├── json.ts           # JSON format generator
├── html.ts           # Accessible HTML generator with HTML escaping
├── service.ts        # Export orchestrator and audit logger
└── index.ts          # Public interface
```

### 4.1. How Domains Register Providers

Each functional domain registers an export provider with `registerExportProvider`:

```typescript
import { registerExportProvider } from '@/server/privacy/export';

registerExportProvider({
  id: 'billing.invoices',
  category: 'invoices',
  collect: async (subject, tx) => {
    const invoices = await tx
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        total: invoicesTable.totalAmount,
        issuedAt: invoicesTable.issuedAt,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.clientId, subject.clientId));

    return invoices;
  },
});
```

The `category` string must match an entry in `EXPORT_CATEGORIES` (`src/server/privacy/export/categories.ts`), providing translated names, purposes, lawful bases, and retention disclosures in both English and German.

### 4.2. Schema Coverage Guard (AC-5)

To prevent personal data from silently escaping DSAR exports as the database schema evolves, an automated coverage test (`tests/unit/dsar-export-coverage.test.ts`) inspects the Drizzle schema:

- Any table with a `client_id` or `contact_id` column must have either:
  1. An active export provider registered in `registry.ts`, OR
  2. An explicit entry in `EXPORT_COVERAGE_ALLOWLIST` (`src/server/privacy/export/allowlist.ts`) with a documented legal justification.
- The test deliberately injects a fixture table with `client_id` to verify that unmapped tables break the test and prevent merging.

---

## 5. Security & Access Controls

| Control              | Implementation                                                                                                      | Rationale                                                                        |
| :------------------- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------- |
| **Authentication**   | Owner web session only (`assertOwnerSession`)                                                                       | Client contacts and external entities must not access internal export APIs.      |
| **API Key Denial**   | Explicitly rejected with HTTP 403 (even for `*` scope)                                                              | ADR-0006 mandates API keys cannot generate bulk personal data exports.           |
| **Step-Up Re-auth**  | Password confirmation within past 5 minutes (`assertFreshReauthentication`)                                         | Mitigates session hijacking and unattended workstation attacks.                  |
| **CSRF Defense**     | Strict `Origin` header matching against app origin                                                                  | Blocks cross-site request forgery attacks.                                       |
| **Response Headers** | `Cache-Control: no-store`<br>`X-Content-Type-Options: nosniff`<br>`Content-Disposition: attachment; filename="..."` | Prevents browser caching of personal data and mime-sniffing.                     |
| **Log Minimisation** | Only log format, contact ID, duration, and status                                                                   | Personal data (names, emails, notes) is strictly prohibited in application logs. |

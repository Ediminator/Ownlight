# Privacy by Design & Default (GDPR & CCPA)

This architecture document guides the implementation of data protection principles (GDPR/DSGVO Art. 25, CCPA/CPRA) across all features of the Ownlight.

---

## 1. Core Principles

1. **Self-Hosted Ownership:** The studio operating the CRM is the independent **Data Controller** (GDPR Art. 4(7)). The software is a self-hosted tool that provides automated compliance mechanisms out of the box.
2. **Data Minimisation (Art. 5(1)(c)):** Only collect data strictly necessary for booking, executing, and delivering photographic services.
3. **Purpose Limitation (Art. 5(1)(b)):** Personal data collected for shoot operations is separated from marketing communications.
4. **Storage Limitation (Art. 5(1)(e)):** Automated retention policies prune unconverted leads, expired sessions, and completed project files according to configurable studio schedules.
5. **Transparency & Consent (Art. 7, KUG §22):** Marketing and image usage permissions (portfolio, social media) require unambiguous, opt-in consent records with full history.

---

## 2. Data Subject Rights Automation

The system provides built-in mechanisms to handle data subject access requests (DSARs):

### Right to Access & Data Portability (Art. 15, Art. 20)

- **On-Demand Per-Contact Export:** The studio owner can generate on-demand data subject access exports via `POST /api/privacy/exports` or directly from the client profile contact card.
- **Formats Generated:**
  - **Machine-readable JSON:** Validated against `ownlight.dsar.v1`, structured by domain categories.
  - **Self-contained HTML:** Zero-script, zero-external-resource printable document with inline CSS, output encoding, and full GDPR Art. 15(1) disclosures (purposes, legal bases, retention periods, recipients, data source, and Art. 16–21 rights).
- **Extensible Domain Registry:** Data is assembled using an export provider registry (`src/server/privacy/export/registry.ts`). Built-in providers cover contact identity (excluding normalized internal lookup indexes), client relationship, addresses, tags, notes, timeline events, consent history, and relevant audit logs.
- **Privacy & Security Safeguards:**
  - **Third-Party Isolation:** Strictly exports only the selected data subject; other contacts of the client (such as partners) are omitted to protect third-party rights.
  - **Zero Server-Side Storage:** Exports are generated on the fly, streamed directly as downloads (`Cache-Control: no-store`, `Content-Disposition: attachment`), and never saved to disk or object storage.
  - **Owner Web Session & Step-Up Auth:** Restricted strictly to owner web sessions with fresh password re-authentication (≤ 5 minutes). API keys are rejected regardless of scope; same-origin verification is strictly enforced.
  - **Art. 15(4) Review Notice:** Prominently alerts the studio owner prior to download to review notes and timeline events for incidental third-party data and redact where necessary before transmission.
  - **Audit Logging:** Every export records a `privacy.export.generated` audit event with strict metadata allowlisting and zero personal data in server logs.
- **Reference:** See [`docs/privacy/dsar-export.md`](./dsar-export.md) for full technical documentation and developer guides.

### Right to Rectification (Art. 16)

- Clients can review and update their contact details directly via the authenticated client portal.

### Right to Erasure / "To Be Forgotten" (Art. 17)

- **Automated Anonymisation or Hard Deletion:** When an erasure request is executed, all non-legally-retained personal data is purged or pseudonymised.
- **Conflict with Legal Retention:** If financial vouchers or signed contracts are subject to statutory retention (e.g. German GoBD / §147 AO), those specific records are locked under a `legalHold`, isolated from regular operational search, and flagged for deletion once the retention period lapses.

---

## 3. Privacy Default Settings

- **Zero Third-Party Dependencies:** No Google Fonts, un-consented Google Analytics, CDN scripts, or external telemetry are embedded in the application.
- **No Cookie Consent Banner Needed:** By using only strictly necessary session cookies (§25(2) Nr. 2 TDDDG), the default installation requires no intrusive cookie banners.
- **Metadata Protection:** Deliverable web-optimised image derivatives have EXIF GPS location data stripped by default to protect clients' home and private event locations.
- **Children's Privacy:** Family shoots and events involving minors require parental consent documentation before public gallery delivery.

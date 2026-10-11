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

### Right to Erasure / "To Be Forgotten" (Art. 17, CCPA/CPRA Right to Delete)

- **Hard Deletion by Default:** Deleting a client or erasing a person performs an atomic, all-or-nothing hard delete of personal data in a single database transaction. No soft-delete flags or shadow copies are retained in the application database.
- **Retention-Lock (Legal Hold) Awareness:** Before any records are purged, the system queries registered hold providers (`src/server/privacy/erasure/registry.ts`). If any statutory (e.g. §147 AO, §257 HGB) or legal hold exists, erasure is blocked entirely (`ERASURE_BLOCKED`), zero data is deleted, a non-PII `privacy.erasure.blocked` audit event is emitted, and the UI presents the active holds with their justification and expiry date without offering a deletion confirmation button.
- **TOCTOU Defense:** Holds are re-evaluated within the transactional boundary immediately before deletion queries execute, ensuring concurrency safety against late-arriving holds.
- **Extensible Domain Registries:** Domains register data erasure providers (`registerErasureProvider`) and hold providers (`registerErasureHoldProvider`). A strict schema coverage test ensures every table containing personal data is covered.
- **Single-Contact Promotion & Scoped Erasure:** Erasing a single contact deletes that contact's profile, its consent records, and matching timeline events. Erasing the last remaining contact of a client is automatically promoted to client-level erasure. When erasing one person of a multi-contact client, the UI warns the owner that client-level notes may reference that person and require manual inspection.
- **Consent Records Deletion & Pseudonymous Audit Retention:** Under maintainer decision (ADR-0012 §4.1), consent records are deleted with the subject; pseudonymous audit logs (`consent.granted`, `consent.withdrawn`) remain for 24 months with no PII.
- **Security & Authorization Controls:**
  - **Owner Web Session Only:** API keys and external agent tokens are denied (`FORBIDDEN`).
  - **Step-Up Re-Authentication:** Re-authentication with the master account password is required within 5 minutes (`assertFreshReauthentication`).
  - **Explicit Typed Confirmation:** The owner must type the client's current display name to confirm deletion.
  - **Accountability Logging:** Erasure completions emit `privacy.erasure.completed` recording subject UUID, kind, and per-category counts without personal data.
- **Reference:** See [`docs/privacy/erasure.md`](./erasure.md) for complete technical architecture and domain registration guides.

---

## 3. Privacy Default Settings

- **Zero Third-Party Dependencies:** No Google Fonts, un-consented Google Analytics, CDN scripts, or external telemetry are embedded in the application.
- **No Cookie Consent Banner Needed:** By using only strictly necessary session cookies (§25(2) Nr. 2 TDDDG), the default installation requires no intrusive cookie banners.
- **Metadata Protection:** Deliverable web-optimised image derivatives have EXIF GPS location data stripped by default to protect clients' home and private event locations.
- **Children's Privacy:** Family shoots and events involving minors require parental consent documentation before public gallery delivery.

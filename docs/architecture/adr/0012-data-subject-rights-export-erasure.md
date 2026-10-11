# ADR-0012: Data-subject rights — per-person export and erasure through domain provider registries

- Status: Proposed
- Date: 2026-10-10
- Deciders: Architect, Maintainer (open points decided 2026-10-10, §4); ADR approved in the TASK-0015 PR that commits it

## Context

E1 requires "per-person data export (JSON plus human-readable output), erasure with retention-lock awareness, and consent records". Personal data about one person will be spread over many tables as epics land (clients, contacts, notes, timeline, consents; later leads, projects, questionnaires, contracts, galleries, emails, accounting references). Export and erasure must stay complete as the schema grows, and must respect statutory retention (GDPR Art. 17(3)(b)/(e); §147 AO, §257 HGB, §195 BGB) without the E1 code knowing about future tables.

The data subject is a **natural person**. In Ownlight that is a `client_contacts` row (a person client has one contact; a couple or company client can have several). Existing documents disagree on the erasure mechanism: `docs/architecture/data-model.md` §4 says "hard delete by default", while ADR-0007 (Proposed) mentions "anonymized or soft-deleted".

## Decision

### 1. Provider registries

- `registerExportProvider({ id, category, collect(subject, tx) })` — returns the personal data a domain holds about the subject, as plain JSON-serialisable data plus an i18n category key.
- `registerErasureProvider({ id, category, plan(subject, tx), erase(subject, tx) })` — `plan` reports what would be deleted (counts per category); `erase` deletes it inside the shared transaction.
- `registerErasureHoldProvider({ id, holds(subject, tx) })` — returns zero or more holds `{ reason, retainUntil }` (reason is a registered i18n key such as `statutory.invoice`); a hold means "this subject's data must not be erased before `retainUntil`".
- Every domain that stores personal data registers providers in the task that introduces the data. A unit test enumerates the Drizzle schema and fails if a table with a `client_id` or `contact_id` column has no export and erasure coverage (allowlist for justified exceptions).

### 2. Export (TASK-0015)

- Subject: one contact. The export contains the contact, the client it belongs to (client-level data such as addresses, tags, notes and timeline), its consent history, and a list of audit actions that targeted the subject (action, time, outcome only). Other contacts of the same client are not exported.
- Two formats, generated on demand and streamed to the owner, **never stored** on the server:
  - JSON: `{ "schema": "ownlight.dsar.v1", "generated_at", "subject", "categories": { … } }`, documented in `docs/privacy/dsar-export.md`.
  - Human-readable: a self-contained HTML document (inline CSS, no scripts, no external resources) in English or German, printable to PDF by the browser, including the Art. 15(1) information (purposes, lawful bases, retention, recipients, rights) generated from a typed category registry.
- Access: owner **web session only** (API keys are rejected; ADR-0006 forbids bulk personal-data extraction over the agentic interface) **plus step-up re-authentication within 5 minutes**. Audit event `privacy.export.generated` with subject ID and format.

### 3. Erasure (TASK-0016)

- **Hard delete** is the default mechanism, consistent with data-model §4. No soft delete, no anonymised copy of the client row.
- Erasure runs in one transaction: collect holds → if any hold exists, **nothing is deleted** and the owner sees each hold with its reason and `retainUntil` date; otherwise every erasure provider deletes its data.
- TASK-0016 ships the hold mechanism without a production hold provider; TASK-0019 adds the first one (manual legal hold, §4.3). No statutory held record types (contracts, invoices) exist yet. The first epic that introduces held records (E6 contracts, E12 accounting) must decide, in its own ADR, whether to move from "block" to **partial erasure** (delete everything not covered by the hold and restrict processing of the rest, Art. 18).
- Erasing the last contact of a client erases the whole client graph; erasing one contact of a multi-contact client erases that contact and its person-level data only, and warns the owner that client-level free text (notes) may still mention the person and must be reviewed manually.
- Accountability: audit events `privacy.erasure.completed` / `privacy.erasure.blocked` with subject ID and counts only. Existing audit events keep their pseudonymous UUIDs, which no longer resolve to a person.
- Access: owner web session only plus step-up re-authentication, and an explicit typed confirmation. The only other caller is the retention worker, which invokes the erasure service directly from server code as the `system` actor (§4.2); there is no endpoint for it.

## 4. Maintainer decisions (2026-10-10)

1. **Consent records on erasure:** consent records are **deleted** together with the erased person. Only the pseudonymous `consent.granted` / `consent.withdrawn` audit events remain (24-month audit retention). No proof record is kept under Art. 17(3)(e). (TASK-0016)
2. **Automatic retention of inactive clients:** clients are **erased automatically after 36 months without activity** (configurable, `CLIENT_RETENTION_MONTHS`), through the erasure providers of §1 and respecting all holds. "Activity" is computed by an **activity provider registry**; until E3 exists the providers are client/contact/address updates (`clients.last_activity_at`), non-system timeline events, notes and consent changes. E3 (and later epics) plug in project activity by registering a provider. Viewing a client is not activity. (TASK-0019)
3. **Manual legal hold:** an owner-set legal hold per client (reason category, optional note, optional end date) implemented as a hold provider, shipped together with point 2. (TASK-0019)

## Alternatives considered

- **Central hard-coded export/erasure service** that knows all tables: simple now, but silently incomplete as soon as a later epic adds a table.
- **Anonymise instead of delete:** keeps referential integrity for statistics but risks re-identification from free text and project details; not needed while no held records exist.
- **Soft delete:** keeps personal data after an erasure request; rejected by data-model §4.

## Consequences

- Each epic carries the cost of registering providers; the coverage test makes omissions visible in CI.
- Erasure is all-or-nothing in E1; partial erasure is deferred to the epic that introduces statutory records.

## Security & privacy impact

- Implements GDPR Art. 15, 17, 20 and 30 support; CCPA/CPRA right to know and delete.
- Step-up re-authentication and session-only access reduce the impact of a stolen API key or session (ASVS 5.0 V6/V8).
- Exports are never persisted, so they need no retention policy and cannot leak from storage.

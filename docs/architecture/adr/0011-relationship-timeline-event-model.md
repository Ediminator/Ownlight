# ADR-0011: Relationship history timeline as a dedicated, typed event table

- Status: Proposed
- Date: 2026-10-10
- Deciders: Architect (pending maintainer review in the TASK-0013 PR)

## Context

E1 requires a per-client "relationship history timeline: enquiries, projects, emails sent, documents, portal activity". Most of these sources arrive in later epics (E2 leads, E3 projects, E6 contracts, E8 emails, E9 portal, E12 accounting). E1 must therefore define a **contract that later epics append to**, while rendering what exists today (client lifecycle events, notes, consent changes).

Options:

1. **Derive the timeline from `audit_events`.** The audit log already records actions with `target_id`.
2. **Query-time union of source tables** via a provider registry (each epic contributes a query; results are merged and paginated in memory).
3. **Dedicated `client_timeline_events` table** that domains append to through a typed service, with a registry of event types.

## Decision

Option 3: a dedicated table `client_timeline_events` plus a typed `recordTimelineEvent()` service and an event-type registry.

1. **Schema:** `id` (UUIDv7), `client_id` (FK → `clients.id`, `ON DELETE CASCADE`), `type` (registered string such as `client.created`, `note.created`, `consent.granted`), `occurred_at` (timestamptz, UTC), `actor_type` (`owner|client|system|agent|token`, same enum as audit), `actor_id` (nullable, pseudonymous), `subject_type` and `subject_id` (nullable polymorphic reference, for example `note` / note UUID), `data` (jsonb, keys allowlisted **per event type**), `created_at`. Index on `(client_id, occurred_at DESC, id DESC)`.
2. **No copied personal data in `data`.** Payloads hold references and non-identifying facts (for example `{ "purpose": "marketing" }`, `{ "stage": "booked" }`). Human-readable content (note body, contact name, email subject) is **resolved at read time** from the subject entity; if the subject no longer exists the event renders as "item deleted" without content.
3. **Registry:** each event type registers its allowlisted `data` keys, its i18n message key (`clients.timeline.events.<type>`) and an optional resolver. Unknown types or keys are rejected in dev/test and dropped with a warning in production (same pattern as the audit allowlist from TASK-0007).
4. **Write path:** events are written in the **same transaction** as the domain change that causes them.
5. **Read path:** keyset pagination by `(occurred_at DESC, id DESC)`, page size 20, owner-only (and `clients:read` for API keys).
6. **Lifecycle:** events live as long as their client and are deleted with it (cascade) and by the per-person erasure service. Per-type retention (for example high-volume portal views) can be added later through the retention framework.
7. **Contract for later epics:** E2/E3/E6/E8/E9/E12 add event types by registering them; they never write to the table directly.

## Alternatives considered

- **Audit log as source:** mixes purposes (security accountability vs. customer relationship, GDPR Art. 5(1)(b)); audit rows are append-only, PII-free by design and pruned after 24 months, so they can neither show human-readable content nor be erased per person without weakening the audit guarantees.
- **Query-time union:** no duplication, but every epic must implement efficient cursor queries, cross-source pagination is complex and slow, and event-like facts without a source row (email sent, portal viewed) still need storage.

## Consequences

- One indexed table makes the timeline cheap to read and simple to paginate.
- Each new domain event requires a registry entry and a transactional write; reviewers check both.
- Deleting a subject (for example a note) must delete or neutralise its events in the same transaction.

## Security & privacy impact

- Per-type allowlists keep personal data out of `data`; content is resolved from the source entity, so erasing the source erases the content everywhere (GDPR Art. 17).
- Timeline events are included in the per-person data export (Art. 15/20).

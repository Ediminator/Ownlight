# Data Subject Right to Erasure ("Right to Be Forgotten")

## 1. Overview & Regulatory Purpose

Under the General Data Protection Regulation (GDPR / DSGVO Art. 17 _Right to erasure / "right to be forgotten"_) and the California Consumer Privacy Act (CCPA/CPRA _Right to delete_), data subjects have the legal right to request the permanent deletion of their personal data when it is no longer necessary for the original purposes, when consent is withdrawn, or upon objection.

However, data controllers must balance erasure requests against statutory and legal retention obligations (GDPR Art. 17(3)(b) and (e)), including commercial and tax retention requirements (such as German commercial code §257 HGB and fiscal code §147 AO, which mandate up to 8–10 years retention for accounting vouchers and business correspondence), and the establishment, exercise, or defense of legal claims (§195 BGB).

In Ownlight, the photography studio operates as the independent **Data Controller** (GDPR Art. 4(7)). The software implements an automated, retention-lock-aware erasure architecture ([ADR-0012](../architecture/adr/0012-data-subject-rights-export-erasure.md)) that guarantees:

- Hard deletion of all personal data within a single atomic database transaction.
- Comprehensive retention-lock (legal hold) checking that blocks deletion if any active hold exists.
- Complete coverage of all database tables containing personal data, verified by automated tests.
- High-assurance security controls: owner web session only, step-up password re-authentication, and typed display-name confirmation.

---

## 2. Operating Procedure: Studio Owner Erasure Workflow

The studio owner and system services can perform erasure at three scopes:

1. **Client-Level Deletion:** Erases the entire client record and all associated contacts, addresses, tag assignments, notes, timeline events, consent records, and converted leads (`converted-leads`).
2. **Contact-Level Erasure:** Erases an individual person (contact), their consent records, and matching timeline events, leaving the client and any other contacts intact.
3. **Lead-Level Erasure (TASK-0026):** Erases an individual unconverted inquiry lead (`eraseSubject({ kind: 'lead', leadId })` or `deleteLeads`), permanently removing the inquiry record and all personal details. Inquiries do not carry contractual legal holds. Converted leads cannot be deleted directly and must be erased through client-level deletion.

### Step 1: Open the Erasure Interface

- **For full client deletion:** Navigate to **Clients**, open the client profile, scroll to the **Danger zone** section at the bottom, and click **Delete client** (`Kunden löschen`).
- **For single person erasure:** In the **Contacts** section of the client profile, locate the person's card and click the **Erase person** button (`Person löschen`).

### Step 2: Review the Erasure Plan

The system fetches an live erasure plan and displays the itemized counts of records scheduled for hard deletion across all domain categories:

- Client profile
- Contacts
- Addresses
- Tag assignments
- Notes
- Timeline events
- Consent records

### Step 3: Retention-Lock Check (Legal Holds)

Before offering confirmation, the system evaluates all active retention holds:

- **If active holds exist:** The dialog displays an alert listing each blocking hold, the statutory reason (e.g. tax retention), and the mandatory `retainUntil` date. **No confirmation or deletion button is offered.** The owner may only dismiss the dialog (`Close`).
- **If no holds exist:** The deletion process proceeds to verification.

### Step 4: Notes Warning (Multi-Contact Clients)

When erasing an individual contact on a multi-contact client (e.g. a couple or company), the plan displays a prominent warning reminding the studio owner that free-text client notes may contain references to that person, advising manual review of client notes after erasure.

### Step 5: Step-Up Re-Authentication

If the studio owner has not authenticated within the previous 5 minutes (`assertFreshReauthentication`), the dialog displays a password confirmation prompt. The owner must enter their master account password before proceeding.

### Step 6: Explicit Typed Confirmation

To prevent accidental deletions:

- The owner must type the exact display name of the client into the confirmation input field.
- The **Delete client** or **Erase person** submit button remains disabled until the confirmation text matches exactly.

### Step 7: Execution & Status Announcement

Upon clicking the confirmation button:

- The server executes the erasure inside an atomic transaction.
- **Client erasure:** Navigates back to the client directory (`/clients?deleted=1`) and announces a localized success notification to screen readers and a visible banner.
- **Contact erasure:** Refreshes the client profile in place, removes the contact card, and announces a localized confirmation message.

---

## 3. What Is and Is Not Deleted

| Data Category                  | Client Erasure    | Contact Erasure       | Notes & Invariants                                                                                   |
| :----------------------------- | :---------------- | :-------------------- | :--------------------------------------------------------------------------------------------------- |
| **`clients` record**           | **Deleted**       | Kept                  | Deleting the last remaining contact of a client automatically promotes to client deletion.           |
| **`client_contacts` record**   | **Deleted (all)** | **Deleted (target)**  | Target contact row is permanently removed from the database.                                         |
| **`client_addresses` records** | **Deleted (all)** | Kept                  | Client addresses belong to the client entity, not individual contacts.                               |
| **`client_tags` assignments**  | **Deleted (all)** | Kept                  | Association rows linking client to tags are deleted.                                                 |
| **`tags` table definitions**   | **Kept**          | **Kept**              | Studio-wide tag definitions (e.g. "Wedding", "VIP") remain available for other clients.              |
| **`client_notes` records**     | **Deleted (all)** | Kept                  | Client notes remain for multi-contact clients; owner is warned to review them manually.              |
| **`client_timeline_events`**   | **Deleted (all)** | **Deleted (partial)** | In contact erasure, only timeline events targeting the contact or its consents are deleted.          |
| **`consent_records`**          | **Deleted (all)** | **Deleted (target)**  | Consent records are deleted (ADR-0012 §4.1). No proof records kept under Art. 17(3)(e).              |
| **`leads` (converted)**        | **Deleted (all)** | Kept                  | Converted leads linked to the client are deleted via the `converted-leads` erasure provider.         |
| **`leads` (unconverted)**      | N/A               | N/A                   | Unconverted leads are deleted by Lead Erasure (`eraseSubject({ kind: 'lead' })` or `deleteLeads`).   |
| **`audit_events`**             | **Kept**          | **Kept**              | Audit events (`consent.*`, `privacy.erasure.*`) retain pseudonymous UUIDs for 24 months without PII. |
| **Database Backups**           | Rotated           | Rotated               | Erased data disappears naturally from rolling database backups as backup retention expires.          |

---

## 4. Retention-Lock (Legal Hold) Architecture

Under GDPR Art. 17(3)(b) and (e), statutory retention requirements take legal precedence over erasure requests. Ownlight manages retention locks via the **hold provider registry**:

### Double-Check (TOCTOU) Protection

To prevent Time-of-Check to Time-of-Use (TOCTOU) race conditions:

1. **Planning Phase:** When the owner opens the erasure dialog, `planErasure` queries all registered hold providers to inspect whether any holds exist.
2. **Execution Phase:** When `eraseSubject` executes, it starts a dedicated database transaction with strict isolation and **re-evaluates all hold providers inside the transaction**. If any hold is detected, the transaction immediately rolls back, nothing is deleted, and the operation returns `ERASURE_BLOCKED`.

### Manual Client Legal Hold (`client_legal_holds`)

The studio owner can place a manual per-client legal hold (TASK-0019 / ADR-0012 §4.3) on any client:

- **Purpose & Grounds:** Temporarily or indefinitely suspend automatic retention sweeps and manual erasure during an active dispute (`dispute`), statutory compliance obligation (`statutory`), or other legal grounds (`other`) pursuant to GDPR Art. 17(3)(b) & (e).
- **Activeness:** A hold is active if its expiration date `until` is `NULL` (indefinite hold) or `until >= CURRENT_DATE` in the studio's configured time zone.
- **Erasure Interaction:** When an active hold exists, `planErasureAction` lists the hold as blocking erasure with reason (`manual.dispute`, `manual.statutory`, `manual.other`) and formatted expiration date, and `executeErasureAction` rejects deletion with `ERASURE_BLOCKED`.
- **Expired Holds:** If a hold has reached or passed its `until` date, the hold is considered expired and no longer blocks erasure. When the client is erased, the `legal_hold` erasure provider deletes the expired hold row before the client row is deleted, ensuring the foreign key constraint (`ON DELETE RESTRICT`) never blocks a permitted erasure.
- **Releasing Holds:** The owner can release a legal hold at any time from the client profile (protected by a confirmation prompt). Releasing immediately removes the hold row and re-enables automatic retention sweeps and manual erasure.

### Accountability Audit Events

- When an erasure completes: `privacy.erasure.completed` is recorded with `target_id = <subject UUID>`, `metadata = { subject_kind, category_counts }`. Zero PII (names, emails, phones) is recorded in audit metadata or server logs.
- When an erasure is blocked: `privacy.erasure.blocked` is recorded with `target_id = <subject UUID>`, `metadata = { subject_kind, hold_count }`.

### System Worker Invocations

The erasure service module (`src/server/privacy/erasure/service.ts`) is a plain `server-only` module (never exported from `'use server'`). Automated retention sweep tasks (such as the inactivity policy in TASK-0019) invoke `eraseSubject` directly with the system actor:

```ts
await eraseSubject(subject, {
  actor: { actorType: 'system', actorId: 'retention-worker' },
});
```

---

## 5. Developer Guide: Registering Erasure & Hold Providers

Domains that introduce new personal data tables must register providers in `src/server/privacy/erasure/registry.ts`.

### 5.1. Registering an Erasure Provider

An erasure provider defines how a domain calculates deletion counts and removes records:

```ts
import { registerErasureProvider } from '@/server/privacy/erasure/registry';

registerErasureProvider({
  id: 'contracts',
  category: 'contracts',
  plan: async (subject, tx) => {
    // Return count of records that will be deleted for subject
    const count = await getContractCountForSubject(subject, tx);
    return { category: 'contracts', count };
  },
  erase: async (subject, tx) => {
    // Delete domain records inside tx
    await deleteContractsForSubject(subject, tx);
  },
});
```

> [!IMPORTANT]
> **Provider Execution Order:** Providers are executed sequentially inside the transaction. If domain B references domain A (for example, `timeline` queries `consents` to find consent IDs for a contact), domain B's erasure provider must run before domain A deletes its records.

### 5.2. Registering an Erasure Hold Provider

A hold provider determines whether statutory retention or active dispute requirements prevent erasure:

```ts
import { registerErasureHoldProvider } from '@/server/privacy/erasure/registry';

registerErasureHoldProvider({
  id: 'statutory-tax-hold',
  holds: async (subject, tx) => {
    const invoices = await findIssuedInvoicesForSubject(subject, tx);
    if (invoices.length === 0) return [];

    const latestInvoice = findLatestInvoice(invoices);
    const retainUntil = calculateTenYearRetention(latestInvoice.date);

    return [
      {
        providerId: 'statutory-tax-hold',
        reason: 'Statutory 10-year commercial/tax retention (§147 AO, §257 HGB)',
        retainUntil,
      },
    ];
  },
});
```

### 5.3. Schema Coverage Enforcement

The test `tests/unit/erasure-coverage.test.ts` automatically scans the complete Drizzle ORM database schema:

- Every table containing a `client_id` or `contact_id` column must be covered by a registered erasure provider or explicitly documented in `ERASURE_COVERAGE_ALLOWLIST` with legal justification.
- CI and the quality gate fail immediately if a new table is added without corresponding erasure coverage.

# Data Model & Schema Conventions

This document establishes the architectural conventions and design rules for all database tables and entities in Ownlight. Every later schema addition or migration must conform to these rules.

---

## 1. Primary Keys & Identifiers: UUIDv7

All primary keys use **UUIDv7** (RFC 9562), stored natively in PostgreSQL `uuid` columns.

### Rationale

- **Time-Ordered B-Tree Locality:** Standard random UUIDs (UUIDv4) cause severe B-Tree index fragmentation and cache eviction at scale due to random insertion positions. UUIDv7 embeds a 48-bit big-endian millisecond timestamp in the high-order bits, ensuring sequential append-friendly indexing with index write performance rivaling sequential integers.
- **Client & Agent Generation:** UUIDv7s can be securely generated in application layers, client sessions, or background jobs without requiring round-trip database sequence allocation (`SERIAL` / `IDENTITY`).
- **No PII or Enumeration Leakage:** Unlike sequential auto-incrementing integer IDs (`1, 2, 3`), UUIDv7 does not leak business metrics (total clients, invoice counts, shoot volumes) or enable URL enumeration attacks.
- **Privacy by Design:** IDs and slugs must **never** contain personal names, email fragments, or sensitive details.

### Implementation Standard

- Generated via `generateUuidV7()` in `src/lib/id.ts`.
- Drizzle schema definition:
  ```typescript
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7());
  ```

---

## 2. Timestamps: UTC timestamptz

Every table tracking persistent entities must maintain two standard audit timestamps:

- `created_at`: Point in time of row creation.
- `updated_at`: Point in time of the most recent modification.

### Conventions

- Column type: `timestamp with time zone` (`timestamptz` in PostgreSQL, `timestamp({ withTimezone: true, mode: 'date' })` in Drizzle).
- Default value: `now()` (`DEFAULT now()`).
- Time zone storage: Strictly UTC. Application layer renders dates according to the configured studio time zone (`studio_settings.timezone`) or event location time zone.

---

## 3. Money Representation: Integer Minor Units & ISO Currency

To eliminate floating-point rounding errors and multi-currency ambiguity:

- **Amount:** All monetary values are represented as 64-bit integer minor units (e.g. Euro cents: `€150.00` = `15000`, `¥1000` = `1000`).
- **Currency:** Explicit 3-letter ISO 4217 currency code (e.g. `'EUR'`, `'USD'`, `'GBP'`, `'CHF'`).
- In multi-currency transactions, the currency code is co-located with the amount column (e.g. `package_price_cents` + `package_currency`).

---

## 4. Deletion Policy: GDPR Hard Delete by Default

Data retention and deletion align strictly with GDPR Article 17 (Right to Erasure) and data minimisation principles (Article 5(1)(c)).

### Rules

1. **Hard Delete by Default:** When a client or lead requests erasure or when transient records expire, records are permanently deleted via `DELETE FROM ...`.
2. **Short Undo Window (Optional):** Where user experience requires an undo window for accidental deletion (e.g. client project or shoot), a `deleted_at timestamptz` column may be used temporarily.
3. **Automated Purge:** Soft-deleted records are strictly bounded and automatically hard-deleted after the configured grace period (default: 30 days) by the retention framework (TASK-0007).
4. **Legal Holds:** Entities subject to statutory retention obligations (e.g. invoices under §147 AO / GoBD requiring 8 years retention) cannot be deleted until the statutory retention period expires, even upon erasure request.

---

## 5. Foreign Key Integrity: Explicit ON DELETE Actions

Every foreign key constraint must explicitly define its `ON DELETE` behaviour:

- **`ON DELETE RESTRICT` (Default for critical relations):** Prevents deletion of parent entities when active dependent children exist (e.g. cannot delete a client while unpaid invoices exist).
- **`ON DELETE CASCADE` (Only for strictly owned compositions):** Permitted only when children have no lifecycle independent of the parent (e.g. shoot questionnaire responses when a shoot inquiry is deleted).
- `ON DELETE SET NULL`: Permitted only for non-mandatory references (e.g. assigning a secondary tag or non-critical category).

---

## 6. Initial Core Table: `studio_settings`

The `studio_settings` table stores singleton tenant configuration for the photography studio instance:

| Column           | Type           | Constraints               | Description                                    |
| ---------------- | -------------- | ------------------------- | ---------------------------------------------- |
| `id`             | `uuid`         | `PRIMARY KEY`             | UUIDv7 primary key                             |
| `studio_name`    | `varchar(255)` | `NOT NULL`                | Studio trading name (may identify sole trader) |
| `default_locale` | `varchar(10)`  | `NOT NULL, DEFAULT 'en'`  | Default UI locale (`en` or `de`)               |
| `timezone`       | `varchar(64)`  | `NOT NULL, DEFAULT 'UTC'` | Studio IANA time zone identifier               |
| `currency`       | `varchar(3)`   | `NOT NULL, DEFAULT 'EUR'` | Studio default ISO 4217 currency code          |
| `created_at`     | `timestamptz`  | `NOT NULL, DEFAULT now()` | UTC creation timestamp                         |
| `updated_at`     | `timestamptz`  | `NOT NULL, DEFAULT now()` | UTC last update timestamp                      |

---

## 7. Clients & Contacts Domain (TASK-0009)

The clients domain models natural persons or corporate clients served by the studio, their individual contacts, and postal/billing addresses.

### `clients` Table

| Column             | Type           | Constraints                                          | Description                                     |
| ------------------ | -------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `id`               | `uuid`         | `PRIMARY KEY`                                        | UUIDv7 primary key                              |
| `kind`             | `varchar(20)`  | `NOT NULL, CHECK (kind IN ('person', 'company'))`    | Client type                                     |
| `display_name`     | `varchar(200)` | `NOT NULL`                                           | Person full name or company name                |
| `preferred_locale` | `varchar(10)`  | `NOT NULL, CHECK (preferred_locale IN ('en', 'de'))` | Communication locale                            |
| `last_activity_at` | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | Monotonic activity tracker for retention sweeps |
| `created_at`       | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC creation timestamp                          |
| `updated_at`       | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC last update timestamp                       |

### `client_contacts` Table

| Column             | Type           | Constraints                                          | Description                                  |
| ------------------ | -------------- | ---------------------------------------------------- | -------------------------------------------- |
| `id`               | `uuid`         | `PRIMARY KEY`                                        | UUIDv7 primary key                           |
| `client_id`        | `uuid`         | `NOT NULL, REFERENCES clients(id) ON DELETE CASCADE` | Foreign key to owning client                 |
| `given_name`       | `varchar(100)` | `NULL`                                               | First/given name                             |
| `family_name`      | `varchar(100)` | `NULL`                                               | Last/family name                             |
| `email`            | `varchar(254)` | `NULL`                                               | Cleartext contact email                      |
| `email_normalized` | `varchar(254)` | `NULL, INDEX`                                        | Lowercased & trimmed for duplicate detection |
| `phone`            | `varchar(32)`  | `NULL`                                               | E.164-compatible phone number                |
| `is_primary`       | `boolean`      | `NOT NULL, DEFAULT false`                            | Exactly one primary contact per client       |
| `created_at`       | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC creation timestamp                       |
| `updated_at`       | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC last update timestamp                    |

Constraints:

- `client_contacts_name_check`: `CHECK ((given_name IS NOT NULL AND length(trim(given_name)) > 0) OR (family_name IS NOT NULL AND length(trim(family_name)) > 0))`
- `client_contacts_client_id_primary_idx`: `UNIQUE INDEX (client_id) WHERE is_primary = true` (enforces exactly one primary contact per client)
- Foreign Key: `ON DELETE CASCADE` ensures contacts are removed when their client is erased.

### `client_addresses` Table

| Column         | Type           | Constraints                                          | Description                                |
| -------------- | -------------- | ---------------------------------------------------- | ------------------------------------------ |
| `id`           | `uuid`         | `PRIMARY KEY`                                        | UUIDv7 primary key                         |
| `client_id`    | `uuid`         | `NOT NULL, REFERENCES clients(id) ON DELETE CASCADE` | Foreign key to owning client               |
| `type`         | `varchar(20)`  | `NOT NULL, CHECK (type IN ('postal', 'billing'))`    | Address purpose                            |
| `line1`        | `varchar(200)` | `NOT NULL`                                           | Street address and house number            |
| `line2`        | `varchar(200)` | `NULL`                                               | Suite, apartment, or additional info       |
| `postal_code`  | `varchar(20)`  | `NOT NULL`                                           | Postal/ZIP code                            |
| `city`         | `varchar(100)` | `NOT NULL`                                           | Municipality or city                       |
| `region`       | `varchar(100)` | `NULL`                                               | State, province, or canton                 |
| `country_code` | `char(2)`      | `NOT NULL`                                           | Two-letter ISO 3166-1 alpha-2 country code |
| `created_at`   | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC creation timestamp                     |
| `updated_at`   | `timestamptz`  | `NOT NULL, DEFAULT now()`                            | UTC last update timestamp                  |

Constraints:

- `client_addresses_client_id_type_unique`: `UNIQUE (client_id, type)` (maximum 1 address per type per client)
- Foreign Key: `ON DELETE CASCADE` ensures addresses are removed when their client is erased.

### `tags` Table (TASK-0010)

| Column            | Type          | Constraints               | Description                                |
| ----------------- | ------------- | ------------------------- | ------------------------------------------ |
| `id`              | `uuid`        | `PRIMARY KEY`             | UUIDv7 primary key                         |
| `name`            | `varchar(50)` | `NOT NULL`                | Tag label (original casing)                |
| `name_normalized` | `varchar(50)` | `NOT NULL, UNIQUE`        | Trimmed, lowercased name for deduplication |
| `created_at`      | `timestamptz` | `NOT NULL, DEFAULT now()` | UTC creation timestamp                     |
| `updated_at`      | `timestamptz` | `NOT NULL, DEFAULT now()` | UTC last update timestamp                  |

### `client_tags` Table (TASK-0010)

| Column       | Type          | Constraints                                          | Description              |
| ------------ | ------------- | ---------------------------------------------------- | ------------------------ |
| `client_id`  | `uuid`        | `NOT NULL, REFERENCES clients(id) ON DELETE CASCADE` | Foreign key to client    |
| `tag_id`     | `uuid`        | `NOT NULL, REFERENCES tags(id) ON DELETE CASCADE`    | Foreign key to tag       |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT now()`                            | UTC assignment timestamp |

Constraints:

- Primary Key: `PRIMARY KEY (client_id, tag_id)`
- Foreign Keys: `ON DELETE CASCADE` on both references ensures tag links are cleaned up when a client or tag is deleted.
- Index: `client_tags_tag_id_idx` on `tag_id` for efficient reverse lookups and client counts.

---

## 8. Relationship Timeline & Notes Domain (TASK-0013, ADR-0011)

The relationship timeline models the unified append-only activity history for each client (enquiries, client creation, contact changes, notes, emails, documents, and portal activity). Notes provide free-text operator annotations.

### `client_timeline_events` Table

| Column         | Type          | Constraints                                                                        | Description                                                   |
| -------------- | ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `id`           | `uuid`        | `PRIMARY KEY`                                                                      | UUIDv7 primary key                                            |
| `client_id`    | `uuid`        | `NOT NULL, REFERENCES clients(id) ON DELETE CASCADE`                               | Owning client ID                                              |
| `type`         | `varchar(64)` | `NOT NULL`                                                                         | Typed event type key (e.g. `client.created`, `note.created`)  |
| `actor_type`   | `varchar(16)` | `NOT NULL, CHECK (actor_type IN ('owner', 'client', 'system', 'api_key', 'cron'))` | Identity principal type that triggered the event              |
| `actor_id`     | `uuid`        | `NULL`                                                                             | User or API key ID of the actor (NULL for system)             |
| `subject_type` | `varchar(32)` | `NULL`                                                                             | Optional target entity type (`client`, `contact`, `note`)     |
| `subject_id`   | `uuid`        | `NULL`                                                                             | Optional target entity UUID                                   |
| `occurred_at`  | `timestamptz` | `NOT NULL`                                                                         | Time the real-world business event occurred (UTC)             |
| `data`         | `jsonb`       | `NOT NULL, DEFAULT '{}'::jsonb`                                                    | Non-PII structured attributes allowlisted per registered type |
| `created_at`   | `timestamptz` | `NOT NULL, DEFAULT now()`                                                          | Write-time ledger timestamp                                   |

Constraints:

- Foreign Key: `ON DELETE CASCADE` ensures timeline history is permanently expunged when the parent client is erased.
- Index: `(client_id, occurred_at DESC, id DESC)` optimizes keyset pagination for reverse-chronological feeds.
- Actor Type Check: Enforces audit-compliant actor types matching the system audit log contract.
- Privacy Rule: Personal data (names, emails, note bodies) must **never** be copied into `data`. All content is resolved at read time by subject reference.

### `client_notes` Table

| Column       | Type          | Constraints                                          | Description                                    |
| ------------ | ------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `id`         | `uuid`        | `PRIMARY KEY`                                        | UUIDv7 primary key                             |
| `client_id`  | `uuid`        | `NOT NULL, REFERENCES clients(id) ON DELETE CASCADE` | Owning client ID                               |
| `body`       | `text`        | `NOT NULL`                                           | Free-text note body (CHECK 1–5,000 characters) |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT now()`                            | UTC creation timestamp                         |
| `updated_at` | `timestamptz` | `NOT NULL, DEFAULT now()`                            | UTC last update timestamp                      |

Constraints:

- `client_notes_body_len_check`: `CHECK (char_length(body) >= 1 AND char_length(body) <= 5000)`
- Foreign Key: `ON DELETE CASCADE` ensures notes are removed when their client is erased. Deleting an individual note also deletes its corresponding `note.created` timeline event in the same transaction.

---

## 9. How to Add a Timeline Event Type

Follow these steps whenever a new domain capability (e.g. project booking, contract signing, questionnaire submission) emits a timeline event:

1. **Register the Event Type:**
   In `src/server/timeline/registry.ts`, register the event specification using `registerTimelineEventType`:
   ```typescript
   registerTimelineEventType({
     type: 'project.created',
     dataKeys: ['project_number'], // strictly non-PII keys allowed in data JSONB
     messageKey: 'clients.timeline.events.projectCreated',
     resolve: async (events, ctx) => {
       // Optional batch content resolution for live entity attributes
     },
   });
   ```
2. **Ensure Privacy by Design (No PII in `data`):**
   The `data` payload must only contain identifiers, state codes, counts, or enum values. Never include names, email addresses, phone numbers, or free-text messages.
3. **Add Localisation Keys:**
   Add message formatting keys to both `messages/en.json` and `messages/de.json` under `clients.timeline.events.<camelCaseType>`.
4. **Emit Transactionally:**
   In your domain service or repository transaction, call `recordTimelineEvent(tx, input)` inside the exact same database transaction that persists the state change. If the domain operation fails, the event rolls back atomically.
5. **Verify with Tests:**
   Add test assertions verifying event registration, transactional rollback on error, and absence of PII in the database `data` column.

---

## 10. Client Legal Holds & Activity Provider Registry (TASK-0019)

### `client_legal_holds` Table

| Column              | Type           | Constraints                                                     | Description                                                            |
| ------------------- | -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                | `uuid`         | `PRIMARY KEY`                                                   | UUIDv7 primary key                                                     |
| `client_id`         | `uuid`         | `NOT NULL, UNIQUE, REFERENCES clients(id) ON DELETE RESTRICT`   | Owning client ID (foreign key restricts client deletion while present) |
| `reason`            | `varchar(50)`  | `NOT NULL, CHECK (reason IN ('dispute', 'statutory', 'other'))` | Legal justification category                                           |
| `note`              | `varchar(500)` | `NULL`                                                          | Optional reference or case context (max 500 chars; never PII/special)  |
| `until`             | `date`         | `NULL`                                                          | End date (inclusive); `NULL` designates an indefinite hold             |
| `set_by_actor_type` | `varchar(20)`  | `NOT NULL, CHECK (set_by_actor_type IN (...))`                  | Actor type (`owner`, `client`, `system`, `agent`, `token`)             |
| `set_by_actor_id`   | `varchar(100)` | `NULL`                                                          | Actor user or token ID                                                 |
| `created_at`        | `timestamptz`  | `NOT NULL, DEFAULT now()`                                       | UTC creation timestamp                                                 |
| `updated_at`        | `timestamptz`  | `NOT NULL, DEFAULT now()`                                       | UTC last update timestamp                                              |

### Activity Provider Registry (`src/server/clients/activity.ts`)

The `inactive-clients` retention policy determines candidate eligibility by checking `clients.last_activity_at < cutoff` against an extensible provider registry. Providers return the subset of candidate client IDs that have had qualifying activity at or after `since`.

Built-in providers registered in E1:

1. `timeline`: Non-system timeline events (`subject_type != 'system'` with `occurred_at >= since`).
2. `notes`: Client notes created or updated on or after `since`.
3. `consents`: Consent records created on or after `since` linked to client contacts.

### How E3 (Projects) Registers Project Activity

When Epic 3 (Projects & Shoots) is introduced, it registers a project activity provider in its domain bootstrap:

```typescript
import { registerActivityProvider } from '@/server/clients/activity';
import { projects } from '@/server/db/schema/projects';
import { inArray, gte, and } from 'drizzle-orm';

registerActivityProvider({
  id: 'projects',
  activeClientIds: async (tx, since, candidateIds) => {
    if (candidateIds.length === 0) return [];
    const rows = await tx
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(and(inArray(projects.clientId, candidateIds), gte(projects.updatedAt, since)));
    return rows.map((r) => r.clientId);
  },
});
```

Clients returned by any registered activity provider are exempted from automatic erasure during the sweep.

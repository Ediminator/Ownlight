# Data Retention & Storage Limitation (GDPR Art. 5(1)(e))

## 1. Overview & Principle

Personal data must not be kept in an identifiable form for longer than is necessary for the purposes for which it is processed (GDPR Art. 5(1)(e) _Storage limitation_). Ownlight enforces declarative, automated data lifecycle policies with database-backed batch processing, atomic transactions, dry-run capabilities, and statutory legal hold overrides.

---

## 2. Declarative Policy Framework

Retention policies are declared programmatically using `defineRetentionPolicy`:

```typescript
export interface RetentionPolicyDef<T = any> {
  id: string;                                   // Unique policy identifier
  entity: string;                               // Target entity/table name
  description?: string;                         // Human-readable rationale
  after?: { months?: number; days?: number };   // Relative retention window
  where?: (client: DbClient, now: Date) => ...; // Optional custom query predicate
  action: 'delete' | 'anonymize';               // Purge or anonymisation strategy
  legalHold?: (row: T) => boolean | Promise<boolean>; // Statutory hold predicate
  batchSize?: number;                           // Transaction batch limit (default 500)
}
```

### Registered Built-In Policies

| Policy ID                 | Target Entity     | Rule / Cutoff                                                                           | Action   | Default Retention                    |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| `audit-events-retention`  | `audit_events`    | `occurred_at < NOW() - RETENTION_PERIOD_MONTHS`                                         | `delete` | 24 months (configurable)             |
| `expired-sessions`        | `session`         | `expires_at < NOW()`                                                                    | `delete` | Immediate upon expiry (max 30 days)  |
| `expired-rate-limits`     | `rate_limits`     | `expires_at < NOW()`                                                                    | `delete` | Immediate upon expiry (max 24 hours) |
| `withdrawn-consent-proof` | `consent_records` | `latest status = 'withdrawn' AND effective_on < NOW() - CONSENT_PROOF_RETENTION_MONTHS` | `delete` | 36 months (configurable)             |

---

## 3. Statutory Legal Holds (`legalHold`)

A statutory or dispute legal hold halts the automatic deletion of matching records even after their normal retention period has lapsed.

### How Legal Holds Work

1. When a retention sweep identifies a row eligible for purge, it executes the policy's `legalHold(row)` predicate.
2. If `legalHold` returns `true`:
   - The row is **preserved** in the database.
   - The row ID is excluded from deletion batches.
   - The row is counted towards `heldCount` in the sweep report and completion audit record.
3. If `legalHold` returns `false` (or is not defined), the record proceeds to the atomic deletion batch.

### Statutory Drivers

- **GoBD & Tax Code (§147 AO, §14 UStG):** Accounting vouchers and invoices must be retained for 8 years (BEG IV 2025). When invoice tables are added, invoice-linked records carry an automated legal hold until statutory expiration.
- **Civil Claims (§195 BGB):** Contracts and project documentation subject to active disputes or civil limitation periods (3 years from year-end).
- **Security Breach Investigations (GDPR Art. 33/34):** Audit records flagged with `case_ref` or active investigation flags.

---

## 4. Execution & CLI Tooling

### Manual Sweep

The retention sweep can be triggered on-demand via package scripts:

```bash
# Safe simulation: queries matching records and reports counts; deletes 0 rows
pnpm run retention:sweep --dry-run

# Live execution: deletes eligible records in atomic transaction batches
pnpm run retention:sweep
```

### Batch Processing & Graceful Shutdown

- **Transaction Atomicity:** Records are purged in chunks (`batchSize: 500`). Each chunk runs inside an explicit database transaction (`client.transaction(...)`). Either all records in a batch are purged, or zero are purged if an error occurs.
- **SIGTERM / SIGINT Interruption:** When the worker process receives a termination signal during a sweep, it completes the current transaction batch before terminating. In-flight transactions are committed or rolled back cleanly with zero partial deletions.

### Audit Accountability

Every live sweep registers an audit log entry (`retention.sweep.completed`):

- Action: `retention.sweep.completed`
- Actor: `actor_type: 'system'`, `actor_id: 'retention-worker'`
- Metadata: `scanned_count`, `deleted_count`, `held_count`, `dry_run: false`, `duration_ms`

---

## 5. Background Worker Daemon

The background worker (`pnpm run worker`) runs continuously in containerized production deployments:

1. Acquires a PostgreSQL session-level advisory lock (`pg_try_advisory_lock(884210)`) to elect a single worker replica.
2. Schedules daily retention sweeps at 24-hour intervals.
3. Listens for `SIGTERM` and `SIGINT` signals, drains in-flight sweeps, releases the advisory lock, and shuts down cleanly.

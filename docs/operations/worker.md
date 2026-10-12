# Background Worker Operations

Ownlight runs asynchronous background jobs in a single, unified worker process.

## Architecture

The worker process (`BackgroundWorker`) runs as a single long-lived Node.js process alongside the web application. It handles scheduled maintenance, data retention sweeps, and external asynchronous integrations without requiring multiple daemon processes or external message brokers.

### Key Operational Characteristics

- **Single Process:** All background tasks run in the same worker process via an in-memory job registry.
- **Leader Election:** Multi-replica deployments (e.g. redundant container instances) coordinate via PostgreSQL session-level advisory lock (`WORKER_ADVISORY_LOCK_ID = 884210`). If a second instance starts while another holds the lock, it logs a notice and exits cleanly without running jobs.
- **Concurrency Isolation:** A running job never overlaps with the next scheduled run of the same job. If a run takes longer than the job's interval, subsequent interval ticks are skipped until the active run completes.
- **Error Isolation:** A failure or uncaught rejection in one job does not stop or crash other registered jobs. Job failures are logged with structured fields containing the job ID and error class only (zero message payload, zero personal data).
- **Graceful Shutdown:** On `SIGTERM` or `SIGINT`, the worker stops accepting new job executions, cancels scheduled interval timers, waits for currently in-flight job executions to finish, releases the PostgreSQL advisory lock, and closes database connections cleanly.

## Registered Jobs

| Job ID                   | Interval                   | Description                                                                                                                        |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `retention-sweep`        | 24 hours (`86_400_000` ms) | Daily GDPR/data retention sweep evaluating registered domain retention policies and purging expired records.                       |
| `google-contacts-outbox` | 15 seconds (`15_000` ms)   | Polling loop for pending Google Contacts outbox actions (`UPSERT`, `DELETE`), syncing opt-in client contacts to Google People API. |

## Running the Worker

### Production

The compiled standalone worker bundle is packaged at `dist/retention/worker.mjs` and executed via:

```bash
node dist/retention/worker.mjs
```

Or via the delegate runner:

```bash
node scripts/worker.mjs
```

### One-Off Run (`--run-once`)

To execute one immediate pass of all registered jobs and immediately exit (useful in cron environments or CI):

```bash
node dist/retention/worker.mjs --run-once
```

### Environment Variables

- `DATABASE_URL` / `DATABASE_RETENTION_URL`: PostgreSQL connection string (required).
- `ENCRYPTION_KEY`: 32-byte hex vault encryption key for OAuth tokens.

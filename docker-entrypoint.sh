#!/bin/sh
set -e

# ==============================================================================
# Container Entrypoint for Ownlight
# Handles database migration automation, readiness retries, credential
# redaction, and clean signal propagation to child processes.
# ==============================================================================

# Helper to sanitize database connection URLs (redact plaintext passwords)
sanitize_url() {
  echo "$1" | sed -E 's|://([^:]+):([^@]+)@|://\1:***@|g'
}

# Signal forwarding setup during entrypoint startup phase
trap 'echo "[entrypoint] Received SIGTERM during startup, terminating."; exit 143' TERM
trap 'echo "[entrypoint] Received SIGINT during startup, terminating."; exit 130' INT

AUTO_MIGRATE="${AUTO_MIGRATE:-true}"

if [ "$AUTO_MIGRATE" = "true" ]; then
  MIGRATE_URL="${MIGRATION_DATABASE_URL:-${DATABASE_MIGRATOR_URL:-${DATABASE_URL}}}"

  if [ -z "$MIGRATE_URL" ]; then
    echo "[entrypoint] ERROR: AUTO_MIGRATE is true but neither MIGRATION_DATABASE_URL nor DATABASE_URL is configured." >&2
    exit 1
  fi

  SAFE_URL="$(sanitize_url "$MIGRATE_URL")"
  echo "[entrypoint] Checking database connectivity for migrations at ${SAFE_URL}..."

  MAX_RETRIES=15
  RETRY_INTERVAL=2
  ATTEMPT=1
  READY=0

  while [ "$ATTEMPT" -le "$MAX_RETRIES" ]; do
    if __TARGET_URL="$MIGRATE_URL" node --input-type=module -e '
      import postgres from "postgres";
      const sql = postgres(process.env.__TARGET_URL, { connect_timeout: 3, max: 1, onnotice: () => {} });
      try {
        await sql`SELECT 1`;
        await sql.end({ timeout: 1 });
        process.exit(0);
      } catch {
        await sql.end({ timeout: 1 }).catch(() => {});
        process.exit(1);
      }
    ' 2>/dev/null; then
      READY=1
      break
    fi

    echo "[entrypoint] Database not ready yet (attempt ${ATTEMPT}/${MAX_RETRIES}), retrying in ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
    ATTEMPT=$((ATTEMPT + 1))
  done

  if [ "$READY" -ne 1 ]; then
    echo "[entrypoint] ERROR: Unable to establish database connection after ${MAX_RETRIES} attempts (${SAFE_URL})." >&2
    exit 1
  fi

  echo "[entrypoint] Running database migrations..."
  MIGRATE_OUTPUT=$(MIGRATION_DATABASE_URL="$MIGRATE_URL" node scripts/migrate.mjs 2>&1) || MIGRATE_FAILED=1

  # Ensure credentials are redacted from migration output
  SANITIZED_OUTPUT=$(echo "$MIGRATE_OUTPUT" | sed -E 's|://([^:]+):([^@]+)@|://\1:***@|g')
  if [ -n "$SANITIZED_OUTPUT" ]; then
    echo "$SANITIZED_OUTPUT"
  fi

  if [ -n "$MIGRATE_FAILED" ]; then
    echo "[entrypoint] ERROR: Database migration execution failed for ${SAFE_URL}." >&2
    exit 1
  fi

  echo "[entrypoint] Database migrations applied successfully."
else
  echo "[entrypoint] AUTO_MIGRATE is set to '${AUTO_MIGRATE}', skipping migrations."
fi

# Execute target command as PID 1, replacing the entrypoint shell process
exec "$@"

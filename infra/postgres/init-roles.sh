#!/bin/sh
set -e

# ==============================================================================
# PostgreSQL Least-Privilege Role Initialization
#
# Roles:
#  1. ownlight_migrator: Owns schema public, has DDL rights (CREATE, ALTER, DROP)
#  2. ownlight_app: Runtime application role, has DML rights only (SELECT, INSERT,
#     UPDATE, DELETE). Explicitly denied DDL / CREATE TABLE in public schema.
# ==============================================================================

POSTGRES_DB="${POSTGRES_DB:-ownlight_dev}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_APP_USER="${POSTGRES_APP_USER:-ownlight_app}"
POSTGRES_APP_PASSWORD="${POSTGRES_APP_PASSWORD}"
POSTGRES_MIGRATOR_USER="${POSTGRES_MIGRATOR_USER:-ownlight_migrator}"
POSTGRES_MIGRATOR_PASSWORD="${POSTGRES_MIGRATOR_PASSWORD}"

if [ -z "$POSTGRES_APP_PASSWORD" ] || [ -z "$POSTGRES_MIGRATOR_PASSWORD" ]; then
  echo "FATAL: POSTGRES_APP_PASSWORD and POSTGRES_MIGRATOR_PASSWORD must be set in environment."
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- 1. Create migration role with LOGIN (no superuser)
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${POSTGRES_MIGRATOR_USER}') THEN
        CREATE ROLE "${POSTGRES_MIGRATOR_USER}" WITH LOGIN PASSWORD '${POSTGRES_MIGRATOR_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE "${POSTGRES_MIGRATOR_USER}" WITH LOGIN PASSWORD '${POSTGRES_MIGRATOR_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END
    \$\$;

    -- 2. Create application role with LOGIN (no superuser)
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${POSTGRES_APP_USER}') THEN
        CREATE ROLE "${POSTGRES_APP_USER}" WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE "${POSTGRES_APP_USER}" WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END
    \$\$;

    -- 3. Grant connection privileges to the database
    GRANT CONNECT, CREATE ON DATABASE "${POSTGRES_DB}" TO "${POSTGRES_MIGRATOR_USER}";
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${POSTGRES_APP_USER}";

    -- 4. Assign schema ownership & DDL privileges to migration role
    GRANT USAGE, CREATE ON SCHEMA public TO "${POSTGRES_MIGRATOR_USER}";
    ALTER SCHEMA public OWNER TO "${POSTGRES_MIGRATOR_USER}";

    -- 5. Revoke DDL creation rights on public schema from PUBLIC and application role
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM "${POSTGRES_APP_USER}";

    -- 6. Grant schema USAGE (resolution of objects) to application role
    GRANT USAGE ON SCHEMA public TO "${POSTGRES_APP_USER}";

    -- 7. Grant DML rights on existing tables and sequences in public schema
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${POSTGRES_APP_USER}";
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${POSTGRES_APP_USER}";

    -- 8. Configure default privileges for future objects created by migration role
    ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_MIGRATOR_USER}" IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${POSTGRES_APP_USER}";

    ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_MIGRATOR_USER}" IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO "${POSTGRES_APP_USER}";

    -- 9. Enforce append-only permissions on audit_events table if it exists
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'audit_events') THEN
        REVOKE UPDATE, DELETE ON audit_events FROM "${POSTGRES_APP_USER}";
        GRANT SELECT, INSERT ON audit_events TO "${POSTGRES_APP_USER}";
      END IF;
    END
    \$\$;
EOSQL

echo "PostgreSQL role separation initialized successfully: ${POSTGRES_MIGRATOR_USER} (DDL), ${POSTGRES_APP_USER} (DML-only)."

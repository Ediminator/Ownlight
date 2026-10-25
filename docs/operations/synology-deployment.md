# Synology NAS Deployment & Operations Guide

This guide details the production deployment and maintenance of Ownlight on Synology DiskStation Manager (DSM 7.2+) using Container Manager (Docker Compose v2).

## Overview & Architecture

Ownlight runs as a containerized stack comprising:

- **`web`**: Next.js Standalone server running unprivileged as `nodejs` (UID 1001, GID 1001).
- **`worker`**: Background retention and scheduled tasks worker (`scripts/worker.mjs`).
- **`db`**: PostgreSQL 18.1 container with persistent volume storage and role separation (`ownlight_migrator` DDL vs. `ownlight_app` DML-only).
- **`mailpit`** _(optional)_: SMTP test sink for staging testing.

### Host Port Allocation (Gitea Port Collision Prevention)

> [!WARNING]
> **Synology Gitea Port Collision Warning**
> On the maintainer's Synology NAS, **port 3000 is reserved** by a self-hosted Gitea service.
> Ownlight **must NOT** be bound to host port 3000.
> The production compose configuration (`compose.synology.yml`) defaults the host port mapping to **3030** (`${PORT:-3030}:3000`).
> Always verify that `PORT=3030` is preserved in your `.env.synology` configuration.

---

## Staging & Production Deployment

### 1. Target Directory Structure

Ownlight is staged and deployed in the following directory on the Synology filesystem:

```text
/volume1/agent_scratch/staging/ownlight/
├── compose.synology.yml
├── .env.synology
├── infra/
│   └── postgres/
│       └── init-roles.sh
└── scripts/
    └── deploy-synology.sh
```

Ensure the staging directory exists:

```bash
mkdir -p /volume1/agent_scratch/staging/ownlight/infra/postgres
mkdir -p /volume1/agent_scratch/staging/ownlight/scripts
```

### 2. Environment Configuration

Copy the production environment template:

```bash
cp .env.synology.example /volume1/agent_scratch/staging/ownlight/.env.synology
chmod 600 /volume1/agent_scratch/staging/ownlight/.env.synology
```

Generate secure secrets for each mandatory variable in `/volume1/agent_scratch/staging/ownlight/.env.synology`:

```bash
# 1. AUTH_SECRET (Better-Auth session signing)
openssl rand -base64 32

# 2. SETUP_TOKEN (One-time initial owner bootstrap)
openssl rand -base64 32

# 3. ENCRYPTION_KEY (Field-level AES-256-GCM encryption key, 64 hex characters)
openssl rand -hex 32

# 4. Database passwords (PostgreSQL root, app, and migrator passwords)
openssl rand -base64 24
```

Verify your `.env.synology` contains:

```ini
PORT=3030
AUTH_URL=http://<synology-nas-ip>:3030
TRUSTED_PROXY_COUNT=1
POSTGRES_DB=ownlight_prod
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong_postgres_root_password>
POSTGRES_APP_USER=ownlight_app
POSTGRES_APP_PASSWORD=<strong_app_password>
POSTGRES_MIGRATOR_USER=ownlight_migrator
POSTGRES_MIGRATOR_PASSWORD=<strong_migrator_password>
AUTH_SECRET=<generated_auth_secret>
SETUP_TOKEN=<generated_setup_token>
ENCRYPTION_KEY=<generated_encryption_key>
AUTO_MIGRATE=true
```

### 3. Deploying the Stack

Copy `compose.synology.yml` and `infra/postgres/init-roles.sh`:

```bash
cp compose.synology.yml /volume1/agent_scratch/staging/ownlight/
cp infra/postgres/init-roles.sh /volume1/agent_scratch/staging/ownlight/infra/postgres/init-roles.sh
chmod +x /volume1/agent_scratch/staging/ownlight/infra/postgres/init-roles.sh
```

Execute the deployment script:

```bash
cd /volume1/agent_scratch/staging/ownlight
./scripts/deploy-synology.sh
```

Or run Docker Compose directly:

```bash
docker compose -f compose.synology.yml --env-file .env.synology pull
docker compose -f compose.synology.yml --env-file .env.synology up -d --remove-orphans
```

### 4. Initial Bootstrap (Setup Token Redemption)

Once the containers are healthy, browse to the setup endpoint:

```text
http://<synology-nas-ip>:3030/en/setup
```

1. Enter the `SETUP_TOKEN` from `.env.synology`.
2. Provide the studio owner email, name, and secure password.
3. Upon registration, the setup token is invalidated, establishing the instance owner.

---

## Maintenance & Operations

### Continuous Image Updates

When a new container image is pushed to GitHub Container Registry (`ghcr.io/ediminator/ownlight:latest`), update the stack:

```bash
cd /volume1/agent_scratch/staging/ownlight
docker compose -f compose.synology.yml --env-file .env.synology pull
docker compose -f compose.synology.yml --env-file .env.synology up -d --remove-orphans
```

The `docker-entrypoint.sh` script automatically checks database readiness and runs pending DDL migrations (`AUTO_MIGRATE=true`) before starting the web application.

### Container Health Checks

Verify container status:

```bash
docker compose -f compose.synology.yml --env-file .env.synology ps
```

Probe the web service health endpoint directly:

```bash
curl -f http://127.0.0.1:3030/api/health
```

### PostgreSQL Backup & Restore

#### Backup

To create a consistent SQL dump of the production database:

```bash
BACKUP_FILE="/volume1/agent_scratch/backups/ownlight_$(date +%Y%m%d_%H%M%S).sql"
mkdir -p /volume1/agent_scratch/backups

docker compose -f compose.synology.yml --env-file .env.synology exec -T db \
  pg_dump -U postgres ownlight_prod > "$BACKUP_FILE"

chmod 600 "$BACKUP_FILE"
echo "Backup created at $BACKUP_FILE"
```

#### Restore

To restore from a backup file:

```bash
docker compose -f compose.synology.yml --env-file .env.synology stop web worker

docker compose -f compose.synology.yml --env-file .env.synology exec -T db \
  psql -U postgres -d ownlight_prod < "$BACKUP_FILE"

docker compose -f compose.synology.yml --env-file .env.synology start web worker
```

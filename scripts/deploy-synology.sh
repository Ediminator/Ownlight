#!/bin/sh
set -e

# ==============================================================================
# Ownlight Staging Deployment Helper for Synology NAS
# Target Path: /volume1/agent_scratch/staging/ownlight/
# ==============================================================================

STAGING_DIR="/volume1/agent_scratch/staging/ownlight"

# Switch to staging directory if executing from another path
if [ -d "$STAGING_DIR" ] && [ "$(pwd)" != "$STAGING_DIR" ]; then
  echo "Switching working directory to $STAGING_DIR..."
  cd "$STAGING_DIR"
fi

ENV_FILE=".env.synology"
COMPOSE_FILE="compose.synology.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Configuration file $ENV_FILE not found!" >&2
  echo "   Create it from .env.synology.example:" >&2
  echo "   cp .env.synology.example $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "❌ Compose file $COMPOSE_FILE not found in $(pwd)!" >&2
  exit 1
fi

# Load environment variables for safety checks
# shellcheck disable=SC1090
. "./$ENV_FILE"

# Port conflict safety verification
TARGET_PORT="${PORT:-3030}"
if [ "$TARGET_PORT" = "3000" ]; then
  echo "⚠️ WARNING: Host port 3000 detected!" >&2
  echo "   Synology Gitea is hosted on host port 3000." >&2
  echo "   Running Ownlight on port 3000 will cause a port collision and service conflict." >&2
  echo "   Please set PORT=3030 in $ENV_FILE to prevent port collision." >&2
  exit 1
fi

echo "🚀 Deploying Ownlight on Synology NAS (Host Port: ${TARGET_PORT})..."

# Pull latest container images from GHCR
echo "📦 Pulling latest container images..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

# Deploy services with recreation of updated containers
echo "🔄 Starting Ownlight services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

# Healthcheck loop
echo "⏳ Verifying web service health on port ${TARGET_PORT}..."
MAX_CHECKS=15
CHECK_COUNT=1
HEALTHY=0

while [ "$CHECK_COUNT" -le "$MAX_CHECKS" ]; do
  if wget -q --spider "http://127.0.0.1:${TARGET_PORT}/api/health" 2>/dev/null || \
     curl -sf "http://127.0.0.1:${TARGET_PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
  CHECK_COUNT=$((CHECK_COUNT + 1))
done

if [ "$HEALTHY" -eq 1 ]; then
  echo "✅ Ownlight stack is healthy and operational!"
  echo "   Web interface: http://<synology-nas-ip>:${TARGET_PORT}"
  if [ -n "$SETUP_TOKEN" ]; then
    echo "   Initial setup: http://<synology-nas-ip>:${TARGET_PORT}/en/setup"
  fi
else
  echo "⚠️ Web healthcheck did not respond within 30 seconds."
  echo "   Check container logs: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs"
fi

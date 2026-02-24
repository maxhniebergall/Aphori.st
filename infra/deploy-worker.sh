#!/bin/bash
set -euo pipefail

# Deploys/restarts the BullMQ worker container on the DB VM.
# Usage: deploy-worker.sh <image>
# Example: deploy-worker.sh gcr.io/aphorist/chitin-worker:abc1234

IMAGE="${1:?Usage: deploy-worker.sh <image>}"
PROJECT="aphorist"
WORK_DIR=/home/chitin-db
CONTAINER_NAME="chitin-worker"
NETWORK="chitin-net"

cleanup() { rm -f "${ENV_FILE:-}"; rm -rf "${DOCKER_CONFIG:-}"; }
trap cleanup EXIT

# ── Fetch secrets from GCP Secret Manager ──

TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | tr -d '\n ' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get access token from metadata server."
  exit 1
fi

fetch_secret() {
  local secret_name=$1
  local response
  response=$(curl -sf \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${secret_name}/versions/latest:access")

  if [ -z "$response" ]; then
    echo "ERROR: Failed to fetch secret ${secret_name}" >&2
    return 1
  fi

  echo "$response" | tr -d '\n ' | sed -n 's/.*"data":"\([^"]*\)".*/\1/p' | base64 -d
}

echo "Fetching secrets..."
POSTGRES_PASSWORD=$(fetch_secret POSTGRES_PASSWORD)
REDIS_PASSWORD=$(fetch_secret REDIS_PASSWORD)
GEMINI_API_KEY=$(fetch_secret GEMINI_API_KEY)

if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$REDIS_PASSWORD" ] || [ -z "$GEMINI_API_KEY" ]; then
  echo "ERROR: Failed to fetch one or more secrets."
  exit 1
fi

# ── Authenticate Docker to GCR (reuse $TOKEN from above) ──

# Docker login tries to save credentials to ~/.docker/config.json.
# On VMs with a read-only root filesystem, redirect to a temp directory.
export DOCKER_CONFIG=$(mktemp -d)

echo "Authenticating Docker to GCR..."
echo "$TOKEN" | docker login -u oauth2accesstoken --password-stdin https://gcr.io

# ── Create Docker network if needed ──

docker network create "$NETWORK" 2>/dev/null || true

# ── Ensure DB containers are on the network ──
# If postgres/redis were restarted outside of start-db.sh they may have lost
# their network attachment. Reconnect them so the worker can resolve hostnames.

for dep in chitin-postgres chitin-redis; do
  if docker ps -q --filter "name=$dep" | grep -q .; then
    docker network connect "$NETWORK" "$dep" 2>/dev/null || true
    echo "$dep: connected to $NETWORK"
  else
    echo "WARNING: $dep is not running — worker will fail to connect"
  fi
done

# ── Pull image ──

echo "Pulling $IMAGE..."
docker pull "$IMAGE"

# ── Stop/remove old worker container ──

echo "Stopping old worker container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# ── Write secrets to a temp env-file (avoids leaking via docker inspect / ps) ──

ENV_FILE=$(mktemp)
cat > "$ENV_FILE" <<EOF
DB_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
GOOGLE_API_KEY=${GEMINI_API_KEY}
EOF
chmod 600 "$ENV_FILE"

# ── Start worker container ──

echo "Starting worker container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  -e SUPERVISOR_CONF=/etc/supervisor/conf.d/worker-supervisord.conf \
  -e NODE_ENV=production \
  -e DB_HOST=chitin-postgres \
  -e DB_PORT=5432 \
  -e DB_USER=chitin \
  -e DB_NAME=chitin \
  -e REDIS_HOST=chitin-redis \
  -e REDIS_PORT=6379 \
  -e BATCH_STARTUP_ENABLED=true \
  -e BATCH_CHECKPOINT_BUCKET=aphorist-batch-ingestion-bucket \
  -e PYDANTIC_SKIP_VALIDATING_CORE_SCHEMAS=true \
  --health-cmd "supervisorctl status worker | grep -q RUNNING" \
  --health-interval 30s \
  --health-timeout 5s \
  --health-start-period 45s \
  --health-retries 3 \
  "$IMAGE"

echo ""
echo "=== Worker container started ==="
docker ps --filter "name=$CONTAINER_NAME"

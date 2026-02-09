#!/bin/bash
set -euo pipefail

# Fetches secrets from GCP Secret Manager using the instance metadata server
# and starts PostgreSQL + Redis via docker run.
# Works on Container-Optimized OS (no gcloud, python, or docker-compose needed).

PROJECT="aphorist"
WORK_DIR=/home/chitin-db
cd "$WORK_DIR"

PG_PORT="${1:?Usage: start-db.sh <pg_port> <redis_port>}"
REDIS_PORT="${2:?Usage: start-db.sh <pg_port> <redis_port>}"

# Get access token from the instance metadata server
TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | tr -d '\n ' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get access token from metadata server."
  exit 1
fi

# Fetch a secret value from Secret Manager REST API
# Response: {"name":"...","payload":{"data":"BASE64_VALUE","dataCrc32c":"..."}}
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

  # Extract the base64-encoded data from payload.data and decode it
  # API may return pretty-printed JSON, so handle optional whitespace
  echo "$response" | tr -d '\n ' | sed -n 's/.*"data":"\([^"]*\)".*/\1/p' | base64 -d
}

echo "Fetching secrets from Secret Manager..."
POSTGRES_PASSWORD=$(fetch_secret POSTGRES_PASSWORD)
REDIS_PASSWORD=$(fetch_secret REDIS_PASSWORD)

if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$REDIS_PASSWORD" ]; then
  echo "ERROR: Failed to fetch one or more secrets. Check VM service account permissions."
  exit 1
fi

# Stop and remove existing containers (if any)
echo "Cleaning up old containers..."
docker rm -f chitin-postgres chitin-redis 2>/dev/null || true

echo "Starting PostgreSQL..."
docker run -d \
  --name chitin-postgres \
  --restart unless-stopped \
  -p "${PG_PORT}:5432" \
  -e POSTGRES_USER=chitin \
  -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  -e POSTGRES_DB=chitin \
  -v /mnt/stateful_partition/chitin/postgres:/var/lib/postgresql/data \
  -v "${WORK_DIR}/init:/docker-entrypoint-initdb.d" \
  pgvector/pgvector:pg16

echo "Starting Redis..."
docker run -d \
  --name chitin-redis \
  --restart unless-stopped \
  -p "${REDIS_PORT}:6379" \
  -v /mnt/stateful_partition/chitin/redis:/data \
  redis:7-alpine \
  redis-server --requirepass "${REDIS_PASSWORD}"

echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker exec chitin-postgres pg_isready -U chitin -d chitin &> /dev/null; then
    echo "PostgreSQL is ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PostgreSQL failed to start within 30 seconds"
    docker logs chitin-postgres
    exit 1
  fi
  sleep 1
done

# Sync password from Secret Manager into PostgreSQL
# (POSTGRES_PASSWORD env var is only used during first initdb, not on subsequent starts)
echo "Syncing database password from Secret Manager..."
docker exec chitin-postgres psql -U chitin -d chitin -c "ALTER USER chitin PASSWORD '${POSTGRES_PASSWORD}';"

echo "Verifying Redis..."
if docker exec chitin-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
  echo "Redis is ready!"
else
  echo "ERROR: Redis is not responding"
  docker logs chitin-redis
  exit 1
fi

echo ""
echo "=== Database services running ==="
docker ps --filter name=chitin-

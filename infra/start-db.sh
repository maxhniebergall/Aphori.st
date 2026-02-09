#!/usr/bin/env bash
set -euo pipefail

# Fetches secrets from GCP Secret Manager using the instance metadata server
# and starts PostgreSQL + Redis via docker compose.
# Works on Container-Optimized OS (no gcloud or python needed — just curl and base64).

PROJECT="aphorist"
WORK_DIR=/opt/chitin-db
cd "$WORK_DIR"

# Get access token from the instance metadata server
TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

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
  echo "$response" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p' | base64 -d
}

echo "Fetching secrets from Secret Manager..."
export POSTGRES_PASSWORD=$(fetch_secret POSTGRES_PASSWORD)
export REDIS_PASSWORD=$(fetch_secret REDIS_PASSWORD)

if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$REDIS_PASSWORD" ]; then
  echo "ERROR: Failed to fetch one or more secrets. Check VM service account permissions."
  exit 1
fi

echo "Starting PostgreSQL and Redis..."
docker compose up -d

echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec postgres pg_isready -U chitin -d chitin &> /dev/null; then
    echo "PostgreSQL is ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PostgreSQL failed to start within 30 seconds"
    docker compose logs postgres
    exit 1
  fi
  sleep 1
done

echo "Verifying Redis..."
if docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
  echo "Redis is ready!"
else
  echo "ERROR: Redis is not responding"
  docker compose logs redis
  exit 1
fi

echo ""
echo "=== Database services running ==="
docker compose ps

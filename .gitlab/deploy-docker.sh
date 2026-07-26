#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5435}"
DB_USER="${DB_USER:-arkiv}"
DB_PASS="${DB_PASS:-301010**}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"

require_var() {
  if [ -z "${!1:-}" ]; then
    echo "Missing required environment variable: $1" >&2
    exit 1
  fi
}

require_var DOCKER_IMAGE
require_var CONTAINER_NAME
require_var HOST_PORT
require_var DATABASE_NAME
require_var NEXT_PUBLIC_APP_URL
require_var NEXT_PUBLIC_BASE_URL

if [ -w /etc/gai.conf ] && ! grep -q 'precedence :ffff:0:0/96' /etc/gai.conf; then
  echo 'precedence :ffff:0:0/96  100' >> /etc/gai.conf
fi

DOCKER_BUILDKIT=0 docker pull node:22-alpine || true
DOCKER_BUILDKIT=0 docker build --network=host -t "$DOCKER_IMAGE:latest" .

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}" \
  --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DATABASE_NAME}" \
  -e MIGRATE_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DATABASE_NAME}" \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  -e NEXT_PUBLIC_BASE_URL="$NEXT_PUBLIC_BASE_URL" \
  "$DOCKER_IMAGE:latest"

docker system prune -f
curl -fsSL "http://127.0.0.1:${HOST_PORT}/login" >/dev/null

#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
encode_db_pass() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["DB_PASS"], safe=""))'
  elif command -v node >/dev/null 2>&1; then
    node -e 'console.log(encodeURIComponent(process.env.DB_PASS))'
  else
    printf '%s' "$DB_PASS" | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/!/%21/g' -e 's/\*/%2A/g'
  fi
}

# Dev (arkiv-development) boleh pakai password lama via DB_PASS / DEV_DB_PASS_URLENCODED
# supaya tidak tertukar dengan password postgres produksi.
if [ "${CONTAINER_NAME:-}" = "arkiv-development" ]; then
  if [ -n "${DEV_DB_PASS_URLENCODED:-}" ]; then
    DB_PASS_URLENCODED="$DEV_DB_PASS_URLENCODED"
  elif [ -n "${DB_PASS:-}" ]; then
    DB_PASS_URLENCODED="$(encode_db_pass)"
  else
    DB_PASS_URLENCODED="${DB_PASS_URLENCODED:-}"
  fi
else
  DB_PASS_URLENCODED="${DB_PASS_URLENCODED:-}"
fi
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"

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
require_var STORAGE_DIR
require_var NEXT_PUBLIC_APP_URL
require_var NEXT_PUBLIC_BASE_URL
require_var DB_PASS_URLENCODED

if [ -w /etc/gai.conf ] && ! grep -q 'precedence :ffff:0:0/96' /etc/gai.conf; then
  echo 'precedence :ffff:0:0/96  100' >> /etc/gai.conf
fi

DOCKER_BUILDKIT=0 docker pull node:22-alpine || true
DOCKER_BUILDKIT=0 docker build --network=host -t "$DOCKER_IMAGE:latest" .

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

# Unggahan (kontrak bertanda tangan, psikotes, CV, foto member) ditulis ke
# /app/storage di dalam container. Tanpa volume, seluruhnya ikut terhapus setiap
# redeploy karena container dibuat ulang dari image.
#
# Direktori ini disiapkan sekali oleh admin, bukan oleh CI: isinya data pribadi
# sehingga dikunci ke uid 1001 (user nextjs) dengan mode 750 — runner yang jalan
# sebagai user biasa memang tidak boleh menulis ke sana.
#
#   sudo mkdir -p <dir>/uploads <dir>/private
#   sudo chown -R 1001:65533 <dir> && sudo chmod 750 <dir>
if [ ! -d "$STORAGE_DIR" ]; then
  echo "STORAGE_DIR tidak ditemukan: $STORAGE_DIR" >&2
  echo "Siapkan dulu di host (lihat komentar di skrip ini). Deploy dihentikan agar" >&2
  echo "docker tidak membuat direktori kosong milik root dan unggahan gagal lagi." >&2
  exit 1
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${BIND_ADDRESS}:${HOST_PORT}:${CONTAINER_PORT}" \
  --add-host host.docker.internal:host-gateway \
  -v "${STORAGE_DIR}:/app/storage" \
  -e DATABASE_URL="postgresql://${DB_USER}:${DB_PASS_URLENCODED}@${DB_HOST}:${DB_PORT}/${DATABASE_NAME}" \
  -e MIGRATE_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS_URLENCODED}@${DB_HOST}:${DB_PORT}/${DATABASE_NAME}" \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  -e NEXT_PUBLIC_BASE_URL="$NEXT_PUBLIC_BASE_URL" \
  "$DOCKER_IMAGE:latest"

for attempt in $(seq 1 30); do
  if curl -fsSL "http://127.0.0.1:${HOST_PORT}/login" >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "Application did not become ready on port ${HOST_PORT}" >&2
docker logs --tail 100 "$CONTAINER_NAME" >&2 || true
exit 1

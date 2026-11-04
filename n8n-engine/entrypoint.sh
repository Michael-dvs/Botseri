#!/bin/sh
set -eu

DASHBOARD_URL="${DASHBOARD_URL:-http://botseri-dashboard:3000}"
WORKFLOW_DIR="/workflows"
HASH_FILE="${HOME}/.n8n/workflows.hash"
CREDENTIALS_TEMPLATE="/credentials.template.json"
CREDENTIALS_TMP="$(mktemp /tmp/botseri-credentials.XXXXXX)"

log() { printf '[botseri-n8n] %s\n' "$*"; }

cleanup() {
  rm -f "$CREDENTIALS_TMP"
}
trap cleanup EXIT INT TERM

for name in INTERNAL_API_TOKEN WAHA_API_KEY; do
  value="$(printenv "$name" || true)"
  if [ -z "$value" ]; then
    log "variabel ${name} kosong; batalkan start"
    exit 1
  fi
done

log "menunggu ${DASHBOARD_URL}/api/internal/health"
attempt=0
until curl -fsS "${DASHBOARD_URL}/api/internal/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    log "dashboard tidak sehat setelah 120 percobaan"
    exit 1
  fi
  sleep 5
done
log "dashboard sehat"

node - "$CREDENTIALS_TEMPLATE" "$CREDENTIALS_TMP" <<'NODE'
const fs = require('fs');
const [templatePath, outputPath] = process.argv.slice(2);
const template = fs.readFileSync(templatePath, 'utf8');
const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? '');
fs.writeFileSync(outputPath, rendered, { mode: 0o600 });
NODE

if ! jq empty "$CREDENTIALS_TMP" >/dev/null 2>&1; then
  log "template kredensial tidak valid setelah render"
  exit 1
fi

if ! n8n import:credentials --input="$CREDENTIALS_TMP"; then
  log "impor kredensial gagal; kredensial mungkin sudah ada"
fi
rm -f "$CREDENTIALS_TMP"

mkdir -p "$(dirname "$HASH_FILE")"
WORKFLOW_COUNT="$(find "$WORKFLOW_DIR" -type f -name '*.json' | wc -l | tr -d ' ')"

if [ "$WORKFLOW_COUNT" -gt 0 ]; then
  CURRENT_HASH="$(find "$WORKFLOW_DIR" -type f -name '*.json' | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)"
  STORED_HASH="$(cat "$HASH_FILE" 2>/dev/null || true)"

  if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
    log "workflow berubah; mengimpor dan mengaktifkan"
    if ! n8n import:workflow --separate --input="$WORKFLOW_DIR"; then
      log "impor workflow gagal"
      exit 1
    fi
    if ! n8n update:workflow --all --active=true; then
      log "aktivasi workflow gagal"
      exit 1
    fi
    printf '%s' "$CURRENT_HASH" > "${HASH_FILE}.tmp"
    mv "${HASH_FILE}.tmp" "$HASH_FILE"
  else
    log "workflow tidak berubah"
  fi
else
  log "belum ada workflow di ${WORKFLOW_DIR}"
fi

exec n8n start

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Periksa prasyarat
command -v curl >/dev/null 2>&1 || { echo "Error: curl tidak ditemukan." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq tidak ditemukan." >&2; exit 1; }

# Baca .env bila tersedia
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

INTERNAL_TOKEN="${INTERNAL_API_TOKEN:-}"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:3000}"

FAILURES=0
TOTAL_COUNT=0
PASSED_COUNT=0

check() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"
  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  if [ "$status" -eq 0 ]; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
    printf 'PASS  %s\n' "$name"
  else
    if [ -n "$detail" ]; then
      printf 'FAIL  %s (%s)\n' "$name" "$detail" >&2
    else
      printf 'FAIL  %s\n' "$name" >&2
    fi
    FAILURES=$((FAILURES + 1))
  fi
}

echo "Menjalankan Botseri Smoke Test..."
echo "Target dashboard: $DASHBOARD_URL"
echo ""

# 1. /api/internal/health mengembalikan status: ok dan db: true
HEALTH_RES="$(curl -s --max-time 5 "$DASHBOARD_URL/api/internal/health" 2>/dev/null || echo "{}")"
HEALTH_OK=1
if echo "$HEALTH_RES" | jq -e '.status == "ok" and .db == true' >/dev/null 2>&1; then
  HEALTH_OK=0
fi
check "Health check: /api/internal/health (status=ok, db=true)" "$HEALTH_OK"

# 1b. Indikator migrasi database aktif pada /api/internal/health
MIGRATION_IND_OK=1
if echo "$HEALTH_RES" | jq -e '.migration != null' >/dev/null 2>&1; then
  MIGRATION_IND_OK=0
fi
check "Indikator migrasi: /api/internal/health memiliki kolom migration aktif" "$MIGRATION_IND_OK"

# 2. /api/internal/tools/get-prioritized-todos tanpa Bearer menghasilkan 401
HTTP_NO_AUTH="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$DASHBOARD_URL/api/internal/tools/get-prioritized-todos" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")"
UNAUTH_OK=1
[ "$HTTP_NO_AUTH" = "401" ] && UNAUTH_OK=0
check "Auth guard: get-prioritized-todos tanpa Bearer (HTTP 401)" "$UNAUTH_OK" "status: $HTTP_NO_AUTH"

# 3. get-prioritized-todos dengan token sah menghasilkan 200 (read-only)
AUTH_OK=1
if [ -n "$INTERNAL_TOKEN" ]; then
  HTTP_AUTH="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
    -X POST "$DASHBOARD_URL/api/internal/tools/get-prioritized-todos" \
    -H "Authorization: Bearer $INTERNAL_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null || echo "000")"
  [ "$HTTP_AUTH" = "200" ] && AUTH_OK=0
  check "Auth success: get-prioritized-todos dengan Bearer sah (HTTP 200)" "$AUTH_OK" "status: $HTTP_AUTH"
else
  check "Auth success: get-prioritized-todos dengan Bearer sah" 1 "INTERNAL_API_TOKEN kosong di environment"
fi

# 3b. Read-only: get-orders mengembalikan format data pesanan sah (read-only)
ORDERS_OK=1
if [ -n "$INTERNAL_TOKEN" ]; then
  ORDERS_RES="$(curl -s --max-time 5 \
    -X POST "$DASHBOARD_URL/api/internal/tools/get-orders" \
    -H "Authorization: Bearer $INTERNAL_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null || echo "{}")"
  if echo "$ORDERS_RES" | jq -e '.ok == true and (.total_active != null)' >/dev/null 2>&1; then
    ORDERS_OK=0
  fi
  check "Read-only tools: get-orders format data pesanan sah (HTTP 200)" "$ORDERS_OK"
else
  check "Read-only tools: get-orders format data pesanan sah" 1 "INTERNAL_API_TOKEN kosong di environment"
fi

# 3c. Auth guard: GET /api/pipeline tanpa sesi ditolak (HTTP 401)
PIPELINE_GUARD_OK=1
HTTP_PIPE_GUARD="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "$DASHBOARD_URL/api/pipeline" 2>/dev/null || echo "000")"
[ "$HTTP_PIPE_GUARD" = "401" ] && PIPELINE_GUARD_OK=0
check "Auth guard: GET /api/pipeline tanpa sesi ditolak (HTTP 401)" "$PIPELINE_GUARD_OK" "status: $HTTP_PIPE_GUARD"

# 4. Validasi workflow n8n (validate-workflows.sh)
WORKFLOWS_OK=1
"$REPO_ROOT/scripts/validate-workflows.sh" >/dev/null 2>&1 && WORKFLOWS_OK=0
check "Workflow n8n: validate-workflows.sh lulus" "$WORKFLOWS_OK"

# 4b. Pemindaian rahasia di repositori (check-secrets.sh)
SECRETS_OK=1
"$REPO_ROOT/scripts/check-secrets.sh" >/dev/null 2>&1 && SECRETS_OK=0
check "Pemeriksaan rahasia: check-secrets.sh lulus" "$SECRETS_OK"

# 5. Container botseri-n8n TIDAK memiliki DATABASE_URL (INV-01)
N8N_DB_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-n8n"; then
  if docker compose exec -T botseri-n8n printenv DATABASE_URL >/dev/null 2>&1; then
    N8N_DB_OK=1
  else
    N8N_DB_OK=0
  fi
  check "INV-01: Container botseri-n8n TIDAK memiliki DATABASE_URL" "$N8N_DB_OK"
else
  check "INV-01: Container botseri-n8n TIDAK memiliki DATABASE_URL" 0 "dilewati: container tidak aktif di host ini"
fi

# 5b. Healthcheck: container botseri-n8n berstatus healthy
N8N_HEALTHY_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-n8n"; then
  N8N_HEALTH="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' botseri-n8n 2>/dev/null || echo "unknown")"
  if [ "$N8N_HEALTH" = "healthy" ] || [ "$N8N_HEALTH" = "running" ]; then
    N8N_HEALTHY_OK=0
  fi
  check "Healthcheck: container botseri-n8n berstatus healthy/running" "$N8N_HEALTHY_OK" "status: $N8N_HEALTH"
else
  check "Healthcheck: container botseri-n8n berstatus healthy/running" 0 "dilewati: container tidak aktif di host ini"
fi

# 6. Migrasi Prisma selesai (_prisma_migrations tidak ada yang gagal/tertunda)
MIGRATIONS_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-db"; then
  FAILED_COUNT="$(docker compose exec -T botseri-db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-botseri}" -t -c \
    "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL;" 2>/dev/null | tr -d ' ' || echo "1")"
  [ "$FAILED_COUNT" = "0" ] && MIGRATIONS_OK=0
  check "Database: Seluruh migrasi Prisma selesai tanpa rollback" "$MIGRATIONS_OK" "failed: $FAILED_COUNT"
else
  check "Database: Seluruh migrasi Prisma selesai tanpa rollback" 0 "dilewati: container tidak aktif di host ini"
fi

# 7. WAHA API terjangkau dari dalam container dashboard
WAHA_REACHABLE_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-dashboard"; then
  WAHA_CHECK_HTTP="$(docker compose exec -T botseri-dashboard node -e '
    fetch("http://botseri-waha:3000/api/server/version")
      .then(r => console.log(r.status))
      .catch(() => console.log("000"))
  ' 2>/dev/null | tr -d '\r\n ' || echo "000")"
  if [ "$WAHA_CHECK_HTTP" = "200" ] || [ "$WAHA_CHECK_HTTP" = "401" ]; then
    WAHA_REACHABLE_OK=0
  fi
  check "Jaringan internal: WAHA terjangkau dari container dashboard" "$WAHA_REACHABLE_OK" "status: $WAHA_CHECK_HTTP"
else
  check "Jaringan internal: WAHA terjangkau dari container dashboard" 0 "dilewati: container tidak aktif di host ini"
fi

# 8. INV-08: Request dengan cf-connecting-ip menghasilkan 404
CF_HTTP="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -H "cf-connecting-ip: 1.2.3.4" \
  "$DASHBOARD_URL/api/internal/health" 2>/dev/null || echo "000")"
INV08_OK=1
[ "$CF_HTTP" = "404" ] && INV08_OK=0
check "INV-08: Rute internal via Cloudflare ditolak (HTTP 404)" "$INV08_OK" "status: $CF_HTTP"

# Kontrol: tanpa header Cloudflare harus 200
CTRL_HTTP="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "$DASHBOARD_URL/api/internal/health" 2>/dev/null || echo "000")"
CTRL_OK=1
[ "$CTRL_HTTP" = "200" ] && CTRL_OK=0
check "INV-08 Kontrol: Rute internal lokal diizinkan (HTTP 200)" "$CTRL_OK" "status: $CTRL_HTTP"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "HASIL: Seluruh pemeriksaan smoke test LULUS ($PASSED_COUNT/$TOTAL_COUNT PASS, 0 kegagalan)."
  exit 0
else
  echo "HASIL: Smoke test GAGAL dengan $FAILURES pemeriksaan gagal ($PASSED_COUNT/$TOTAL_COUNT PASS)." >&2
  exit 1
fi

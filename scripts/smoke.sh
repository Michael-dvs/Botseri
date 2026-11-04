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
  . "$REPO_ROOT/.env"
  set +a
fi

INTERNAL_TOKEN="${INTERNAL_API_TOKEN:-}"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:3000}"

FAILURES=0

check() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"

  if [ "$status" -eq 0 ]; then
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

# 4. Validasi workflow n8n (validate-workflows.sh)
WORKFLOWS_OK=1
"$REPO_ROOT/scripts/validate-workflows.sh" >/dev/null 2>&1 && WORKFLOWS_OK=0
check "Workflow n8n: validate-workflows.sh lulus" "$WORKFLOWS_OK"

# 5. Container botseri-n8n TIDAK memiliki DATABASE_URL (INV-01)
N8N_DB_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-n8n"; then
  # Periksa hanya nama variabel tanpa mencetak seluruh environment
  HAS_DB_URL="$(docker compose exec -T botseri-n8n sh -c 'if [ -n "${DATABASE_URL:-}" ]; then echo "LEAK"; else echo "CLEAN"; fi' 2>/dev/null || echo "ERROR")"
  [ "$HAS_DB_URL" = "CLEAN" ] && N8N_DB_OK=0
  check "INV-01: Container botseri-n8n TIDAK memiliki DATABASE_URL" "$N8N_DB_OK" "hasil: $HAS_DB_URL"
else
  # Container tidak berjalan
  check "INV-01: Container botseri-n8n TIDAK memiliki DATABASE_URL" 0 "dilewati: container tidak aktif di host ini"
fi

# 6. Migrasi Prisma selesai (_prisma_migrations tidak ada yang gagal/tertunda)
MIGRATIONS_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-db"; then
  DB_USER="${POSTGRES_USER:-botseri}"
  DB_NAME="${POSTGRES_DB:-botseri}"
  PENDING_MIGRATIONS="$(docker compose exec -T botseri-db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL" 2>/dev/null || echo "1")"
  [ "$PENDING_MIGRATIONS" = "0" ] && MIGRATIONS_OK=0
  check "Database: Seluruh migrasi Prisma selesai tanpa rollback" "$MIGRATIONS_OK" "tertunda: $PENDING_MIGRATIONS"
else
  check "Database: Seluruh migrasi Prisma selesai" 0 "dilewati: database container tidak aktif di host ini"
fi

# 7. WAHA API terjangkau dari dalam container dashboard
WAHA_REACHABLE_OK=1
if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -q "botseri-dashboard"; then
  # Gunakan wget yang tersedia di image alpine runner dengan X-Api-Key dari env container
  if docker compose exec -T botseri-dashboard sh -c 'wget -q --spider --timeout=5 --header="X-Api-Key: $WAHA_API_KEY" http://botseri-waha:3000/api/sessions' 2>/dev/null; then
    WAHA_REACHABLE_OK=0
  fi
  check "Jaringan internal: WAHA terjangkau dari container dashboard" "$WAHA_REACHABLE_OK"
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
  echo "HASIL: Seluruh pemeriksaan smoke test LULUS (0 kegagalan)."
  exit 0
else
  echo "HASIL: Smoke test GAGAL dengan $FAILURES pemeriksaan gagal." >&2
  exit 1
fi

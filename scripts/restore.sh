#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Periksa prasyarat
command -v docker >/dev/null 2>&1 || { echo "Error: docker tidak ditemukan." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Error: docker compose tidak ditemukan." >&2; exit 1; }

# Parse argumen
NON_INTERACTIVE=0
DUMP_FILE=""

for arg in "$@"; do
  if [ "$arg" = "--yes" ]; then
    NON_INTERACTIVE=1
  elif [ -z "$DUMP_FILE" ]; then
    DUMP_FILE="$arg"
  fi
done

if [ -z "$DUMP_FILE" ]; then
  echo "Penggunaan: $0 [--yes] <path-to-dump-file>" >&2
  echo "Contoh: $0 backups/botseri-20261027-120000.dump" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ] || [ ! -r "$DUMP_FILE" ]; then
  echo "Error: file dump '$DUMP_FILE' tidak ditemukan atau tidak dapat dibaca." >&2
  exit 1
fi

# Baca .env bila tersedia
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

DB_USER="${POSTGRES_USER:-botseri}"
DB_NAME="${POSTGRES_DB:-botseri}"
BACKUP_DIR="$REPO_ROOT/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Validasi isi dump sebelum melakukan tindakan destruktif
VALID=0
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$DUMP_FILE" >/dev/null 2>&1 && VALID=1
else
  docker compose exec -T botseri-db pg_restore --list < "$DUMP_FILE" >/dev/null 2>&1 && VALID=1
fi

if [ "$VALID" -ne 1 ]; then
  echo "Error: file dump '$DUMP_FILE' tidak valid atau rusak." >&2
  exit 1
fi

# Konfirmasi interaktif jika bukan mode --yes
if [ "$NON_INTERACTIVE" -ne 1 ]; then
  echo "PERINGATAN: Operasi ini akan MENIMPA database '$DB_NAME'."
  echo "File sumber: $DUMP_FILE"
  printf 'Ketik "restore" untuk melanjutkan: '
  read -r confirmation
  if [ "$confirmation" != "restore" ]; then
    echo "Operasi dibatalkan oleh pengguna." >&2
    exit 1
  fi
fi

# 1. Buat dump pengaman otomatis sebelum menimpa database
STAMP="$(date +%Y%m%d-%H%M%S)"
SAFETY_DUMP="$BACKUP_DIR/pre-restore-${STAMP}.dump"

echo "Membuat dump pengaman ke '$SAFETY_DUMP'..."
if ! docker compose exec -T botseri-db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$SAFETY_DUMP"; then
  echo "Error: gagal membuat dump pengaman. Restore dibatalkan untuk mencegah kehilangan data." >&2
  rm -f "$SAFETY_DUMP"
  exit 1
fi
chmod 600 "$SAFETY_DUMP"
echo "Dump pengaman tersimpan."

# 2. Hentikan dashboard dan n8n (tetap jalankan botseri-db)
echo "Menghentikan botseri-dashboard dan botseri-n8n..."
docker compose stop botseri-dashboard botseri-n8n

# 3. Pulihkan database dari file dump
echo "Memulihkan database dari '$DUMP_FILE'..."
RESTORE_OUTPUT=""
RESTORE_CODE=0

RESTORE_OUTPUT="$(docker compose exec -T botseri-db pg_restore \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner < "$DUMP_FILE" 2>&1)" || RESTORE_CODE=$?

# pg_restore sering mengembalikan exit code non-zero untuk warning non-fatal (seperti DROP non-existent object).
# Periksa apakah ada error fatal sebenarnya.
if [ "$RESTORE_CODE" -ne 0 ]; then
  if echo "$RESTORE_OUTPUT" | grep -E -q "FATAL|could not connect|terminating connection"; then
    echo "Error fatal saat pg_restore:" >&2
    echo "$RESTORE_OUTPUT" >&2
    echo "" >&2
    echo "Pemulihan darurat dari dump pengaman:" >&2
    echo "  $0 --yes $SAFETY_DUMP" >&2
    exit 1
  else
    # Peringatan non-fatal diabaikan
    echo "Catatan: pg_restore selesai dengan peringatan non-fatal."
  fi
fi

# 4. Nyalakan kembali container dashboard dan n8n
echo "Menyalakan kembali botseri-dashboard dan botseri-n8n..."
docker compose start botseri-dashboard botseri-n8n

# 5. Tunggu dashboard sehat (maksimal 60 detik)
echo "Menunggu kesiapan container dashboard..."
ATTEMPTS=0
MAX_ATTEMPTS=12
DASHBOARD_READY=0

while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 5
  if docker compose exec -T botseri-dashboard wget -qO- http://127.0.0.1:3000/api/internal/health 2>/dev/null | grep -q '"status":"ok"'; then
    DASHBOARD_READY=1
    break
  fi
done

if [ "$DASHBOARD_READY" -eq 1 ]; then
  echo "Dashboard siap dan sehat."
else
  echo "Peringatan: dashboard belum merespons dalam 60 detik. Periksa log container." >&2
fi

echo ""
echo "Restore berhasil diselesaikan."
echo "Langkah verifikasi:"
echo "  1. Periksa halaman /status di browser."
echo "  2. Jalankan: ./scripts/smoke.sh"
echo "Dump pengaman tersedia di: $SAFETY_DUMP"

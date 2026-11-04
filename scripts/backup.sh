#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Periksa prasyarat
command -v docker >/dev/null 2>&1 || { echo "Error: docker tidak ditemukan." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Error: docker compose tidak ditemukan." >&2; exit 1; }

# Baca .env bila tersedia
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

BACKUP_DIR="$REPO_ROOT/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
DB_USER="${POSTGRES_USER:-botseri}"
DB_NAME="${POSTGRES_DB:-botseri}"
TMP_DUMP="$BACKUP_DIR/tmp-${STAMP}.dump"
FINAL_DUMP="$BACKUP_DIR/botseri-${STAMP}.dump"
WAHA_TAR="$BACKUP_DIR/waha-${STAMP}.tar.gz"

echo "Memulai backup Botseri [${STAMP}]..."

# 1. Dump Database ke file sementara
docker compose exec -T botseri-db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$TMP_DUMP"

# Validasi dump: ukuran > 0 dan lolos pemeriksaan pg_restore
if [ ! -s "$TMP_DUMP" ]; then
  echo "Error: file dump database kosong." >&2
  rm -f "$TMP_DUMP"
  exit 1
fi

VALID=0
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$TMP_DUMP" >/dev/null 2>&1 && VALID=1
else
  docker compose exec -T botseri-db pg_restore --list < "$TMP_DUMP" >/dev/null 2>&1 && VALID=1
fi

if [ "$VALID" -ne 1 ]; then
  echo "Error: dump database tidak valid atau rusak." >&2
  rm -f "$TMP_DUMP"
  exit 1
fi

mv "$TMP_DUMP" "$FINAL_DUMP"
chmod 600 "$FINAL_DUMP"

# 2. Backup volume sesi WAHA (botseri_wahadata)
# Menggunakan container alpine sementara membaca volume secara read-only
docker run --rm \
  -v botseri_wahadata:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/waha-${STAMP}.tar.gz" -C /data .

# Validasi arsip WAHA
if [ ! -s "$WAHA_TAR" ] || ! tar -tzf "$WAHA_TAR" >/dev/null 2>&1; then
  echo "Error: arsip sesi WAHA tidak valid atau rusak." >&2
  rm -f "$WAHA_TAR"
  exit 1
fi

chmod 600 "$WAHA_TAR"

# 3. Rotasi retensi: simpan 7 salinan terbaru per jenis secara terpisah
# Pola ini aman: tidak menyentuh pre-restore-* atau file lain
find "$BACKUP_DIR" -maxdepth 1 -name "botseri-*.dump" -type f | sort -r | tail -n +8 | while read -r old_file; do
  rm -f "$old_file"
done

find "$BACKUP_DIR" -maxdepth 1 -name "waha-*.tar.gz" -type f | sort -r | tail -n +8 | while read -r old_file; do
  rm -f "$old_file"
done

# Ringkasan hasil
DUMP_SIZE="$(ls -lh "$FINAL_DUMP" | awk '{print $5}')"
WAHA_SIZE="$(ls -lh "$WAHA_TAR" | awk '{print $5}')"

echo "Backup berhasil diselesaikan."
echo "  Database: backups/botseri-${STAMP}.dump (${DUMP_SIZE})"
echo "  Sesi WAHA: backups/waha-${STAMP}.tar.gz (${WAHA_SIZE})"

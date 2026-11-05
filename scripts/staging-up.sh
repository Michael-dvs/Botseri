#!/usr/bin/env bash
# Otomasi lingkungan staging Botseri (S13 §2)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Memulai Lingkungan Staging Botseri ==="

# 1. Pastikan Docker tersedia
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker tidak ditemukan." >&2
  exit 1
fi

# 2. Jalankan docker compose staging
echo "[1/4] Menyalakan container staging..."
docker compose -f docker-compose.staging.yml up -d

# 3. Tunggu database staging siap
echo "[2/4] Menunggu database staging siap..."
for i in {1..30}; do
  if docker compose -f docker-compose.staging.yml ps botseri-staging-db | grep -q "healthy"; then
    echo "Database staging siap."
    break
  fi
  sleep 1
done

# 4. Jalankan migrasi Prisma ke database staging
echo "[3/4] Menerapkan migrasi database staging..."
docker compose -f docker-compose.staging.yml exec -T botseri-staging-dashboard npx prisma migrate deploy

# 5. Jalankan seeding data uji staging
echo "[4/4] Menginisialisasi data uji terisolasi (staging-seed)..."
docker compose -f docker-compose.staging.yml exec -T botseri-staging-dashboard npx tsx scripts/staging-seed.ts

echo ""
echo "=== Lingkungan Staging Berhasil Aktif ==="
echo "Dashboard Staging: http://127.0.0.1:3001"
echo "WAHA Mock Staging: http://127.0.0.1:3002"
echo "Database Staging : localhost:5433 (db: botseri_staging)"

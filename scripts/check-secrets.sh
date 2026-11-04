#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Pola rahasia yang dideteksi:
# 1. API key gaya OpenAI (sk-...)
# 2. Google API key (AIzaSy...)
# 3. Private key PEM (BEGIN ... KEY)
# 4. Literal ENCRYPTION_KEY dengan nilai panjang >= 20
PATTERN='sk-[A-Za-z0-9_-]{12,}|AIzaSy[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH |PRIVATE )?KEY|ENCRYPTION_KEY=[A-Za-z0-9+/=]{20,}'

# Ambil daftar berkas yang dipindai (berkas terlacak dan berkas baru yang tidak di-ignore)
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  FILES=$(git ls-files -c -o --exclude-standard)
else
  FILES=$(find . -type f \
    -not -path '*/.*' \
    -not -path './node_modules/*' \
    -not -path '*/node_modules/*' \
    -not -path './dashboard/.next/*' \
    -not -path '*/.next/*' \
    -not -path './backups/*' \
    | sed 's|^\./||')
fi

FOUND=0

# Pindai setiap berkas kecuali skrip pemeriksa itu sendiri dan unit test
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue
  [ "$file" = "scripts/check-secrets.sh" ] && continue
  [ "$file" = "dashboard/tests/unit/check-secrets.test.ts" ] && continue

  matches=$(grep -nE "$PATTERN" "$file" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS= read -r line_match; do
      [ -z "$line_match" ] && continue
      line_num="${line_match%%:*}"
      echo "[PERINGATAN] Potensi rahasia terdeteksi di: ${file}:${line_num} (nilai disamarkan demi keamanan)" >&2
      FOUND=$((FOUND + 1))
    done <<< "$matches"
  fi
done <<< "$FILES"

if [ "$FOUND" -gt 0 ]; then
  echo "Pemeriksaan rahasia GAGAL: ditemukan $FOUND potensi kebocoran rahasia." >&2
  exit 1
fi

echo "Pemeriksaan rahasia BERHASIL: tidak ditemukan rahasia terekspos di pohon kerja."
exit 0

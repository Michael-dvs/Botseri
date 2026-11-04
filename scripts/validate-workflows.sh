#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Periksa prasyarat
command -v jq >/dev/null 2>&1 || { echo "Error: jq tidak ditemukan." >&2; exit 1; }

WORKFLOWS_DIR="${1:-$REPO_ROOT/n8n-engine/workflows}"

if [ ! -d "$WORKFLOWS_DIR" ]; then
  echo "Error: direktori workflow '$WORKFLOWS_DIR' tidak ditemukan." >&2
  exit 1
fi

FAILURES=0

log_violation() {
  local file="$1"
  local rule="$2"
  local detail="$3"
  echo "${file}: ${rule}: ${detail}" >&2
  FAILURES=$((FAILURES + 1))
}

# Temukan semua file JSON di direktori
FILES=()
while IFS= read -r f; do
  [ -f "$f" ] && FILES+=("$f")
done < <(find "$WORKFLOWS_DIR" -maxdepth 1 -name "*.json" | sort)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Tidak ada file workflow JSON di $WORKFLOWS_DIR"
  exit 0
fi

for file in "${FILES[@]}"; do
  rel_file="${file#"$REPO_ROOT"/}"

  # 1. Validitas JSON
  if ! jq empty "$file" >/dev/null 2>&1; then
    log_violation "$rel_file" "JSON_INVALID" "sintaks JSON rusak"
    continue
  fi

  # 2. Workflow id dan name
  wf_id="$(jq -r '.id // empty' "$file")"
  wf_name="$(jq -r '.name // empty' "$file")"
  if [ -z "$wf_id" ]; then
    log_violation "$rel_file" "WORKFLOW_ID_MISSING" "field 'id' tingkat atas wajib ada dan tidak kosong"
  fi
  if [ -z "$wf_name" ]; then
    log_violation "$rel_file" "WORKFLOW_NAME_MISSING" "field 'name' tingkat atas wajib ada dan tidak kosong"
  fi

  # 3. Setiap node wajib punya id, name, dan type
  bad_nodes="$(jq -r '.nodes[]? | select(.id == null or .name == null or .type == null or .id == "" or .name == "" or .type == "") | "\(.id // "null"): \(.name // "null")"' "$file")"
  if [ -n "$bad_nodes" ]; then
    log_violation "$rel_file" "NODE_PROPERTIES_MISSING" "node berikut tidak memiliki id/name/type yang lengkap: $bad_nodes"
  fi

  # 4. INV-01: Tidak boleh ada node database
  # Daftar database: postgres, mysql, mongo, mariadb, mssql, oracle, redis, supabase, elasticsearch, cassandra
  db_nodes="$(jq -r '.nodes[]?.type // empty' "$file" | grep -iE 'postgres|mysql|mongo|mariadb|mssql|oracle|redis|supabase|elasticsearch|cassandra' || true)"
  if [ -n "$db_nodes" ]; then
    log_violation "$rel_file" "INV-01" "dilarang memiliki node database: $(echo "$db_nodes" | tr '\n' ' ')"
  fi

  # INV-01: Tidak boleh ada referensi DATABASE_URL di mana pun
  if grep -i -q "DATABASE_URL" "$file"; then
    log_violation "$rel_file" "INV-01" "ditemukan referensi 'DATABASE_URL' di dalam file workflow"
  fi

  # 5. INV-02: Tidak boleh ada secret polos
  # Token sk- (OpenAI style)
  if grep -E -q 'sk-[A-Za-z0-9_-]{20,}' "$file"; then
    log_violation "$rel_file" "INV-02" "ditemukan token pola sk-... (potensi kebocoran secret API key)"
  fi

  # Bearer token literal (bukan ekspresi n8n {{ ... }})
  if grep -E -q 'Bearer [A-Za-z0-9+/=_-]{20,}' "$file"; then
    log_violation "$rel_file" "INV-02" "ditemukan literal Bearer token (potensi kebocoran secret Authorization header)"
  fi
done

if [ "$FAILURES" -gt 0 ]; then
  echo "Validasi workflow gagal: ditemukan $FAILURES pelanggaran." >&2
  exit 1
fi

echo "Semua workflow n8n valid (${#FILES[@]} file diperiksa)."
exit 0

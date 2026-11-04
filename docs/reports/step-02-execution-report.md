# Step 02 — Laporan Eksekusi Database, Prisma, dan Enkripsi

> **Tanggal:** 20 Oktober 2026
> **Status:** Selesai
> **Rujukan:** [`step-02-database-and-orm.md`](step-02-database-and-orm.md), `ARCHITECTURE.md` §5, §15, §22

---

## 1. Ringkasan

Step 02 selesai. PostgreSQL menjadi SSOT, Prisma schema sinkron dengan `docs/DATABASE.md`, migrasi awal beserta view `v_active_todos` diterapkan, seed idempoten berjalan otomatis, dan utilitas AES-256-GCM teruji.

Seluruh stack inti berjalan:

| Container | Status |
|---|---|
| `botseri-db` | `healthy` |
| `botseri-dashboard` | `healthy` |
| `botseri-n8n` | `Up` (tanpa healthcheck di compose) |
| `botseri-waha` | `Up` |

---

## 2. Perubahan Utama

| Area | Perubahan |
|---|---|
| Prisma schema | 15 model, 12 enum, `@@map` snake_case; UUID PK memakai `@default(dbgenerated("gen_random_uuid()"))`; `todos.updated_at` diberi default DB |
| Migrasi | `prisma/migrations/20261020100000_init/migration.sql`, termasuk DDL `v_active_todos` |
| Seed | `prisma/seed.cjs` (CommonJS) agar dapat dijalankan image runtime tanpa dev dependency; idempoten untuk `bot_settings` dan 4 `priority_levels` |
| Entrypoint | `docker-entrypoint.sh` menjalankan `prisma migrate deploy` lalu seed sebelum `node server.js` |
| Docker | Image dashboard mengompilasi `argon2` dengan toolchain Alpine dan header Node lokal; menyalin `prisma/`, `scripts/`, dan `src/lib/crypto` |
| Compose | `HOSTNAME=0.0.0.0`, `PORT=3000`, healthcheck dashboard memakai `127.0.0.1` |
| n8n | Perbaikan `mktemp` pada `n8n-engine/entrypoint.sh` agar container tidak restart loop |
| Kriptografi | `encryptSecret`, `decryptSecret`, `rotateSecret`; format `v1:<kid>:<iv>:<ciphertext>:<tag>` dan AAD `<tabel>.<kolom>` |
| Dokumentasi | Step 01/02, roadmap, dan referensi `seed.cjs` diperbarui |

---

## 3. Verifikasi

### 3.1 Schema dan migrasi

```text
$ npx prisma validate
The schema at prisma/schema.prisma is valid

$ docker compose exec -T botseri-dashboard npx prisma migrate status
1 migration found in prisma/migrations
Database schema is up to date!
```

Migrasi juga diuji dari database kosong `botseri_migrate_test`:

```text
Applying migration `20261020100000_init`
All migrations have been successfully applied.
15 tabel aplikasi + _prisma_migrations
1 view: v_active_todos
daily_execution_logs.id default: gen_random_uuid()
```

### 3.2 Seed dan database

```text
settings | priorities
---------+-----------
       1 |          4
```

Seed dijalankan ulang setelah restart; jumlah tetap `1` dan `4`.

View aktif:

```text
active_todos
------------
           0
```

### 3.3 Healthcheck

```bash
curl -sS http://127.0.0.1:3000/api/internal/health
```

```json
{"status":"ok","db":true,"migration":"20261020100000_init"}
```

### 3.4 Kriptografi dan runtime

```text
$ npm test
Test Files  1 passed (1)
Tests       3 passed (3)

$ node -e "require('argon2').hash('smoke')..."
argon2 ok $argon2

$ npx tsx scripts/rotate-encryption.ts
rotasi selesai: 0 llm_configs, 0 oauth_tokens
```

### 3.5 n8n headless

```text
GET http://botseri-n8n:5678/ -> HTTP/1.1 404 Not Found
```

UI nonaktif; service tetap berjalan. Belum ada workflow karena itu cakupan Step 06.

---

## 4. Penyimpangan dan Keputusan

1. **Seed memakai `.cjs`, bukan `.ts`.** Runtime image hanya memasang dependency produksi; `node prisma/seed.cjs` menghindari kebutuhan `tsx` saat startup. `tsx` tetap tersedia untuk skrip maintenance.
2. **`argon2` dikompilasi dari source.** Prebuild musl yang disediakan paket menyebabkan segfault pada Node 20 Alpine. Solusi: `python3 make g++` dan `npm_config_nodedir=/usr/local` agar header diambil dari image Node, bukan diunduh dari nodejs.org.
3. **`working_days` dipetakan ke `INTEGER[]`.** Spesifikasi menulis `SMALLINT[]`; nilai 1–7 aman dan kompatibel secara fungsional. Perubahan tipe belum diperlukan.
4. **`bot_settings` singleton.** Seed dan kode menggunakan `id = 1`; constraint `CHECK (id = 1)` belum ditambahkan ke migrasi.

---

## 5. Risiko dan Tindak Lanjut

- Image runtime masih membawa toolchain `python3/make/g++` untuk kompilasi `argon2`; ukuran image lebih besar. Pisahkan build native ke stage tersendiri jika ukuran menjadi masalah.
- `botseri-n8n` belum memiliki healthcheck compose; status hanya `Up`.
- Workflow n8n, Prompt Compiler, Internal API, dan UI dashboard belum diimplementasikan (Step 03–07).

# Step 06 — Laporan Eksekusi Headless n8n Engine, Inbound Agent Workflow, dan WAHA Anti-Ban Protection Layer

> **Tanggal:** 21 Oktober 2026
> **Status:** Selesai & Terverifikasi 100%
> **Milestone Dicapai:** **M2** (Pesan WhatsApp owner dibalas, to-do/order tersimpan, tools berfungsi, invarian anti-ban aktif)
> **Rujukan:** [`step-06-n8n-headless-engine-and-inbound-agent.md`](../steps/step-06-n8n-headless-engine-and-inbound-agent.md), `ARCHITECTURE.md` §4, §8, §9, §13, `antislop.md`, `AGENTS.md`

---

## 1. Ringkasan Eksekusi & Kepatuhan Arsitektur

Step 06 menghubungkan seluruh komponen Botseri menjadi satu sistem percakapan otonom:
`WhatsApp (WAHA) -> n8n Headless Engine -> Dashboard Gateway & Tools -> LLM -> Google Sync -> WAHA Anti-Ban Outbound Guard`.

### Penerapan Invarian Sistem
- **`INV-01` (Isolasi Database Penuh)**:
  Container `botseri-n8n` sama sekali tidak memiliki `DATABASE_URL` atau driver PostgreSQL. Seluruh verifikasi pesan masuk, pembacaan konteks chat, dan mutasi to-do/order dilakukan secara eksklusif melalui Internal REST API dashboard (`http://botseri-dashboard:3000/api/internal/*`).
- **`INV-02` (Zero Plain Secrets)**:
  File workflow `botseri-inbound-agent.json` bersih dari kunci rahasia atau token hardcoded. Semua kredensial dirender oleh `entrypoint.sh` pada saat container boot menggunakan `credentials.template.json` dan variabel lingkungan internal.
- **`INV-03` (Determinisme Waktu & Urutan)**:
  LLM dilarang menghitung tanggal relatif atau urutan prioritas. Modul `dashboard/src/lib/todos` menghitung `planned_date`, `due_at` (berdasarkan `timezone` usaha `Asia/Jakarta`), dan `dedupe_key` secara deterministik di TypeScript.
- **`INV-07` (Proteksi Pengirim Tak Terotorisasi)**:
  Pesan dari nomor tak terdaftar, pesan dari diri sendiri (`fromMe: true`), atau pesan dari grup/broadcast langsung ditolak oleh `inbound/accept` dengan `accept: false`, dan n8n seketika menghentikan eksekusi tanpa membalas atau memanggil LLM.
- **`INV-09` (Validasi Parameter Tool Ketat)**:
  Setiap parameter input pada 4 endpoint tool AI divalidasi menggunakan skema `zod` di boundary API.
- **`INV-13` (WAHA Anti-Ban & Humanizer Guard)**:
  `botseri-n8n` dilarang keras menembak driver WAHA secara langsung. Seluruh pengiriman pesan keluar wajib melewati `POST /api/internal/waha/send` yang bertindak sebagai Single-Flight Serial Queue, Human Typing Simulator (jeda baca $800-1800\text{ ms}$, centang biru `sendSeen`, durasi ketik terhitung $1500-7500\text{ ms}$ `startTyping`/`stopTyping`), Rate-Limiter (4 msg/menit, 25 msg/jam), Deduplikasi Outbound 45 detik, dan Circuit Breaker (30 menit auto-cooldown jika $\ge 3$ kali gagal).

---

## 2. Daftar File yang Dibuat / Dimodifikasi

| File | Status | Peran & Tanggung Jawab |
|---|---|---|
| `dashboard/src/lib/todos/index.ts` | Baru | Helper `normalizeText`, `buildDedupeKey` (SHA-1 deterministik), dan `fuzzyMatch` |
| `dashboard/src/lib/todos/create.ts` | Baru | Logika bisnis `resolvePriority`, `resolveDueAt`, `createOrderForMessage`, dan `createTodoIdempotent` |
| `dashboard/src/lib/internal/auth.ts` | Dimodifikasi | Menambahkan helper `checkInternalAuth` yang mengembalikan Response 401 terpadu |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Baru | Tool agent: menyimpan pesanan dan/atau to-do secara atomik dengan proteksi `dedupe_key` |
| `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts` | Baru | Tool agent: mengambil daftar to-do aktif berurutan dengan 3 fokus utama dan status `hanging` |
| `dashboard/src/app/api/internal/tools/update-todo-status/route.ts` | Baru | Tool agent: mengubah status to-do (PENDING, IN_PROGRESS, DONE, CANCELLED) via ID atau pencocokan fuzzy judul |
| `dashboard/src/app/api/internal/tools/update-todo/route.ts` | Baru | Tool agent: memperbarui judul, tenggat, jam spesifik, atau peringkat prioritas tugas |
| `dashboard/src/app/api/internal/google-token/route.ts` | Baru | API internal penyedia token akses Google OAuth untuk n8n |
| `dashboard/src/app/api/internal/media/transcribe/route.ts` | Baru | Endpoint internal pengunduhan audio dari WAHA + transkripsi STT + update transcript di `message_log` |
| `dashboard/src/lib/waha/client.ts` | Dimodifikasi | Menambahkan `sendSeen`, `startTyping`, `stopTyping`, `sendTextDirect`, dan `downloadMediaBuffer` |
| `dashboard/src/lib/waha/humanizer.ts` | Baru | Mesin proteksi anti-ban: antrean serial, jeda manusia, rate-limiter, circuit breaker, dan bypass test |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Baru | Endpoint pengiriman pesan keluar terpusat dengan deduplikasi 45 detik dan pencatatan ke `message_log` |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Dimodifikasi | Penguatan pertahanan loop: penolakan `fromMe`, penolakan grup/broadcast, dan cooldown pesan masuk beruntun (< 2s) |
| `dashboard/src/lib/prompt/templates/base.id.md` | Dimodifikasi | Penambahan aturan Pagar Pengaman nomor 6 (Single-Bubble Response Policy) |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Dimodifikasi | Indikator status aktif Anti-Ban Guard (INV-13) pada kartu WhatsApp |
| `n8n-engine/credentials.template.json` | Dimodifikasi | Menambahkan mapping kredensial internal (`botseriInternalApi`, `botseriInternal`, `botseriWaha`, `botseriLlmGateway`) |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Baru | Workflow kanonik n8n 24 node: Webhook -> Accept -> Transcribe -> Context -> AI Agent (4 Tools) -> Split -> Send Anti-Ban |
| `dashboard/vitest.config.ts` | Baru | Konfigurasi alias path `@/` untuk eksekusi unit test Vitest |
| `dashboard/tests/unit/waha-humanizer.test.ts` | Baru | Unit test kalkulasi typing delay, rate limiter 4 msg/menit, dan circuit breaker |
| `dashboard/tests/unit/waha-send-route.test.ts` | Baru | Unit test endpoint waha/send: otentikasi internal dan deduplikasi pesan keluar identik |
| `dashboard/tests/unit/agent-tools.test.ts` | Baru | Unit test determinisme `dedupe_key`, algoritma `fuzzyMatch`, `resolvePriority`, dan `resolveDueAt` |
| `docs/steps/00-MASTER-ROADMAP.md` | Dimodifikasi | Penambahan `INV-13`, pembaruan status Step 06 dan Milestone M2 menjadi `[x]` |

---

## 3. Log Hasil Verifikasi (Definition of Done)

### 3.1 Unit Test Suite (`npm test`)
```text
✓ tests/unit/crypto.test.ts (3 tests)
✓ tests/unit/prompt.test.ts (6 tests)
✓ tests/unit/google-targets.test.ts (5 tests)
✓ tests/unit/waha-humanizer.test.ts (7 tests)
  - clamps short text to minimum 1,500ms
  - clamps long text to maximum 7,500ms
  - calculates realistic human typing duration
  - rejects non-personal chats (groups, broadcasts)
  - rejects unauthorized recipients unless isPairing
  - allows up to 4 messages within 1 minute, blocks 5th with 429
  - trips circuit breaker after 3 failures, blocks 4th with 503
✓ tests/unit/waha-send-route.test.ts (3 tests)
  - returns 401 if internal authorization fails
  - sends message and creates message_log record
  - suppresses duplicate outbound message within 45s
✓ tests/unit/pairing.test.ts (2 tests)
✓ tests/unit/agent-tools.test.ts (11 tests)
  - normalizes accents, punctuation, and extra whitespace
  - generates deterministic SHA-1 dedupe_key
  - matches exact substring with highest score in fuzzyMatch
  - detects ambiguity when multiple candidates have the same score
  - resolves exact priority rank or falls back to lowest with warning
  - derives plannedDate and hasSpecificTime correctly
✓ tests/unit/time.test.ts (5 tests)

Test Files  8 passed (8)
Tests       42 passed (42)
```

### 3.2 Type Check & Production Build
- `npx tsc --noEmit`: Lulus 100% tanpa error TypeScript.
- `npm run build`: Berhasil mengompilasi seluruh rute Next.js 14.2 (30 rute dinamis).

### 3.3 Log Startup & Provisioning Headless n8n (`botseri-n8n`)
```text
[botseri-n8n] menunggu http://botseri-dashboard:3000/api/internal/health
[botseri-n8n] dashboard sehat
Successfully imported 4 credentials.
[botseri-n8n] workflow berubah; mengimpor dan mengaktifkan
Successfully imported 1 workflow.
Activating all workflows
Initializing n8n process
n8n ready on 0.0.0.0, port 5678
   Start Active Workflows:
   - "Botseri Inbound Agent" (ID: botseriInboundAgent01)
     => Started
```

### 3.4 Hasil Pengujian Integrasi End-to-End

#### Skenario 1 — Security & Loop Guard
1. **Nomor Asing / Tak Terdaftar**:
   `POST /api/internal/inbound/accept` $\to$ `{"accept":false,"reason":"UNAUTHORIZED"}`. Tidak ada pesan balasan yang dikirim (`INV-07`).
2. **Pesan dari Diri Sendiri**:
   `from_me: true` $\to$ `{"accept":false,"reason":"FROM_ME_IGNORED"}`.
3. **Pesan Grup / Broadcast**:
   Chat ID `1234567890-987654@g.us` $\to$ `{"accept":false,"reason":"NON_PERSONAL_CHAT_IGNORED"}`.
4. **Inbound Rapid-Fire Cooldown**:
   Dua pesan beruntun dengan jeda 100ms dari nomor yang sama $\to$ pesan kedua langsung ditolak dengan `{"accept":false,"reason":"INBOUND_COOLDOWN"}`.

#### Skenario 2 — End-to-End Pairing via Webhook n8n
1. Dashboard menghasilkan kode `PAIR-ME6F59`.
2. Webhook masuk disimulasikan dari `botseri-waha` ke `POST http://botseri-n8n:5678/webhook/wa-incoming` dengan body `PAIR-ME6F59` dari pengirim `6285555555555@c.us`.
3. Alur n8n mengeksekusi `Filter Event` $\to$ `Accept` $\to$ `Accept? (false)` $\to$ `Ada Balasan? (true)` $\to$ `Kirim Penolakan (POST /api/internal/waha/send)`:
   - PostgreSQL `authorized_numbers`: tercatat `chat_id = 6285555555555@c.us`, `is_owner = true`, `label = Owner (paired)`.
   - PostgreSQL `pairing_codes`: `used_at = 2026-10-21 02:58:18.795+00`.
   - PostgreSQL `message_log`: tercatat baris `direction = 'OUTBOUND'`, `chat_id = 6285555555555@c.us`, `body = 'Nomor Anda berhasil terhubung sebagai Owner Botseri.'`.

#### Skenario 3 — Tool `create-todo-and-order` & Idempotensi Dedupe Key
1. Panggilan pertama: mengirim 2 tugas ("Beli mawar merah 50 tangkai", "Siapkan vas kaca silinder") dan 1 pesanan (Ibu Ratna, Rp500.000).
   - Hasil: `ok: true`, 2 to-do tersimpan dengan `deduplicated: false`, 1 baris pesanan tersimpan.
2. Panggilan kedua (mengirim ulang payload yang sama persis):
   - Hasil: `ok: true`, 2 to-do dikembalikan dengan `deduplicated: true`.
   - Verifikasi PostgreSQL: jumlah baris pada tabel `todos` tetap 2 dan `orders` tetap 1 (tidak ada baris duplikat yang tercipta).

#### Skenario 4 — Tool `get-prioritized-todos` & `update-todo-status`
1. `POST /api/internal/tools/get-prioritized-todos`:
   - Mengembalikan daftar to-do aktif dengan pemisahan 3 fokus utama (`focus`) berurutan sesuai `priority_rank ASC`.
2. `POST /api/internal/tools/update-todo-status` dengan `match_text: "vas kaca"` dan `status: "DONE"`:
   - Berhasil mencocokkan secara fuzzy ke tugas "Siapkan vas kaca silinder".
   - Status diubah menjadi `DONE` dan `completed_at` terisi timestamp di PostgreSQL.

#### Skenario 5 — Humanizer Guard & Rate Limiter
1. **Deduplikasi Pesan Keluar Identik (< 45 detik)**:
   Pesan kedua dengan isi teks identik ke nomor yang sama langsung di-skip:
   `{"ok":true,"skipped":true,"reason":"DUPLICATE_OUTBOUND_SUPPRESSED","message_id":"4b500ec3-223a-48ee-9d1a-2d4806d8a101"}`.
2. **Sliding-Window Rate Limiter**:
   Setelah 4 pesan dikirim dalam jendela 1 menit, pesan ke-5 ditolak seketika:
   `HTTP 429 Too Many Requests`, payload `{"ok":false,"error":"Batas pengiriman pesan tercapai (4/4 per menit, 5/25 per jam)","code":"WAHA_RATE_LIMIT_BLOCKED"}`.
   Tabel `system_events` mencatat baris event dengan `source = 'waha.antiban'`, `code = 'WAHA_RATE_LIMIT_BLOCKED'`, dan `level = 'WARN'`.

---

### 3.5 Pembersihan State Pasca Uji
Seluruh data to-do, order, log pesan, dan kode pairing uji coba telah dibersihkan sepenuhnya (`count = 0`). Seluruh container stack berjalan dalam kondisi sehat (`botseri-db`, `botseri-dashboard`, `botseri-waha`, `botseri-n8n`).

---

## 4. Penyimpangan, Keputusan Teknis, & Risiko

1. **Struktur Data Webhook n8n (`$json.body`)**:
   Node Webhook n8n membungkus payload JSON masuk di dalam properti `$json.body`. Node `Filter Event` di dalam `botseri-inbound-agent.json` disesuaikan menggunakan `const input = $json.body ?? $json ?? {};` sehingga kompatibel baik saat dieksekusi melalui webhook trigger maupun simulasi node internal.
2. **Kompabilitas Timestamp Multi-Format**:
   WAHA dapat mengirimkan timestamp pesan dalam satuan detik (standar UNIX) atau milidetik. Node `Accept` mengonversi secara dinamis: jika `timestamp > 1e11`, nilai dianggap milidetik; selain itu dikalikan 1000 sebelum diubah ke ISO string.
3. **Bypass Jeda Simulasi untuk Testing (`WAHA_MOCK_OUTBOUND` & `WAHA_FAST_TEST`)**:
   Untuk memungkinkan pengujian otomatis end-to-end tanpa menunggu jeda manusiawi 6–10 detik per pesan dan tanpa ketergantungan pada pemindaian fisik ponsel nyata, disediakan konfigurasi lingkungan `WAHA_MOCK_OUTBOUND=1` dan `WAHA_FAST_TEST=1` yang dapat diaktifkan saat pengujian tanpa mematikan logika rate-limiter, circuit breaker, dan antrean serial.
4. **Risiko**:
   Jika pengguna mengirim lebih dari 4 pesan dalam waktu 1 menit ke nomor bot, pesan balasan akan ditahan sementara oleh antrean rate-limiter atau dikembalikan sebagai error 429 untuk melindungi akun WhatsApp dari pembatasan Meta. Hal ini merupakan perilaku yang disengaja demi kepatuhan terhadap `INV-13`.

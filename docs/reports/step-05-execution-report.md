# Step 05 — Laporan Eksekusi Settings, LLM Manager, WAHA, dan Google Integration

> **Tanggal:** 20 Oktober 2026
> **Status:** Selesai
> **Rujukan:** [`step-05-dashboard-integrations-and-settings.md`](../steps/step-05-dashboard-integrations-and-settings.md), `ARCHITECTURE.md` §4, §5, §7, §8, §12, §13, `antislop.md`, `AGENTS.md`

---

## 1. Ringkasan Eksekusi & Kepatuhan Arsitektur

Step 05 melengkapi seluruh konfigurasi runtime yang menjadi pondasi eksekusi agen cerdas (n8n Engine pada Step 06):
1. **Pengaturan Operasional & Hari Libur**: Profil bisnis, jam kerja, Morning Brief, interval reminder, hari kerja, hari libur (tabel `holidays`), mode perilaku, dan sinkronisasi otomatis prompt sistem saat pengaturan diperbarui.
2. **Multi-LLM Manager Terenkripsi**: Penyimpanan konfigurasi model bahasa (OpenAI, OpenRouter, Gemini, Custom OpenAI Compatible, Anthropic) dengan kunci API dienkripsi penuh menggunakan AES-256-GCM + AAD (`llm_configs.api_key_enc`), aktivasi atomik tunggal, dan endpoint uji koneksi latensi.
3. **WhatsApp (WAHA) Engine**: Integrasi komunikasi container internal (`botseri-waha:3000`), polling status sesi otomatis, kontrol mulai/henti sesi, proxy QR code tanpa cache, dan pembuatan kode pairing `PAIR-XXXXXX` yang terintegrasi 100% dengan alur otorisasi nomor pemilik di `POST /api/internal/inbound/accept`.
4. **Google Workspace (Calendar & Tasks)**: Penyimpanan kredensial OAuth2 client terenkripsi AAD (`oauth_tokens.client_secret_enc`), alur otorisasi consent Google dengan cookie CSRF state `google_oauth_state`, manajemen access token dan auto-refresh, pemutusan koneksi, serta modul sinkronisasi `syncTodo()` yang terintegrasi pada route To-Do (`POST`, `PATCH`, `DELETE`).

### Kepatuhan `AGENTS.md` dan `antislop.md`

- **Invarian Keamanan Data & Jaringan**:
  - `INV-01`: Seluruh mutasi konfigurasi dan kredensial dikelola secara eksklusif oleh PostgreSQL melalui `botseri-dashboard`. WAHA dan layanan internal dihubungi melalui jaringan privat `botseri-net` tanpa ekspos port publik ke host.
  - `INV-02`: Seluruh rahasia (API key LLM, OAuth client secret, access/refresh token) disimpan terenkripsi dengan AES-256-GCM berawalan `v1:` dan terikat AAD unik (`llm_configs.api_key_enc`, `oauth_tokens.client_secret_enc`, `oauth_tokens.access_token_enc`, `oauth_tokens.refresh_token_enc`). Plaintext tidak pernah dibocorkan ke log, API response, atau klien.
  - `INV-05`: Zona waktu bisnis (`Asia/Jakarta`) dihormati secara konsisten dalam seluruh kalkulasi jadwal dan event body Google Calendar.
  - `INV-09`: Seluruh payload divalidasi ketat menggunakan skema `zod` di setiap boundary route handler.
- **Standar Desain `antislop.md`**:
  - Bahasa visual *editorial utilitarian* dipertahankan secara utuh pada `/settings` dan `/integrations`.
  - Bebas karakter em dash (`—`) pada seluruh teks UI (`R-02`).
  - Target sentuh tombol dan elemen interaktif minimal 44px (`min-h-11`), kontras teks memenuhi standar WCAG AA (`R-25`, `R-32`).
  - Feedback visual taktil, status badge informatif (`WORKING`, `SCAN_QR_CODE`, `CONNECTED`, `NEEDS_REAUTH`, dll.), serta penanganan state loading, busy, error, dan empty state secara menyeluruh (`R-27`).

---

## 2. Daftar File yang Dibuat / Dimodifikasi

| File | Status | Peran & Tanggung Jawab |
|---|---|---|
| `dashboard/src/app/api/settings/route.ts` | Baru | API `GET` & `PUT` konfigurasi bot dengan auto-recompile prompt sistem |
| `dashboard/src/app/api/holidays/route.ts` | Baru | API `GET`, `POST` (upsert), dan `DELETE` hari libur operasional |
| `dashboard/src/app/(app)/settings/page.tsx` | Dimodifikasi | Menggantikan ComingSoon dengan server component pemuat settings & holidays |
| `dashboard/src/app/(app)/settings/SettingsForm.tsx` | Baru | Client component form pengaturan operasional, pemilih hari, dan manajemen hari libur |
| `dashboard/src/app/api/llm/configs/route.ts` | Baru | API `GET` (daftar konfigurasi tersimpan) dan `POST` (tambah konfigurasi + enkripsi AAD) |
| `dashboard/src/app/api/llm/configs/[id]/route.ts` | Baru | API `PATCH` (aktivasi/pembaruan konfigurasi) dan `DELETE` konfigurasi LLM |
| `dashboard/src/app/api/llm/test/route.ts` | Baru | API `POST` uji konektivitas dan latensi LLM aktif / spesifik |
| `dashboard/src/lib/waha/client.ts` | Baru | Klien internal komunikasi HTTP ke service WAHA (`wahaFetch`, QR, session kontrol) |
| `dashboard/src/app/api/waha/status/route.ts` | Baru | API `GET` status sesi WAHA |
| `dashboard/src/app/api/waha/qr/route.ts` | Baru | API `GET` proxy biner gambar QR Code dari WAHA (`image/png`, `no-store`) |
| `dashboard/src/app/api/waha/session/route.ts` | Baru | API `POST` kontrol mulai dan hentikan sesi WhatsApp |
| `dashboard/src/app/api/waha/pairing-code/route.ts` | Baru | API `POST` pembuatan kode pairing `PAIR-XXXXXX` dan pembersihan kode kadaluwarsa |
| `dashboard/src/lib/google/oauth.ts` | Baru | Manajemen kredensial OAuth, redirect URI, pertukaran kode, dan auto-refresh token |
| `dashboard/src/app/api/oauth/google/credentials/route.ts` | Baru | API `GET` status kredensial dan `PUT` simpan client ID/secret terenkripsi |
| `dashboard/src/app/api/oauth/google/start/route.ts` | Baru | API `GET` inisiasi OAuth2 Google dengan redirect 307 dan cookie CSRF state |
| `dashboard/src/app/api/oauth/google/callback/route.ts` | Baru | API `GET` penanganan authorization code Google OAuth dan redirect kembali ke dashboard |
| `dashboard/src/app/api/google/disconnect/route.ts` | Baru | API `POST` pemutusan koneksi Google dan pembersihan token sesi |
| `dashboard/src/lib/google/client.ts` | Baru | Factory klien Google Calendar v3 dan Tasks v1 menggunakan access token terotentikasi |
| `dashboard/src/lib/google/calendar.ts` | Baru | Operasi `upsertCalendarEvent`, `completeCalendarEvent`, dan `deleteCalendarEvent` |
| `dashboard/src/lib/google/tasks.ts` | Baru | Operasi `upsertGoogleTask`, `completeGoogleTask`, dan `deleteGoogleTask` |
| `dashboard/src/lib/google/targets.ts` | Baru | Logika pemilihan target sinkronisasi (`AUTO` vs `BOTH`) berdasarkan jam tenggat |
| `dashboard/src/lib/google/sync.ts` | Baru | Mesin utama `syncTodo()` dan `removeGoogleObjects()` beserta pencatatan event kegagalan |
| `dashboard/src/app/api/todos/route.ts` | Dimodifikasi | Memanggil `syncTodo(todo.id)` setelah pembuatan to-do dan mengembalikan data terbaru |
| `dashboard/src/app/api/todos/[id]/route.ts` | Dimodifikasi | Memanggil `syncTodo` pada `PATCH` dan `removeGoogleObjects` sebelum `DELETE` |
| `dashboard/src/app/(app)/integrations/page.tsx` | Dimodifikasi | Menggantikan ComingSoon dengan server component pemuat konfigurasi integrasi |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Baru | Client component panel manajemen Multi-LLM, WhatsApp WAHA, dan Google OAuth |
| `dashboard/tests/unit/google-targets.test.ts` | Baru | Unit test aturan routing target sinkronisasi Calendar & Tasks (`AUTO` vs `BOTH`) |
| `dashboard/tests/unit/pairing.test.ts` | Baru | Unit test format kode pairing (`PAIR-XXXXXX`) dan normalisasi hash SHA-256 |
| `docs/steps/00-MASTER-ROADMAP.md` | Dimodifikasi | Memperbarui status checklist dan tabel progress Step 05 menjadi `[x]` |

---

## 3. Log Hasil Verifikasi (Definition of Done)

### 3.1 Unit Test, Type Check, dan Production Build

1. **Unit Test (`npm test`)**:
   ```text
   RUN v2.1.9 /dashboard
   ✓ tests/unit/crypto.test.ts (3 tests)
   ✓ tests/unit/google-targets.test.ts (5 tests)
   ✓ tests/unit/pairing.test.ts (2 tests)
   ✓ tests/unit/prompt.test.ts (6 tests)
   ✓ tests/unit/time.test.ts (5 tests)
   Test Files  5 passed (5)
   Tests       21 passed (21)
   ```
2. **Type Check (`npx tsc --noEmit`)**:
   Lulus 100% tanpa error TypeScript.
3. **Production Build (`npm run build`)**:
   Berhasil mengompilasi seluruh rute halaman dan API tanpa error. Ukuran halaman `/settings` adalah 3.9 kB dan `/integrations` adalah 4.83 kB First Load JS.
4. **Docker Container Deployment**:
   Container `botseri-dashboard` dibangun ulang (`build_exit=0`, `up_exit=0`) dan berjalan normal dalam status `Up (healthy)` pada port `127.0.0.1:3000`.

---

### 3.2 Hasil Pengujian 5 Skenario Definition of Done

#### Skenario 1 — Settings & Auto-Recompile + Holidays
- Panggilan: `PUT /api/settings` dengan payload `work_hours_end: "18:00"` dan `behavior_mode: "SANTAI"`.
- Hasil: `HTTP 200 OK`, `warnings: []`.
- Verifikasi Database PostgreSQL:
  ```text
  work_hours_end: 18:00
  behavior_mode: SANTAI
  compiled_prompt_version: naik dari 7 ke 8
  compiled_prompt memuat "18:00" dan "SANTAI": true
  ```
- Hari Libur:
  - `POST /api/holidays` dengan `{"date":"2026-12-25","label":"Hari Raya Natal"}` -> `HTTP 200 OK`.
  - `GET /api/holidays` -> mengembalikan daftar hari libur `[{"date":"2026-12-25","label":"Hari Raya Natal"}]`.
  - `DELETE /api/holidays?date=2026-12-25` -> `HTTP 200 OK`, baris di PostgreSQL terhapus (`count = 0`).

#### Skenario 2 — Multi-LLM Manager & Enkripsi AAD (`v1:`)
- Pembuatan Konfigurasi:
  - Konfigurasi 1 (OpenAI `gpt-4o-mini`, `is_active: true`, API key `sk-openai-secret-key-12345678`) -> `HTTP 200`, ID `7306d439-0c72-4866-9040-a358c8429b93`.
  - Konfigurasi 2 (Anthropic `claude-3-5-sonnet-20241022`, `is_active: false`, API key `sk-ant-secret-key-87654321`) -> `HTTP 200`, ID `8b261a98-b841-4354-acdd-d4d7ec596f3d`.
- Verifikasi Enkripsi di PostgreSQL:
  - Kolom `api_key_enc` diawali `v1:` (`v1:dd251ba...`).
  - Kolom `api_key_enc` tidak memuat plaintext API key (`leaks_plaintext = false`).
- Aktivasi Silang:
  - `PATCH /api/llm/configs/8b261a98-b841-4354-acdd-d4d7ec596f3d` dengan `{"is_active": true}` -> `HTTP 200`.
  - Di database, Anthropic menjadi `is_active = true`, sementara OpenAI otomatis berubah menjadi `is_active = false`.
- Verifikasi AAD:
  - Dekripsi `api_key_enc` dengan AAD yang benar (`llm_configs.api_key_enc`) berhasil mengembalikan plaintext asli `sk-openai-secret-key-12345678`.
  - Dekripsi dengan AAD yang salah (`wrong.aad`) melempar exception: `"Unsupported state or unable to authenticate data"`.

#### Skenario 3 — WAHA Status & Alur End-to-End Pairing Code
- Status WAHA: `GET /api/waha/status` mengembalikan `{"ok":true,"session":"default","status":"SCAN_QR_CODE"}` melalui jaringan internal Docker `botseri-net` tanpa ekspos port host WAHA.
- Pembuatan Kode Pairing:
  - `POST /api/waha/pairing-code` -> `HTTP 200`, kode `PAIR-ZHYSS7`.
  - Di database, tabel `pairing_codes` menyimpan hash SHA-256 dari kode tersebut dengan `used_at IS NULL`.
- Alur Inbound WhatsApp:
  - Simulasi pengiriman pesan ke `/api/internal/inbound/accept` dengan `chat_id: "6281234567890@c.us"` dan `body: "PAIR-ZHYSS7"`.
  - Hasil: `HTTP 200`, `reason: "PAIRED"`, balasan: `"Nomor Anda berhasil terhubung sebagai Owner Botseri."`.
- Verifikasi Hasil di PostgreSQL:
  - Tabel `authorized_numbers` mencatat `chat_id = '6281234567890@c.us'`, `is_owner = true`, `label = 'Owner (paired)'`.
  - Tabel `pairing_codes` mencatat `used_at = '2026-10-20 16:35:23.629+00'`.

#### Skenario 4 — Google OAuth Kredensial & Redirect Start
- Penyimpanan Kredensial:
  - `PUT /api/oauth/google/credentials` dengan `client_id` dan `client_secret` -> `HTTP 200 OK`.
  - Di PostgreSQL, kolom `client_secret_enc` diawali `v1:` dan tidak memuat plaintext secret.
- Inisiasi Alur OAuth:
  - `GET /api/oauth/google/start` -> mengembalikan `HTTP 307 Temporary Redirect` ke `https://accounts.google.com/o/oauth2/v2/auth`.
  - Parameter query memuat `client_id`, `redirect_uri=https://panel.yourdomain.com/api/oauth/google/callback`, `scope` (`calendar.events` dan `tasks`), `access_type=offline`, dan `prompt=consent`.
  - Response header menyetel cookie CSRF `google_oauth_state` dengan atribut `HttpOnly; SameSite=lax; Max-Age=600`.

#### Skenario 5 — Sinkronisasi To-Do & Ketahanan Kegagalan Google
- Kondisi Google `DISCONNECTED`:
  - `POST /api/todos` dengan tugas `"Tugas saat disconnected"`.
  - Tugas tersimpan normal dengan `google_sync_status = 'NOT_REQUIRED'`.
- Kondisi Google `CONNECTED` dengan Token Tidak Valid:
  - Status Google disimulasikan `CONNECTED` dengan dummy token terenkripsi.
  - `POST /api/todos` dengan tugas spesifik jam `"Tugas saat Google error"`.
  - Endpoint `/api/todos` tetap mengembalikan `HTTP 200 OK` (kegagalan sinkronisasi eksternal tidak menggagalkan penyimpanan lokal tugas).
  - Di database:
    - `google_sync_status = 'FAILED'`.
    - `google_sync_attempts = 1`.
    - `google_sync_error` mencatat detail error otentikasi Google OAuth.
    - Tabel `system_events` mencatat baris event dengan `source = 'GOOGLE_SYNC'`, `code = 'GOOGLE_SYNC_FAILED'`, dan `level = 'ERROR'`.

---

### 3.3 Pembersihan State Pasca Uji Coba

Setelah seluruh skenario pengujian diverifikasi:
1. Data to-do uji coba, hari libur uji coba, kode pairing uji coba, nomor terotorisasi uji coba, konfigurasi LLM uji coba, token OAuth uji coba, dan event uji coba dibersihkan sepenuhnya (`count = 0`).
2. Pengaturan operasional dikembalikan ke baseline standar (`brand_name: "Kembang Berseri"`, `work_hours_end: "17:00"`, `behavior_mode: "STRICT"`).
3. Prompt sistem terkompilasi ulang secara bersih (`compiled_prompt_version = 9`).

---

## 4. Penyimpangan, Keputusan Teknis, & Risiko

1. **Pemanfaatan `lib/pairing.ts` yang Sudah Ada**:
   Endpoint `/api/waha/pairing-code` langsung memanfaatkan fungsi kanonik `generatePairingCode()` dan `pairingHash()` dari `lib/pairing.ts`, memastikan normalisasi huruf besar dan algoritma hashing SHA-256 identik dengan verifikasi di `/api/internal/inbound/accept`.
2. **Prop `oauthRedirectUri` Server-Side**:
   Alih-alih mengandalkan environment variable client `NEXT_PUBLIC_PUBLIC_BASE_URL` yang memerlukan rebuild image saat URL publik berubah, server component `(app)/integrations/page.tsx` membaca `process.env.PUBLIC_BASE_URL` dan menyuplai nilai `redirectUri()` secara langsung sebagai prop ke `IntegrationsPanel`.
3. **Ketahanan Non-Blocking pada `syncTodo()`**:
   Kegagalan pemanggilan jaringan ke Google API (misalnya token kedaluwarsa, rate limit, atau gangguan jaringan) ditangani di dalam blok `try/catch` tanpa melempar exception ke luar. Status tugas ditandai `FAILED` dengan `google_sync_attempts = 1` dan dicatat ke `system_events`, sehingga pengalaman pengguna di dashboard to-do tetap cepat dan tidak terganggu.
4. **Risiko**:
   Sesi WAHA yang berstatus `SCAN_QR_CODE` memerlukan pemindaian manual via aplikasi WhatsApp fisik pemilik sebelum dapat digunakan untuk mengirim dan menerima pesan. Pada tahap Step 06, n8n akan mengandalkan ketersediaan sesi WAHA yang aktif untuk pemrosesan pesan inbound dan outbound.

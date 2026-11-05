# Log Pembaruan Botseri (Updates Log)

Dokumentasi kronologis seluruh pembaruan sistem, penambahan modul, route API, komponen antarmuka, dan hasil verifikasi pengujian.


## Indeks Navigasi Cepat (Daftar Isi)
- [Format Standar Entri Pembaruan](#format-standar-entri-pembaruan)
- [Catatan Historis: Pembuatan Tabel customer_sessions](#catatan-historis-pembuatan-tabel-customer_sessions)
- [[2026-10-27] LLM Catalog Discovery](#2026-10-27-automated-multi-provider-llm-model-discovery-catalog-sync--metadata-auto-fill)
- [[2026-11-04] S03: Contract Test n8n vs Zod](#2026-11-04-s03-contract-test-n8n-vs-zod)
- [[2026-11-04] S04: Konfirmasi Dua Langkah & Soft Delete Pesanan](#2026-11-04-s04-konfirmasi-dua-langkah--soft-delete-pesanan)
- [[2026-11-04] S05: Kebijakan Mute & Digest Pelanggan](#2026-11-04-s05-kebijakan-mute--digest-pelanggan)
- [[2026-11-04] S06: Validasi Graf & Visual Pipeline](#2026-11-04-s06-validasi-graf--visual-pipeline)
- [[2026-11-04] S07: Standarisasi Waktu & Alarm](#2026-11-04-s07-standarisasi-waktu--alarm)
- [[2026-11-04] S08: Reliabilitas Scheduler & Dead-Man Switch](#2026-11-04-s08-reliabilitas-scheduler-dan-observabilitas)
- [[2026-11-04] S09: Antrean Prioritas WAHA & Circuit Breaker](#2026-11-04-s09-antrean-prioritas-waha-humanizer)
- [[2026-11-04] S10: Refaktor Orders Service & Pengecekan Sesi](#2026-11-04-s10-refaktor-orders-service)
- [[2026-11-04] S11: LLM Gateway Parameter Override & Failover](#2026-11-04-s11-llm-gateway-konfigurasi-nyata)
- [[2026-11-05] S12: Privasi Data Pelanggan & Retensi](#2026-11-05-s12-privasi-data-pelanggan-dan-retensi-p2)
- [[2026-11-05] S13: Staging, Test Integrasi, & Evaluasi Prompt](#2026-11-05-s13-staging-test-integrasi-dan-evaluasi-prompt-p2)
- [[2026-11-05] S14: Dokumentasi, Operasional, & Penutupan Utang Lama](#2026-11-05-s14-dokumentasi-operasional-dan-penutupan-utang-lama-p2)
- [[2026-11-05] S15: Akseptansi Akhir & Penutupan Patch Plan](#2026-11-05-s15-akseptansi-akhir-dan-penutupan-patch-plan)
- [[2026-11-05] Hotfix: Kompatibilitas Promise Antrean WAHA & Pencegahan Hang Studio Alur](#2026-11-05-hotfix-kompatibilitas-promise-antrean-waha--pencegahan-hang-studio-alur)
- [[2026-11-05] Perbaikan Sub-Menu Chaining (Pilihan 3), Guard Sapaan Awal, & Handler Fallback Input](#2026-11-05-perbaikan-sub-menu-chaining-pilihan-3-guard-sapaan-awal--handler-fallback-input)
- [[2026-11-05] Perbaikan Penyimpanan current_router_id, Auto-Resolve Root Router, & Eliminasi Silent Drops](#2026-11-05-perbaikan-penyimpanan-current_router_id-auto-resolve-root-router--eliminasi-silent-drops)
- [[2026-11-05] Hotfix Kritis: Eliminasi Silent Drops & Jaminan Eksekusi Fallback customer/handle](#2026-11-05-hotfix-kritis-eliminasi-silent-drops--jaminan-eksekusi-fallback-customerhandle)
- [[2026-11-05] Hotfix: Pembatasan Timeout LangChain n8n & Isolasi Ketat Inbound Pelanggan](#2026-11-05-hotfix-pembatasan-timeout-langchain-n8n--isolasi-ketat-inbound-pelanggan)
- [[2026-11-05] Hotfix: Penerusan Body Pesan di Accept & Pemetaan Defensif Customer Handle n8n](#2026-11-05-hotfix-penerusan-body-pesan-di-accept--pemetaan-defensif-customer-handle-n8n)
- [[2026-11-05] Forensik & Perbaikan Drop Balasan Sapaan & Guard Unmute Sesi Pelanggan](#2026-11-05-forensik--perbaikan-drop-balasan-sapaan--guard-unmute-sesi-pelanggan)
- [[2026-11-05] Aturan 3-Strike Fallback & Auto-Handover Minri pada Pilihan Pelanggan](#2026-11-05-aturan-3-strike-fallback--auto-handover-minri-pada-pilihan-pelanggan)
- [[2026-11-05] Perbaikan Outbound 429 Queue, Mute Bypass Keyword (MENU/BARU), & Soft-Delete Orders](#2026-11-05-perbaikan-outbound-429-queue-mute-bypass-keyword-menubaru--soft-delete-orders)
- [[2026-11-05] Pembisuan Ketat Saat Pesanan Aktif & Penegasan Pelepasan Sesi Pasca-Pesanan](#2026-11-05-pembisuan-ketat-saat-pesanan-aktif--penegasan-pelepasan-sesi-pasca-pesanan)
---

### Format Standar Entri Pembaruan
Setiap entri pembaruan sistem Botseri wajib mengikuti struktur baku berikut:
1. `Tanggal & Section`
2. `Ringkasan Pekerjaan`
3. `Commit Git`
4. `Migrasi dan Rollback`
5. `Bukti Verifikasi (perintah + ringkasan output)`
6. `Known Issues / Catatan Operasional`

---

### Catatan Historis: Pembuatan Tabel customer_sessions
- **Tanggal Migrasi:** 2026-11-02
- **Nama Migrasi:** `20261102000000_add_customer_sessions`
- **Tujuan Arsitektur:** Pembuatan tabel `customer_sessions` untuk menampung sesi percakapan pelanggan dari nomor non-whitelist WhatsApp, percabangan state machine deterministik (`INIT`, `AWAITING_CHOICE`, `AWAITING_ORDER`, `PAUSED_FOR_OWNER`, `ACTIVE`), jeda otomatis ke owner (`paused_at`), dan penyimpanan draft pesanan parsial dalam kolom `metadata`.
- **Kolom Utama:** `id` (UUID), `phone_e164` (VARCHAR 50, UNIQUE), `customer_name` (VARCHAR 255), `state` (Enum `CustomerSessionState`), `paused_at` (TIMESTAMPTZ), `last_message_at` (TIMESTAMPTZ), `metadata` (JSONB).
---

## [2026-10-27] Automated Multi-Provider LLM Model Discovery, Catalog Sync, & Metadata Auto-Fill

### 1. Ringkasan Fitur
Menggantikan formulir penambahan model LLM manual pada `/integrations` dengan sistem **Automated Model Catalog & Discovery** terinspirasi dari antarmuka terminal `omp`:
- Pengguna memilih provider (`OPENROUTER`, `OPENAI`, `GEMINI`, `ANTHROPIC`, `CUSTOM_OPENAI_COMPAT`).
- Tombol **"Buka Katalog Model"** / **"Tarik Model"** memicu endpoint internal Next.js untuk menarik katalog model secara otomatis langsung dari API resmi provider atau katalog terkurasi.
- Komponen dialog modal utilitarian (`ModelPickerModal.tsx`) menampilkan daftar model scannable dengan font monospaced, badge context window (`128k ctx`, `1m ctx`), badge kapabilitas (`Vision`, `Tools`, `Audio`, `Reasoning`), filter kategori (`Semua`, `Chat`, `Vision`, `Audio / STT`, `Gratis (Free)`, `Reasoning`), dan estimasi biaya input/output per 1M token.
- Saat salah satu model dipilih, formulir terisi otomatis (`model_name`, `max_output_tokens`, `price_input_per_mtok`, `price_output_per_mtok`, rekomendasi `stt_model`, serta default `temperature: 0.2`).
- Toggle **"Input Manual"** tersedia sebagai fallback jika pengguna menggunakan model custom atau jaringan lokal tanpa koneksi katalog publik.

---

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/llm-gateway/pricing-tables.ts` | Baru | Tabel referensi statis terkurasi metadata konteks, harga per 1M token, kapabilitas, dan rekomendasi model STT untuk OpenAI, Google Gemini, dan Anthropic Claude. |
| `dashboard/src/lib/llm-gateway/catalog.ts` | Baru | Modul penarik katalog multi-provider (`fetchOpenRouterCatalog`, `fetchOpenAiCatalog`, `fetchGeminiCatalog`, `fetchAnthropicCatalog`, `fetchCustomCatalog`) dengan normalisasi ke kontrak `UnifiedModelCatalogItem`. |
| `dashboard/src/app/api/llm/catalog/route.ts` | Baru | Route handler `POST /api/llm/catalog` terproteksi sesi admin (`getSession()`) dan enkripsi (`decryptSecret`) untuk menarik katalog model tanpa mencatat API key di URL query log. |
| `dashboard/src/app/(app)/integrations/ModelPickerModal.tsx` | Baru | Komponen dialog pemilih model utilitarian berstandar antislop: bebas em dash, target sentuh >= 44px, pencarian teks instan, filter kategori, badge kapabilitas monospaced, dan responsif mobile. |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Modifikasi | Mengintegrasikan tombol pemicu katalog, modal pemilih model, chip informasi model terpilih, auto-fill input formulir, dan toggle input manual. |
| `dashboard/tests/unit/catalog.test.ts` | Baru | 9 skenario tes unit Vitest mencakup adapter OpenRouter, OpenAI, Gemini, Anthropic, Custom, dan master dispatcher `fetchModelCatalog`. |
| `updates.md` | Baru | Berkas catatan log kronologis pembaruan proyek. |

---

### 3. Kontrak Data Model Terstandarisasi

```typescript
export interface UnifiedModelCatalogItem {
  id: string; // contoh: "openai/gpt-4o-mini", "gemini-2.5-flash", "claude-3-5-sonnet-latest"
  name: string;
  provider: 'OPENROUTER' | 'OPENAI' | 'GEMINI' | 'ANTHROPIC' | 'CUSTOM_OPENAI_COMPAT';
  context_length: number;
  max_output_tokens: number;
  pricing: {
    input_per_mtok_usd: number;
    output_per_mtok_usd: number;
    is_free: boolean;
  };
  capabilities: {
    vision: boolean;
    audio_stt: boolean;
    function_calling: boolean;
    reasoning: boolean;
  };
  recommended_stt_model?: string;
  description?: string;
}
```

---

### 4. Hasil Verifikasi & Uji Coba

1. **Unit Test Suite (Vitest):**
   - 19 test files, **161 passed** (100% lulus, 0 gagal).
   - `tests/unit/catalog.test.ts`: 9 tests passed dalam 12ms.
2. **TypeScript Typecheck:**
   - `npx tsc --noEmit`: Lulus bersih dengan 0 error.
3. **ESLint:**
   - `npm run lint` (`next lint`): Lulus bersih dengan 0 warning dan 0 error.
4. **Next.js Standalone Build:**
   - `npm run build`: Berhasil mengompilasi seluruh 25 route, termasuk `POST /api/llm/catalog` sebagai route dynamic (`ƒ`).
5. **Uji Langsung Endpoint via curl (Docker Container Live):**
   - Unauthorized (tanpa sesi cookie): HTTP 401.
   - OpenRouter Live Fetch: HTTP 200, 464 model publik terindeks lengkap dengan tarif per 1M token dan kapabilitas.
   - OpenAI Curated Fetch: HTTP 200, 9 model terkurasi (`gpt-4o-mini`, `gpt-4o`, `o1`, `o3-mini`, dsb.) dengan harga terisi akurat.
   - Google Gemini Curated Fetch: HTTP 200, 8 model terkurasi dengan konteks hingga 2M token dan audio native.
   - Anthropic Claude Curated Fetch: HTTP 200, 7 model terkurasi dengan rekomendasi STT `whisper-1`.
6. **Kepatuhan Invarian & Keamanan:**
   - `INV-01` & `INV-02`: Kredensial tersimpan didekripsi aman di memori server tanpa terekspos ke klien.
   - `INV-08`: Proteksi Cloudflare 404 pada rute internal tetap aktif (terbukti via `./scripts/smoke.sh` 8/8 PASS).
   - `antislop.md` R-02: 0 karakter em dash pada seluruh berkas yang dibuat atau dimodifikasi.

---

## [2026-10-27] UI Refactoring: Formulir LLM Ringkas dengan Progressive Disclosure

### 1. Ringkasan Perubahan
Memadatkan formulir penambahan konfigurasi LLM baru pada halaman `/integrations` dengan pola **Progressive Disclosure**:
- **Tampilan Default Ringkas:** Pengguna hanya dihadapkan pada 3 kolom utama:
  1. **Provider:** Dropdown pilihan penyedia layanan (`OpenRouter`, `OpenAI`, `Google Gemini`, `Anthropic Claude`, `Custom OpenAI-Compat`).
  2. **Model Terpilih (Katalog Trigger):**
     - Saat model belum dipilih: Tombol bersahaja `[ ⌕ Buka Katalog Model ]` selebar kolom dengan font monospaced.
     - Saat model sudah dipilih: Kartu status ringkas menampilkan ID model, badge konteks (`128k ctx`), tarif per 1M token, dan tombol `[ Ganti Model ]`.
  3. **API Key (Rahasia):** Input password dengan placeholder kontekstual sesuai format key provider (`sk-or-v1-...`, `sk-proj-...`, `AIzaSy...`, `sk-ant-api03-...`, atau `sk-...`).
  4. Jika provider custom dipilih: Kolom Base URL otomatis tampil mendampingi API Key pada baris kedua.
- **Panel Pengaturan Lanjutan (Accordion / Collapsible):**
  - Tombol toggle utilitarian `[ ▸ Pengaturan Lanjutan & Override Biaya ]` (tertutup secara default).
  - Saat dibuka: Menampilkan grid 2 baris berisi parameter teknis: `Base URL (Opsional)`, `Model STT Audio`, `Temperature` (default 0.2), `Maks Output Tokens`, `Harga Input per 1M Tok`, dan `Harga Output per 1M Tok`.
  - Nilai di dalam panel tetap tersinkronisasi otomatis saat model dipilih dari katalog, namun pengguna bebas mengubahnya bila diperlukan.
  - Input `max_output_tokens` otomatis dibatasi maksimal 8000 agar mematuhi batasan skema validasi API.
- **Mode Input Manual (Fallback):**
  - Tautan teks `[ Masukkan Model Secara Manual ]` / `[ Kembali ke Mode Katalog ]`.
  - Saat diaktifkan: Tombol katalog berubah menjadi input teks standar `Nama Model (Input Manual)` dan panel Pengaturan Lanjutan terbuka secara otomatis.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Modifikasi | Refactoring formulir konfigurasi LLM: tata letak 3 kolom ringkas, tombol katalog terintegrasi, kartu chip model, accordion pengaturan lanjutan, placeholder API key cerdas, pembatasan max tokens 8000, dan toggle mode manual. |
| `updates.md` | Modifikasi | Pencatatan kronologis rincian perubahan Progressive Disclosure. |

### 3. Hasil Verifikasi
1. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus 100% dengan 0 error dan 0 warning.
2. **Unit Test Suite:** 19 test file, 161 test cases lulus tanpa regresi.
3. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
4. **Uji Penyimpanan Konfigurasi:** Pembuatan konfigurasi LLM via `POST /api/llm/configs` teruji sukses menyimpan data ke PostgreSQL dengan enkripsi AES-256-GCM.
5. **Antislop R-02:** 0 karakter em dash pada seluruh komponen teks UI.
6. **Target Sentuh & Aksesibilitas:** Seluruh kontrol tombol dan input memiliki tinggi sentuh minimal 44px (`min-h-[44px]`).

---

## [2026-10-27] Authorized Numbers Management Dashboard & Fix Multi-Owner Reminder Bug

### 1. Ringkasan Perbaikan & Fitur
- **Akar Masalah Bug Reminder:** Saat dua nomor berbeda dipairing sebagai owner, keduanya memiliki `is_owner: true`. Modul scheduler sebelumnya melakukan `findFirst({ where: { is_owner: true }, orderBy: { id: 'asc' } })` yang memilih nomor secara sembarangan berdasarkan urutan UUID sehingga pengingat to-do terkirim ke nomor lama.
- **Solusi Skema & Logika:**
  - Menambahkan kolom `is_primary Boolean @default(false)` dan `updated_at DateTime @default(now()) @updatedAt` pada tabel `authorized_numbers`.
  - Menambahkan helper `getPrimaryOwner()` di `src/lib/scheduler/queries.ts`: memprioritaskan nomor dengan `is_owner: true AND is_primary: true`, dengan fallback ke nomor owner yang paling terakhir aktif (`updated_at: 'desc'`).
  - Mengintegrasikan `getPrimaryOwner()` pada `tick.ts` dan route hasil job scheduler `[jobId]/result/route.ts`.
  - Saat alur pairing nomor baru dijalankan (`/api/internal/inbound/accept`), jika belum ada nomor pemilik utama, nomor yang baru dipairing otomatis menjadi `is_primary: true`.
- **Manajemen Nomor di Dashboard:**
  - Endpoint baru:
    - `GET /api/authorized-numbers`: Mengembalikan daftar nomor terurut berdasarkan `is_primary DESC, created_at DESC`.
    - `PATCH /api/authorized-numbers/[id]`: Mengubah label dan mengubah status `is_primary` (dengan transaksi atomik mereset nomor lain menjadi non-primary).
    - `DELETE /api/authorized-numbers/[id]`: Mencabut akses otorisasi nomor, mencegah penghapusan jika hanya tersisa 1 nomor owner (HTTP 400), dan otomatis mempromosikan nomor owner tersisa jika yang dihapus adalah primary.
  - Komponen antarmuka `AuthorizedNumbersList.tsx` pada halaman `/integrations`: tabel dan kartu responsif dengan format monospace, badge "Pemilik Utama" (aksen solid) dan "Pemilik Tambahan" (outline netral), edit label inline, tombol `[ Jadikan Utama ]`, dan konfirmasi modal/popover sebelum mencabut izin.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan field `is_primary Boolean @default(false)` dan `updated_at DateTime @default(now()) @updatedAt` pada model `AuthorizedNumber`. |
| `dashboard/prisma/migrations/20261027140000_add_is_primary_to_authorized_numbers/migration.sql` | Baru | Migrasi SQL DDL maju dan data backfill menandai nomor owner pertama sebagai primary. |
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Menambahkan fungsi `getPrimaryOwner()` deterministik. |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Menggunakan `getPrimaryOwner()` untuk memilih nomor target brief, reminder, dan evaluasi harian. |
| `dashboard/src/app/api/internal/scheduler/jobs/[jobId]/result/route.ts` | Modifikasi | Menggunakan `getPrimaryOwner()` saat mencatat pesan keluar hasil eksekusi job. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Mengatur `is_primary: true` secara otomatis saat nomor owner pertama dipairing. |
| `dashboard/src/app/api/authorized-numbers/route.ts` | Baru | Route handler `GET /api/authorized-numbers` terproteksi sesi JWT admin. |
| `dashboard/src/app/api/authorized-numbers/[id]/route.ts` | Baru | Route handler `PATCH` dan `DELETE` dengan transaksi atomik dan proteksi minimal 1 owner tersisa. |
| `dashboard/src/app/(app)/integrations/AuthorizedNumbersList.tsx` | Baru | Komponen antarmuka utilitarian responsif daftar nomor, badge peran, edit label inline, dan tombol aksi. |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Modifikasi | Mengintegrasikan `AuthorizedNumbersList` di bawah kartu pairing WhatsApp bot. |
| `dashboard/src/app/(app)/integrations/page.tsx` | Modifikasi | Mengambil data awal `initialAuthorizedNumbers` dari database dan meneruskannya ke panel integrasi. |
| `dashboard/tests/unit/authorized-numbers.test.ts` | Baru | 3 skenario tes unit untuk resolusi `getPrimaryOwner` dan fallback. |
| `updates.md` | Modifikasi | Pencatatan kronologis perbaikan multi-owner bug dan modul manajemen nomor terotorisasi. |

### 3. Hasil Verifikasi
1. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus 100% (0 error, 0 warning).
2. **Unit Test Suite:** 20 test file, **164 test cases** (100% passed).
3. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
4. **Verifikasi Live Database & Bug:**
   - Dua nomor terdaftar di database (`+6289699898458` dan `+6287881820571`).
   - Saat Nomor A dijadikan primary via PATCH: Nomor A menjadi `is_primary: true`, Nomor B otomatis menjadi `is_primary: false`. `getPrimaryOwner()` secara deterministik mengembalikan chat ID Nomor A.
   - Saat Nomor B dijadikan primary via PATCH: `getPrimaryOwner()` seketika beralih mengembalikan chat ID Nomor B.
   - Saat mencoba menghapus satu-satunya nomor owner tersisa: API mengembalikan HTTP 400 "Minimal satu nomor pemilik wajib tersisa."
5. **Antislop R-02:** 0 karakter em dash pada seluruh komponen teks UI dan berkas baru/modifikasi.
6. **Target Sentuh Minimal 44px:** Seluruh tombol aksi `[ Jadikan Utama ]`, `[ Cabut Izin ]`, dan kontrol form memenuhi standar ukuran sentuh.

---

## [2026-10-27] Modular Order Management Toggle (Open-Source Curated Mode: Personal To-Do vs UMKM Commerce)

### 1. Ringkasan Fitur
Menjadikan modul **Pesanan Pelanggan (`Orders`)** bersifat modular dan opsional melalui konfigurasi `enable_orders` pada `bot_settings`:
- **Mode Default (UMKM Commerce, `enable_orders = true`):**
  - Tab navigasi **Pesanan** (`/orders`) ditampilkan di header dashboard.
  - Tombol cepat **Catat pesanan** ditampilkan pada ringkasan `/dashboard`.
  - Prompt sistem memuat instruksi lengkap ekstraksi pesanan pelanggan (`tool_create_todo_and_order`).
- **Mode Produktivitas Personal / Open-Source (`enable_orders = false`):**
  - Tab navigasi **Pesanan** otomatis disembunyikan dari bilah navigasi utama (`AppNav.tsx`).
  - Tombol **Catat pesanan** pada halaman `/dashboard` otomatis disembunyikan.
  - Mengakses rute `/orders` secara langsung menyajikan panel status utilitarian yang bersih: "Modul Pesanan Sedang Dinonaktifkan" lengkap dengan tombol `[ Buka Pengaturan ]`.
  - Kompilator prompt (`compileSystemPrompt`) secara otomatis menghapus instruksi pencatatan order pelanggan dan mengalihkan instruksi agen murni ke pengelolaan to-do operasional, menghemat kuota token LLM dan meningkatkan akurasi agen.
  - Endpoint internal `create-todo-and-order` secara aman mengabaikan pembuatan baris di tabel `orders` tanpa menggagalkan penyimpanan `todos`.
- **Pengaturan & Bootstrap:**
  - Setup wizard (`/setup` & `POST /api/setup`): Pengguna dapat menentukan mode operasional sejak awal bootstrap melalui checkbox "Aktifkan Modul Pesanan Pelanggan (Khusus UMKM / Jasa)".
  - Pengaturan Dashboard (`/settings` & `PUT /api/settings`): Kontrol toggle/checkbox utilitarian "Aktifkan Modul Pesanan Pelanggan (Orders)". Setiap penyimpanan otomatis mengompilasi ulang prompt sistem, menaikkan versi prompt, dan merefresh navigasi.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan field `enable_orders Boolean @default(true)` pada model `BotSettings`. |
| `dashboard/prisma/migrations/20261027150000_add_enable_orders_to_bot_settings/migration.sql` | Baru | Migrasi SQL DDL maju menambahkan kolom `enable_orders`. |
| `dashboard/prisma/seed.cjs` | Modifikasi | Menyertakan `enable_orders: true` sebagai nilai default awal pada data seed. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Pembersihan karakter em dash pada contoh format chat masuk. |
| `dashboard/src/lib/prompt/compiler.ts` | Modifikasi | Menambahkan adaptasi kalimat instruksi prompt saat `settings.enable_orders === false`. |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Penjagaan aman mengabaikan pembuatan `orders` saat `settings.enable_orders === false`. |
| `dashboard/src/app/api/settings/route.ts` | Modifikasi | Menambahkan validasi Zod `enable_orders: z.boolean().optional()` pada PUT handler. |
| `dashboard/src/app/api/setup/route.ts` | Modifikasi | Menambahkan `enable_orders` pada skema setup bootstrap. |
| `dashboard/src/app/setup/page.tsx` | Modifikasi | Menambahkan kontrol checkbox aktivasi modul pesanan pada halaman setup. |
| `dashboard/src/app/(app)/layout.tsx` | Modifikasi | Meneruskan `enableOrders={settings.enable_orders}` ke `AppNav`. |
| `dashboard/src/components/AppNav.tsx` | Modifikasi | Menyaring tab navigasi `/orders` bila `enableOrders === false`. |
| `dashboard/src/app/(app)/settings/SettingsForm.tsx` | Modifikasi | Menambahkan toggle checkbox "Aktifkan Modul Pesanan Pelanggan (Orders)" di bagian Profil Usaha. |
| `dashboard/src/app/(app)/settings/page.tsx` | Modifikasi | Meneruskan nilai `enable_orders` ke form pengaturan. |
| `dashboard/src/app/(app)/orders/page.tsx` | Modifikasi | Menampilkan panel status modul nonaktif dengan tautan ke `/settings` saat `enable_orders === false`. |
| `dashboard/src/app/(app)/dashboard/page.tsx` | Modifikasi | Menyembunyikan tombol "Catat pesanan" saat `enable_orders === false`. |
| `dashboard/tests/unit/prompt.test.ts` | Modifikasi | Menambahkan unit test perbandingan output `compileSystemPrompt` untuk `enable_orders: true` vs `false`. |
| `updates.md` | Modifikasi | Pencatatan kronologis fitur modular order management toggle. |

### 3. Hasil Verifikasi
1. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus 100% (0 error, 0 warning).
2. **Unit Test Suite:** 20 test file, **165 test cases** (100% lulus, termasuk tes adaptasi prompt `enable_orders`).
3. **Next.js Standalone Build:** `npm run build` sukses mengompilasi seluruh route.
4. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
5. **Verifikasi Live E2E:**
   - Saat `enable_orders: false` via API:
     - DB terupdate `enable_orders = f`.
     - `compiled_prompt_version` meningkat dari 9 ke 10.
     - Teks "mencatat pesanan" hilang dari compiled prompt di DB.
     - Tab `/orders` hilang dari bilah navigasi `AppNav`.
     - Tombol "Catat pesanan" hilang dari `/dashboard`.
     - Mengakses `/orders` menampilkan pesan bersih "Modul Pesanan Sedang Dinonaktifkan" beserta tombol `[ Buka Pengaturan ]`.
   - Saat dikembalikan ke `enable_orders: true`:
     - Seluruh menu pesanan dan papan order kembali aktif normal.
6. **Antislop R-02:** 0 karakter em dash pada seluruh komponen teks UI dan berkas modifikasi.
7. **Aksesibilitas:** Seluruh kontrol tombol memiliki target sentuh minimal 44px (`min-h-[44px]`).

---

## [2026-10-27] Refactoring Inbound Agent Output Synthesis & Eliminating Generic Fallbacks

### 1. Ringkasan Perbaikan
Mengeliminasi kemunculan kalimat robotik generik "Permintaan Anda telah diproses." pada alur percakapan chat WhatsApp masuk (`CHAT_MASUK`):
- **Akar Masalah:**
  1. Sapaan murni ("Hi", "Halo", "Pagi"): Node LangChain Agent di n8n menghasilkan output pada `$json.text` atau `$json.output`, namun node pemecah pesan (`split-output`) sebelumnya hanya membaca `$json.output` dan langsung jatuh ke string fallback robotik jika `$json.output` kosong.
  2. Pada guard WAHA (`dashboard/src/lib/waha/guard.ts`), kondisi `EMPTY_TEXT` mengembalikan fallbackText `"Permintaan Anda telah diproses."` yang kaku dan tidak kontekstual.
  3. Template prompt sistem sebelumnya belum memiliki panduan eksplisit yang membedakan sapaan murni (tanpa memanggil tool) vs permintaan melihat tugas pending (wajib memanggil `tool_get_prioritized_todos`) vs konfirmasi setelah pemanggilan `tool_create_todo_and_order`.
- **Solusi Teknis:**
  - **Node n8n `split-output`:** Memperbarui ekstraksi output agen dengan membaca `$json.output || $json.text || ($json.message && $json.message.content) || ''`. Jika teks kosong, menggunakan fallback ramah: `"Halo! Ada tugas atau catatan baru yang ingin ditambahkan hari ini?"` alih-alih kalimat robotik.
  - **Guard WAHA (`guard.ts`):** Mengganti fallback `EMPTY_TEXT` menjadi respons asisten yang natural dan proaktif.
  - **Template Sistem (`base.id.md`):** Menambahkan 4 aturan eksplisit:
    1. *Sapaan Murni:* Balas sapaan dengan ramah, singkat, dan tanyakan agenda/tugas tanpa memanggil tool.
    2. *Permintaan Daftar Tugas Pending:* Wajib panggil `tool_get_prioritized_todos` dan sajikan 3 fokus utama serta tugas lainnya secara terstruktur.
    3. *Konfirmasi Pencatatan Tugas Baru:* Sebutkan judul tugas, estimasi waktu, serta prioritasnya secara ringkas.
    4. *Larangan Kalimat Robotik:* Melarang keras balasan generik "Permintaan Anda telah diproses".

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/waha/guard.ts` | Modifikasi | Mengganti string fallback `EMPTY_TEXT` menjadi sapaan asisten natural dan kontekstual. |
| `dashboard/tests/unit/waha-guard.test.ts` | Modifikasi | Menambahkan pengujian unit untuk fallback `EMPTY_TEXT` dan pembersihan em dash. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Menambahkan panduan spesifik untuk sapaan murni, kueri to-do pending, konfirmasi tugas baru, dan larangan respons robotik. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Memperbarui node `split-output` (Pecah Pesan) untuk menangani `$json.output`, `$json.text`, dan `$json.message.content` dengan fallback ramah. |
| `updates.md` | Modifikasi | Pencatatan kronologis refactoring output synthesis agen masuk. |

### 3. Hasil Verifikasi
1. **Validasi Workflow:** `./scripts/validate-workflows.sh` lulus bersih (2 file workflow terverifikasi memenuhi INV-01 dan INV-02).
2. **Unit Test Suite:** 20 test file, **166 test cases** lulus 100% (termasuk tes baru `waha-guard.test.ts`).
3. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
4. **Kompilasi Ulang Prompt:** Prompt sistem di database (`bot_settings`) berhasil dikompilasi ulang memuat seluruh aturan baru sapaan, kueri to-do, dan larangan kalimat robotik.
5. **Aktivasi Workflow n8n:** Container `botseri-n8n` mendeteksi perubahan hash workflow pada start, mengimpor ulang, dan mengaktifkan `botseriInboundAgent01` secara otomatis.
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas yang dimodifikasi.

---

## [2026-10-27] Critical Bugfix: Tool Execution Failures & Silent Fallback Loop Resolution

### 1. Investigasi Akar Masalah
Pesan fallback "Halo! Ada tugas atau catatan baru yang ingin ditambahkan hari ini?" muncul secara keliru saat pengguna meminta daftar tugas ("Lihat list prioritas aku dong", "Lihat list tugas akuu") atau mencatat tugas dengan waktu relatif ("Besok pagi aku harus ngejemur baju").

Akar masalah yang ditemukan:
1. **Kegagalan Endpoint `get-prioritized-todos`:**
   - Endpoint sebelumnya hanya mendukung metode `POST` dan menolak metode `GET` (HTTP 405).
   - Scope bawaan dibatasi secara kaku ke `TODAY` (`planned_date <= today`). Jika tidak ada tugas bertanggal hari ini (misalnya tugas aktif berencana besok), `focus` dan `rest` bernilai kosong (`[]`), sehingga agent LLM tidak melihat tugas aktif dan menghasilkan balasan kosong.
   - Response JSON belum menyediakan properti eksplisit `top_focus` dan `remaining_todos` sebagaimana diharapkan prompt.
2. **Kegagalan Validasi di `create-todo-and-order`:**
   - `source_message_id` sebelumnya diwajibkan sebagai UUID ketat. Panggilan tool yang tidak menyertakan UUID menghasilkan HTTP 422 `VALIDATION_ERROR`.
   - Ekstraksi waktu relatif seperti "besok pagi" tanpa jam eksplisit rentan gagal parsing ISO-8601 string, memicu penolakan request dengan HTTP 422.
3. **Silent Fallback Loop di n8n:**
   - Pada node `split-output` (Pecah Pesan), jika output agen kosong akibat kegagalan pemanggilan tool, n8n mengisinya dengan sapaan default, menciptakan ilusi bot merespons "sapaan" padahal user sedang meminta melihat tugas atau mencatat tugas.

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts` | Modifikasi | Mendukung metode `POST` dan `GET`, default scope `ALL_ACTIVE`, menyertakan tugas `upcoming` jika `TODAY` kosong, mengembalikan struktur eksplisit `top_focus`, `remaining_todos`, `total_active`, serta pesan informatif saat tidak ada tugas aktif. |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Menambahkan fungsi `parseFlexibleDueAt` yang mengenali frasa waktu relatif Indonesia ("besok", "lusa", "hari ini", "pagi", "siang", "sore", "malam") dan mengonversinya ke zona waktu lokal (Asia/Jakarta) dengan default jam 08:00 jika jam tidak disebut. Menambahkan fallback otomatis `source_message_id` ke pesan inbound terakhir jika tidak disediakan. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Menambahkan instruksi tegas: jika pesan memuat permintaan melihat tugas, WAJIB memanggil `tool_get_prioritized_todos` dengan parameter kosong `{}` dan DILARANG menjawab dengan sapaan ulang. Menambahkan panduan waktu relatif "besok pagi" ke jam 08:00 lokal. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Memperbarui deskripsi `tool_get_prioritized_todos` dengan panduan wajib panggil saat meminta daftar tugas/prioritas. Memperbarui node `split-output` untuk mencatat warning di log kontainer dan menggunakan pesan jujur "Maaf, terjadi kendala saat memeriksa atau mencatat tugas..." jika terjadi kegagalan output. |
| `updates.md` | Modifikasi | Pencatatan kronologis investigasi dan perbaikan bug tool execution. |

### 3. Hasil Verifikasi
1. **Uji Langsung `get-prioritized-todos` (cURL):**
   - Request `POST /api/internal/tools/get-prioritized-todos` dengan body `{}`: HTTP 200 OK.
   - Mengembalikan `top_focus` berisi tugas aktif (misal: "Lock in asah jam 7"), `total_active: 1`.
   - Request `GET /api/internal/tools/get-prioritized-todos`: HTTP 200 OK dengan payload terstruktur.
2. **Uji Langsung `create-todo-and-order` Tanggal Relatif (cURL):**
   - Request: `{"todos":[{"title":"Ngejemur baju","due_at":"2026-10-28T08:00:00+07:00","has_specific_time":false}]}` tanpa `source_message_id`: HTTP 200 OK, tugas berhasil tersimpan di database.
3. **Validasi Workflow n8n:** `./scripts/validate-workflows.sh` lulus bersih (2 workflow valid).
4. **Unit Test Suite:** 20 test file, **166 test cases** lulus 100%.
5. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas yang disentuh.

---

## [2026-10-27] Critical Bugfix: Defensive Payload Parsing on create_todo & n8n maxTokens Resolution

### 1. Diagnosa Log & Investigasi Mendalam
Berdasarkan inspeksi data eksekusi n8n (`execution_data` pada execution 132) saat pengguna mengirim pesan "Aku harus ngerjain tkmp malam ini":
1. **Tool `create-todo-and-order` Sebenarnya Sukses Menyimpan Tugas:**
   - Tool berhasil dieksekusi dan tugas `"Kerjakan TKMP"` (`id: 8370c1f3-ee3f-4d4e-9e09-b856fce4e7f9`) berhasil tersimpan di tabel `todos` PostgreSQL.
2. **Akar Masalah Kegagalan Output (Token Truncation):**
   - Setelah tool selesai dieksekusi, n8n memanggil LLM Gateway untuk kedua kalinya guna mensintesis teks balasan konfirmasi kepada pengguna.
   - Node `Botseri Gateway` (`lmChatOpenAi`) di `botseri-inbound-agent.json` sebelumnya dibatasi secara kaku dengan `maxTokens: 600`.
   - Model penalaran (seperti `nvidia/nemotron-3.5-super-vl:free` dan model sejenis) menghabiskan kuota 600 token untuk proses *internal thinking/chain-of-thought*, sehingga pemanggilan terpotong dengan `finish_reason: "length"` dan menghasilkan string teks kosong (`""`).
   - Karena teks kosong, node `AI Agent` mengembalikan `{ output: "" }` yang kemudian memicu pesan kendala pada `split-output`.
3. **Kerentanan Potensial Lainnya:**
   - Pemanggilan `syncTodo(item.id)` sebelumnya tidak diisolasi dalam `try/catch`. Jika Google Calendar/Tasks mengalami penolakan otorisasi atau timeout jaringan, route akan melempar uncaught exception HTTP 500 dan menggagalkan seluruh response to-do.
   - Input `priority_rank` berbentuk string (misal `"4"`, `"P2"`) rentan menghasilkan fallback yang tidak diharapkan.
   - Objek `todos` berformat flat `{ title, due_at, ... }` atau single object `{ todos: { title: ... } }` memerlukan penanganan fleksibel tanpa melempar HTTP 422.

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/src/lib/todos/create.ts` | Modifikasi | Memperbarui `resolvePriority` dan `resolveDueAt` agar tidak melempar uncaught error saat tanggal tidak valid atau priority stack kosong (fallback aman ke `dueAt: null`, `hasSpecificTime: false`, dan level prioritas default). |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Menambahkan fungsi `normalizePriorityRank` untuk mengonversi string `"P1"`, `"4"`, `"p2"` secara defensif ke integer 1 s/d 4. Mendukung format payload flat `{ title: ... }`, objek tunggal `{ todos: { title: ... } }`, dan array standar. Mengisolasi pemanggilan `syncTodo(item.id)` dalam blok `try/catch` mandiri agar kendala Google sync tidak menggagalkan to-do endpoint. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Menambahkan instruksi eksplisit kepada LLM: selalu gunakan format `due_at` berstandar ISO-8601 lengkap dengan offset zona waktu (contoh: `2026-10-27T22:00:00+07:00`), dan jika pengguna tidak menyebutkan jam pasti, set `due_at: null` dan `has_specific_time: false`. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Mengubah batas token `maxTokens` pada node `Botseri Gateway` dari 600 menjadi dinamis `={{ $('Context').item?.json?.max_output_tokens || 2048 }}` agar model leluasa menyelesaikan proses sintesis balasan tanpa terpotong `finish_reason: "length"`. |
| `updates.md` | Modifikasi | Pencatatan kronologis investigasi log eksekusi n8n dan perbaikan parsing defensif. |

### 3. Hasil Verifikasi
1. **Uji cURL Terminal Terhadap Berbagai Format Input:**
   - Format string priority rank `"4"` dengan tanggal ISO: HTTP 200 OK (`priority_rank: 4`, `priority_label: "Rutin"`).
   - Format flat object `{ title: "Tugas PPSI", due_at: null, has_specific_time: false }`: HTTP 200 OK.
   - Format single object `{ todos: { title: "Beli buku catatan", priority_rank: "P2" } }`: HTTP 200 OK (`priority_rank: 2`, `priority_label: "Penting dan mudah rusak"`).
2. **Unit Test Suite:** 20 test file, **166 test cases** lulus 100%.
3. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
4. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
5. **Aktivasi Workflow n8n:** Container `botseri-n8n` di-restart dan mengimpor ulang workflow dengan konfigurasi `maxTokens: 2048`.
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas yang disentuh.

---

## [2026-10-27] Critical Hotfix: n8n LangChain Sub-Node Static Parameters & Upstream Provider Rate Limit Visibility

### 1. Investigasi Log Riil Kontainer & Akar Masalah
Berdasarkan inspeksi log kontainer `botseri-dashboard` dan n8n SQLite (`execution_data` ID 142) saat pesan pengguna ("hi botseri", "malam ini jam 9 saya mau bikin ppt sismul") masuk:
1. **Evaluasi Terisolasi Sub-Node LangChain n8n:**
   - Sub-node LangChain (port `ai_languageModel` pada `Botseri Gateway`) sebelumnya memuat ekspresi dinamis yang memanggil node luar seperti `$('Context')`.
   - Karena sub-node dievaluasi secara terisolasi di luar aliran item utama, pemanggilan ekspresi dinamis tersebut menyebabkan nilai parameter menjadi null atau tidak terdefinisi.
   - **Solusi:** Nilai `maxTokens` diubah menjadi bilangan bulat statis aman `2048`, `temperature: 0.2` statis, dan `timeout: 45000` (45 detik).
2. **Identifikasi Kegagalan Upstream OpenRouter (Rate Limit 429):**
   - Panggilan langsung ke endpoint OpenRouter dengan kunci API aktif mengungkap akar penyebab kegagalan:
     `Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day` (`limit_source: openrouter_free_tier_daily`, `limit: 50`, `used: 50`, `remaining: 0`).
   - Kunci OpenRouter yang digunakan telah mencapai kuota harian batas model gratis (50 request/hari).
   - **Solusi:**
     - Endpoint `chat/completions/route.ts` kini mencatat log error tingkat `ERROR` dengan detail provider, model, dan status code secara eksplisit ke stdout kontainer.
     - Node `Kirim Fallback Error` pada n8n mendeteksi pesan error 429 / Rate Limit dari upstream dan memberikan informasi jujur kepada pengguna di WhatsApp: `"Batas kuota harian model LLM terlampaui (Rate Limit). Silakan pilih model lain atau tambah kuota di menu Integrasi."` alih-alih pesan kendala generik.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Menghapus ekspresi dinamis `$('Context')` pada sub-node `lmChatOpenAi`, menetapkan `maxTokens: 2048` statis, `temperature: 0.2`, `timeout: 45000`, serta memperbarui pesan pada `Kirim Fallback Error` untuk mendeteksi error kuota/rate limit secara transparan. |
| `dashboard/src/app/api/internal/llm/v1/chat/completions/route.ts` | Modifikasi | Menambahkan logging eksplisit ke logger JSON saat upstream provider mengembalikan status error (seperti 429 Rate Limit) beserta konteks model. |
| `updates.md` | Modifikasi | Pencatatan kronologis investigasi log kontainer dan perbaikan parameter statis sub-node LangChain. |

### 3. Hasil Verifikasi
1. **Validasi Workflow n8n:** `./scripts/validate-workflows.sh` lulus bersih (2 workflow valid).
2. **Aktivasi Workflow n8n:** Perintah impor workflow dan pembaruan dieksekusi sukses; kedua workflow aktif pada kontainer `botseri-n8n`.
3. **Unit Test Suite:** 20 test file, **166 test cases** lulus 100%.
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
6. **Log Kontainer Dashboard:** Log JSON terverifikasi mencatat `Upstream provider error (OPENROUTER)` dengan status `429` dan nama model secara transparan.
7. **Antislop R-02:** 0 karakter em dash pada seluruh berkas yang dimodifikasi.

---

## [2026-10-27] Fix Gemini 2.5 Flash Function Calling & System Instruction Translation in LLM Gateway

### 1. Investigasi Akar Masalah
Pengujian koneksi teks biasa Gemini 2.5 Flash di dashboard berhasil (HTTP 200), namun saat pesan WhatsApp masuk ("hi" / "hi botseri"), sistem memicu pesan kendala.
Penyebab:
- n8n AI Agent mengirim request dengan format OpenAI Chat Completion yang memuat `role: "system"` dan array `tools`.
- Sebelumnya provider GEMINI diarahkan ke endpoint OpenAI-compatibility Google (`/v1beta/openai`), yang tidak sepenuhnya kompatibel dengan pemanggilan fungsi (*function calling*) dan skema tools yang dikirim oleh agent LangChain n8n.
- Gemini 2.5 Flash memiliki mekanisme *internal thinking* yang membutuhkan alokasi token output memadai (minimal 4096 token) agar tidak terpotong dengan `finishReason: "MAX_TOKENS"`.

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/src/lib/llm-gateway/gemini.ts` | Baru | Adapter REST API resmi Gemini (`models/${model}:generateContent`):<br/>1. **`systemInstruction`**: Mengekstrak pesan `role: "system"` ke properti `systemInstruction.parts[{ text }]` terpisah, dan memastikan `contents` hanya berisi role `user` dan `model`.<br/>2. **Konversi `tools`**: Menerjemahkan array `tools` OpenAI ke format `tools[0].functionDeclarations` standar Gemini.<br/>3. **Riwayat Tool Response**: Mengonversi `role: "tool"` ke role `user` dengan objek `functionResponse`.<br/>4. **Normalisasi Respons**: Memetakan balasan `functionCall` Gemini ke OpenAI-spec `tool_calls` dengan `finish_reason: "tool_calls"`, dan balasan teks ke `choices[0].message.content`.<br/>5. **Alokasi Token Aman**: Memastikan `maxOutputTokens` minimal 4096 agar alokasi *thinking tokens* Gemini 2.5 Flash tidak memotong pesan balasan. |
| `dashboard/src/lib/llm-gateway/index.ts` | Modifikasi | Menghubungkan router LLM Gateway ke adapter `callGemini` dan `geminiToOpenAi` saat `provider === "GEMINI"`. |
| `dashboard/tests/unit/gemini-adapter.test.ts` | Baru | 8 skenario pengujian unit Vitest mencakup ekstraksi `systemInstruction`, konversi `tools`, riwayat function response, normalisasi output teks/functionCall, dan pemetaan URL pemanggilan jaringan. |
| `updates.md` | Modifikasi | Pencatatan kronologis perbaikan adapter Gemini 2.5 Flash. |

### 3. Hasil Verifikasi
1. **Uji Langsung Sapaan Murni (cURL):**
   - Request pesan dengan `role: "system"` dan `role: "user": "hi botseri"`.
   - Gemini mengembalikan balasan teks ramah: `"Halo! Ada yang bisa saya bantu?"` dengan `finish_reason: "stop"` (HTTP 200 OK).
2. **Uji Langsung Function Calling (cURL):**
   - Request dengan pesan "Tolong jadwalkan jemur baju besok jam 8 pagi" dan skema `tool_create_todo_and_order`.
   - Gemini 2.5 Flash secara akurat mengembalikan `finish_reason: "tool_calls"` dengan argumen:
     `{"title":"jemur baju","due_at":"2026-10-28T08:00:00+07:00"}`.
3. **Uji Langsung Sintesis Balasan Akhir (cURL):**
   - Meneruskan hasil tool eksekusi kembali ke Gemini:
   - Gemini menghasilkan balasan konfirmasi manusiawi: `"Baik, \"jemur baju\" sudah dijadwalkan untuk besok jam 8 pagi. Ada lagi yang bisa saya bantu?"`.
4. **Unit Test Suite:** 21 test file, **174 test cases** lulus 100% (termasuk 8 tes baru di `gemini-adapter.test.ts`).
5. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
6. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
7. **Antislop R-02:** 0 karakter em dash pada seluruh berkas yang disentuh.

---

## [2026-10-27] Fix Gemini FunctionDeclaration Schema Sanitization ($schema & additionalProperties Removal)

### 1. Investigasi Akar Masalah
Saat agent n8n (LangChain) mengirim request chat masuk, skema tools yang dihasilkan memuat kata kunci standar JSON Schema draft-07 seperti `$schema: "http://json-schema.org/draft-07/schema#"`, `title: "..."`, dan `additionalProperties: false`.
Google Gemini REST API (`generateContent`) hanya mendukung subset OpenAPI 3.0 terbatas untuk `functionDeclarations.parameters`, dan secara ketat menolak request jika skema memuat properti yang tidak dikenali (`Invalid JSON payload received... unknown field 'additionalProperties' / '$schema'`).

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/src/lib/llm-gateway/gemini.ts` | Modifikasi | Menambahkan fungsi rekursif `cleanGeminiSchema` untuk membersihkan field terlarang (`$schema`, `additionalProperties`, `title`, `$id`, `$comment`, `definitions`, `$defs`) dari tingkat akar, nested `properties`, dan array `items`. Memastikan `type: "object"` default terpasang jika tidak ada. |
| `dashboard/tests/unit/gemini-adapter.test.ts` | Modifikasi | Menambahkan 3 skenario tes unit baru untuk memverifikasi pembersihan field terlarang hingga ke level nested properties dan array items. |
| `updates.md` | Modifikasi | Pencatatan kronologis sanitasi skema tools Gemini. |

### 3. Hasil Verifikasi
1. **Uji Langsung cURL dengan Skema Terlarang:**
   - Request dengan skema memuat `$schema: "http://json-schema.org/draft-07/schema#"`, `title: "ToolCreateTodoAndOrderInput"`, dan `additionalProperties: false`.
   - Gemini API menerima payload tanpa error dan merespons sukses dengan HTTP 200 OK serta `tool_calls` terisi akurat.
2. **Uji Langsung Sapaan dengan Tools:**
   - Request sapaan "hi botseri" dengan tools terpasang merespons HTTP 200 OK dengan teks sapaan ramah.
3. **Unit Test Suite:** 21 test file, **177 test cases** lulus 100% (termasuk 3 tes baru sanitasi skema).
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.

---

## [2026-10-27] Task-Specific Due Alarm, Time Clarification Flow, & Out-of-Hours Gating Exemption

### 1. Investigasi Akar Masalah & Rekap Bukti Lapangan
Pengguna melaporkan: *"tugas pppl di 19:35, tolong ingatkan saya di 19:35"*. Tugas tersimpan di database pada pukul 12:32 UTC (19:32 WIB) dengan `due_at: 19:35 WIB`, namun pada pukul 19:35 maupun 19:37 tidak ada alarm yang terkirim.

Akar penyebab sistemik yang teridentifikasi:
1. **Absensi Mesin Evaluasi Alarm Spesifik**: Sebelumnya scheduler makro hanya mengevaluasi pemicu harian (`MORNING_BRIEF`, `WORK_HOURS_REMINDER`, `END_OF_DAY_EVAL`). Tidak ada mekanisme yang mencari to-do berjam pasti (`has_specific_time = true`) yang telah jatuh tempo.
2. **Gating Jam Kerja Memblokir Alarm**: Seluruh loop `tick` digate oleh `isWithinWindow(work_hours_start, work_hours_end)` dan `isWorkingDay`. Tugas yang jatuh tempo di luar jam kerja atau akhir pekan tidak pernah dievaluasi.
3. **Granularitas Cron 15 Menit**: Jadwal cron n8n sebelumnya adalah 15 menit, sehingga alarm dengan jam presisi tidak dapat terkirim tepat waktu.
4. **Premature Rollover EOD**: Evaluasi EOD pada jam akhir kerja (misal 17:00) menggulirkan semua to-do `planned_date <= today` ke besok, sehingga tugas malam (misal 19:35) sebelum waktunya tiba sudah diubah tanggal rencananya menjadi besok.
5. **Halusinasi Waktu LLM**: Ketika pengguna menyebutkan waktu relatif ("besok pagi", "setengah 8"), LLM kerap salah menghitung jam atau salah offset zona waktu.

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan field alarm pada model `Todo`: `reminded_at` (timestamptz), `reminder_claimed_at` (timestamptz), `reminder_attempts` (Int @default(0)), serta index gabungan `@@index([status, has_specific_time, due_at])`. |
| `dashboard/prisma/migrations/20261027160000_add_task_alarm_columns_to_todos/migration.sql` | Baru | Migrasi SQL DDL untuk penambahan kolom alarm dan pembuatan partial index di PostgreSQL. |
| `dashboard/src/lib/time/index.ts` | Modifikasi | Menambahkan resolver waktu deterministik `resolveTimeExpression` dengan slot konstanta `DAYPART_SLOTS` (PAGI 08:30 hari ini / 08:00 besok, SIANG 12:30, SORE 16:00, MALAM 19:30), margin 1 menit `MIN_FUTURE_MARGIN_MINUTES`, penanganan `half_before`, waktu ambigu AM/PM, serta `formatDueAtLocalText`. |
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Menambahkan fungsi klaim atomik `claimDueTaskAlarms` (`FOR UPDATE SKIP LOCKED`), logika murni `isAlarmDue`, fungsi format teks alarm deterministik `formatTaskAlarm` (membedakan tepat waktu vs terlambat), sanitasi teks WhatsApp `sanitizeTitleForWhatsapp`, dan isolasi anti-spam (cooldown 2 menit, max attempts 5, max lateness 12 jam). |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Mengevaluasi alarm spesifik `claimDueTaskAlarms` di luar gating jam kerja dan hari libur. Memperbaiki rollover EOD agar tidak menggulirkan tugas yang memiliki `due_at > now`. Menambahkan pembersihan otomatis `pruneOldTickEvents`. |
| `dashboard/src/app/api/internal/scheduler/jobs/[jobId]/result/route.ts` | Modifikasi | Menangani hasil eksekusi job `TASK_ALARM` (`alarm:<todo_id>:<attempt>`): mencatat `reminded_at` dan menghapus `reminder_claimed_at` saat `SENT`, mencatat `message_log` OUTBOUND, serta menangani status `FAILED` dengan pelepasan klaim. |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Mendukung `time_expression` dan `date_hint` pada pembuatan to-do baru, mengembalikan `due_at_local_text` dan bendera `needs_time`. |
| `dashboard/src/app/api/internal/tools/update-todo/route.ts` | Modifikasi | Mendukung `time_expression` dan `date_hint`, mereset state alarm jika `due_at` dimajukan ke masa depan, dan mengembalikan `due_at_local_text`. |
| `dashboard/src/app/api/internal/context/chat/route.ts` | Modifikasi | Menginjeksi `untimed_recent_todos` (tugas tanpa jam spesifik yang dibuat dalam 30 menit terakhir) ke dalam konteks `renderPrompt`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Menambahkan instruksi mode CHAT_MASUK untuk alur klarifikasi waktu ramah (satu gelembung, opsi mengabaikan), serta mendaftarkan placeholder `{{untimed_recent_todos}}`. |
| `dashboard/src/lib/llm-gateway/gemini.ts` | Modifikasi | Mendukung normalisasi tipe array JSON Schema (misal `["string", "null"]`) agar kompatibel dengan Gemini FunctionDeclaration. |
| `n8n-engine/workflows/botseri-scheduler.json` | Modifikasi | Mengubah frekuensi scheduleTrigger menjadi 1 menit, menambahkan node "Perlu LLM?" untuk bypass LLM pada job `TASK_ALARM` (`skip_llm: true`), dan mengonfigurasi `saveDataSuccessExecution: "none"`. |
| `dashboard/tests/unit/task-alarm.test.ts` | Baru | 20 skenario uji unit Vitest untuk `resolveTimeExpression`, `isAlarmDue`, dan `formatTaskAlarm`. |
| `updates.md` | Modifikasi | Pencatatan kronologis implementasi task alarm dan klarifikasi waktu. |

### 3. Hasil Verifikasi & Pengujian Lapangan
1. **Uji Klaim Alarm Tepat Waktu (Tick & DB):**
   - Tugas `[TEST-ALARM]` dengan `due_at` di masa depan: `jobs: []`, `reminder_attempts: 0`, `reminded_at: null`.
   - Saat jatuh tempo: `tick` langsung menghasilkan job `TASK_ALARM` dengan `skip_llm: true`, `job_id: "alarm:...:1"`, dan `fallback_text` terformat rapi.
   - Pelaporan `SENT` memperbarui `reminded_at` di DB dan mencatat `message_log` OUTBOUND.
   - Idempotensi terbukti: pemanggilan `tick` berikutnya tidak memicu duplikasi (`jobs: []`).
2. **Uji Pengecualian Jam Kerja (Out of Hours):**
   - Jam kerja diubah ke `09:00 - 17:00`, waktu pengujian `20:23 WIB` (di luar jam kerja).
   - Tugas `[TEST-ALARM-OOH]` tetap diklaim dan dikirim, sedangkan job makro (`MORNING_BRIEF`, `WORK_HOURS_REMINDER`) tetap diblokir.
3. **Uji Klarifikasi Waktu via WhatsApp Chat Inbound:**
   - Pesan "Saya harus bayar tagihan listrik" memanggil `tool_create_todo_and_order` dengan `has_specific_time: false` dan `needs_time: true`.
   - LLM membalas ramah dalam satu gelembung: *"Siap, tugas *Bayar tagihan listrik* sudah dicatat dengan prioritas Cashflow. Mau diingatkan jam berapa? (Boleh diabaikan jika tidak butuh alarm khusus, nanti tugas tetap masuk jadwal rutin harian)."*
   - Pengguna menjawab: *"besok jam 08:00 wib"*. LLM memanggil `tool_update_todo` untuk tugas terkait dan mengonfirmasi dengan mengutip `due_at_local_text` (*"Rabu, 28 Okt 2026, 08:00 WIB"*).
4. **Unit Test Suite:** 22 test file, **197 test cases** lulus 100% (termasuk 20 tes baru di `task-alarm.test.ts`).
5. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
6. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
7. **Workflow n8n:** `./scripts/validate-workflows.sh` lulus (2 file valid).
8. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-10-29] Strict Separation of Deadline (due_at) vs Reminder Alarm (remind_at) & Deterministic Dispatch

### 1. Investigasi Akar Masalah & Temuan Lapangan
1. **Kegagalan Intent LLM**: Ketika pengguna meminta *"oke ingatkan saya di 09:25 untuk mengerjakan tugas RPL2"*, LLM malah memanggil kueri pencarian to-do lama (`tool_get_prioritized_todos`) dan merespons *"Tugas RPL2 yang mana? Saya tidak bisa menemukan tugas tersebut"*.
2. **Ambiguitas Deadline vs Pengingat**: Sistem sebelumnya menyamakan jam alarm pengingat dengan batas akhir to-do (`due_at`). Akibatnya, waktu pengingat yang diminta pengguna keliru diartikan sebagai deadline penyelesaian.
3. **Absensi Kolom `remind_at`**: Tabel `todos` hanya memiliki `due_at` tanpa kolom waktu alarm terpisah, menyulitkan pembedaan antara tugas yang harus selesai pada jam tertentu vs tugas yang ingin diingatkan pada jam tertentu.

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan kolom `remind_at` (`DateTime? @db.Timestamptz`) pada model `Todo` serta index gabungan `@@index([status, reminded_at, remind_at])`. |
| `dashboard/prisma/migrations/20261029000000_separate_due_at_and_remind_at/migration.sql` | Baru | Migrasi SQL DDL untuk penambahan kolom `remind_at` dan pembuatan index di PostgreSQL. |
| `dashboard/src/lib/todos/create.ts` | Modifikasi | Menambahkan fungsi `resolveDueAndReminder` yang mengimplementasikan 4 aturan bisnis deterministik:<br/>• Kasus A (ada `due_at`, tanpa `remind_at`): otomatis menghitung `remind_at` 1 jam sebelum deadline.<br/>• Kasus B (ada `remind_at`, tanpa `due_at`): menyimpan `remind_at`, membiarkan `due_at: null`, dan `has_specific_time: true`.<br/>• Kasus C (ada `due_at` dan `remind_at`): menyimpan keduanya secara independen.<br/>• Kasus D (tanpa jam): `due_at: null`, `remind_at: null`, `has_specific_time: false`. |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Menerima dan menormalisasi parameter `remind_at` secara terpisah dari `due_at`, serta mengembalikan `remind_at` dan `remind_at_local_text`. |
| `dashboard/src/app/api/internal/tools/update-todo/route.ts` | Modifikasi | Mendukung pembaruan parameter `remind_at`, mereset status alarm jika waktu dimajukan, dan mengembalikan `remind_at` serta `remind_at_local_text`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Memperjelas instruksi sistem: permintaan pengingat ("ingatkan saya...", "jadwalkan...", "ada tugas...") wajib langsung membuat to-do baru lewat `tool_create_todo_and_order` tanpa bertanya to-do lama; membedakan parameter `due_at` (kata kunci: deadline, tenggat, selesai jam X) vs `remind_at` (kata kunci: ingatkan jam X). |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Menambahkan parameter `remind_at` pada deklarasi tool n8n `tool_create_todo_and_order` dan `tool_update_todo`. |
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Menambahkan fungsi `getPendingAlarms(now: Date)`, memperbarui `claimDueTaskAlarms` untuk mengevaluasi `remind_at` (dengan fallback `due_at`), memperbarui `isAlarmDue`, dan memperbarui `formatTaskAlarm` dengan format deterministik tanpa LLM:<br/>• Dengan `due_at`: `🔔 Pengingat: Tugas *${title}* mendekati batas waktu (Tenggat: ${time} · 1 jam lagi). Semangat tuntaskan ya!`<br/>• Hanya `remind_at`: `🔔 Pengingat: Waktunya mengerjakan *${title}* sekarang (${time}). Semangat!` |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Meneruskan `remind_at` ke `formatTaskAlarm` saat membuat job `TASK_ALARM`. |
| `dashboard/tests/unit/reminder-logic.test.ts` | Baru | 6 skenario uji unit Vitest untuk pemisahan `due_at` vs `remind_at` (Kasus A, B, C, D) dan perakitan teks alarm. |
| `dashboard/tests/unit/task-alarm.test.ts` | Modifikasi | Menyesuaikan ekspektasi pengujian `formatTaskAlarm` dengan template deterministik baru. |
| `updates.md` | Modifikasi | Pencatatan kronologis pemisahan deadline vs pengingat alarm. |

### 3. Hasil Verifikasi & Pengujian Lapangan
1. **Uji Kasus A/B/C/D & Format Teks (Vitest):**
   - Deadline jam 14:00 menghasilkan `remind_at` jam 13:00 (1 jam sebelumnya).
   - Permintaan pengingat jam 09:25 menghasilkan `remind_at: 09:25` dan `due_at: null`.
   - Seluruh 6 skenario di `reminder-logic.test.ts` lulus 100%.
2. **Uji Simulasi Scheduler Tick & Idempotensi (Live DB):**
   - To-do uji dengan `remind_at` 1 menit yang lalu menghasilkan job `TASK_ALARM`:
     `🔔 Pengingat: Waktunya mengerjakan *[TEST-REMIND] Mengerjakan tugas RPL2* sekarang (09:51). Semangat!`
   - Pelaporan `SENT` memperbarui `reminded_at` di PostgreSQL.
   - Pemanggilan `tick()` kedua kali mengembalikan `jobs: []` (idempoten, tidak ada duplikasi).
3. **Uji Format Alarm Mendekati Deadline (Live DB):**
   - To-do dengan deadline 1 jam ke depan menghasilkan teks:
     `🔔 Pengingat: Tugas *[TEST-DUE] Submit Laporan Akhir* mendekati batas waktu (Tenggat: 10:53 · 1 jam lagi). Semangat tuntaskan ya!`
4. **Uji Percakapan WhatsApp Inbound:**
   - Chat: *"oke ingatkan saya di 09:40 untuk mengerjakan tugas RPL2"*.
   - LLM langsung memanggil `tool_create_todo_and_order` dengan `title: "Mengerjakan tugas RPL2"` dan `remind_at: "2026-10-29T09:40:00+07:00"` (tanpa bertanya to-do lama).
   - Backend merespons dengan `remind_at: "2026-10-29T09:40:00+07:00"` dan `due_at: null`.
   - Konfirmasi bot dalam satu gelembung ramah: *"Baik, sudah dicatat ✅\n*Mengerjakan tugas RPL2* akan diingatkan pada Kamis, 29 Okt 2026, 09:40 WIB (prioritas Kritis). Jangan sampai terlewat lagi."*
   - Pada siklus scheduler, job `TASK_ALARM` otomatis dibuat dan dikirim ke nomor WhatsApp pemilik.
5. **Unit Test Suite:** 23 test file, **203 test cases** lulus 100%.
6. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
7. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
8. **Workflow n8n:** `./scripts/validate-workflows.sh` lulus (2 file valid).
9. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-10-29] Critical Hotfix: Bypass LLM Node for TASK_ALARM in Scheduler & Fix JOB_SEND_FAILED

### 1. Investigasi Akar Masalah & Temuan Lapangan
1. **JOB_SEND_FAILED di System Events**: Scheduler mencatat error `JOB_SEND_FAILED` dengan rincian `400 Bad Request` dari `/api/internal/waha/send`:
   `{"fieldErrors":{"trigger_type":["Invalid option: expected one of \"CHAT_MASUK\"|\"MORNING_BRIEF\"|\"WORK_HOURS_REMINDER\"|\"END_OF_DAY_EVAL\"|\"PAIRING\""]}}`.
   Penyebab: `http-send` di n8n mengirimkan `trigger_type: job.job_type` (`TASK_ALARM`), yang belum terdaftar di enum skema `triggers` pada endpoint `waha/send`.
2. **Tracing Plugin n8n (N8nLlmTracing)**: Log container n8n menunjukkan `Error in handler N8nLlmTracing, handleLLMStart: TypeError: fetch failed` saat job alarm dievaluasi oleh node LangChain/LLM.
3. **Normalisasi Chat ID**: Pengiriman ke WAHA NOWEB memerlukan target berakhiran `@c.us` dengan format digit murni (bukan format JID `@lid` atau format dengan simbol `+`).

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `n8n-engine/workflows/botseri-scheduler.json` | Modifikasi | Merombak total percabangan workflow scheduler: job bertipe `TASK_ALARM` (atau `skip_llm: true`) langsung dialihkan ke node `Kirim WhatsApp Alarm` (`POST /api/internal/waha/send`) tanpa menyentuh node LLM atau LangChain. Mengirimkan parameter `trigger_type: 'WORK_HOURS_REMINDER'`, `chat_id: $json.target_chat_id \|\| $json.chat_id`, dan `body: $json.body \|\| $json.fallback_text`. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Menambahkan `"TASK_ALARM"` ke dalam daftar opsi `triggers` Zod schema agar request dengan trigger_type tersebut tetap sah (HTTP 200). Memperbaiki `normalizeChatId` agar membuang simbol non-digit pada nomor telepon dan otomatis mengonversi `@lid` ke format `@c.us` berdasarkan data `authorized_numbers`. |
| `dashboard/src/lib/waha/humanizer.ts` | Modifikasi | Memperkuat validasi penerima `validateRecipient` agar mencocokkan nomor telepon secara defensif (baik dengan awalan `+`, tanpa awalan, maupun format `@c.us`). |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Memperbarui pembuatan job `TASK_ALARM` pada `tick` agar selalu menyediakan properti `chat_id`, `target_chat_id` (format `digits@c.us`), `body`, dan `fallback_text` yang siap dikirim langsung oleh n8n. |
| `updates.md` | Modifikasi | Pencatatan kronologis perbaikan bypass LLM untuk task alarm dan perbaikan `JOB_SEND_FAILED`. |

### 3. Hasil Verifikasi & Pengujian Lapangan
1. **Uji Langsung Endpoint WAHA Send (cURL):**
   - Request dengan `trigger_type: "TASK_ALARM"` dan `chat_id: "6287881820571@c.us"` berhasil dikirim dengan HTTP 200 OK (`message_id: c0150192-...`, status: PENDING).
2. **Uji End-to-End Scheduler Cron & WAHA:**
   - Memasukkan to-do uji `[HOTFIX-TEST] Mengerjakan laporan darurat` dengan `remind_at = now() - interval '10 seconds'`.
   - Cron 1 menit n8n memproses alarm melalui jalur direct bypass (`Apakah Alarm? -> Kirim WhatsApp Alarm -> Status Hasil Alarm -> Lapor Hasil`).
   - `todos.reminded_at` terisi `2026-10-29 03:29:50.337+00`, `reminder_attempts: 1`, `reminder_claimed_at: null`.
   - Pesan OUTBOUND tercatat di `message_log` secara otomatis.
   - Event `TICK_OK` tercatat bersih di `system_events` tanpa ada error `JOB_SEND_FAILED` maupun `N8nLlmTracing`.
3. **Unit Test Suite:** 23 test file, **203 test cases** lulus 100%.
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
6. **Workflow n8n:** `./scripts/validate-workflows.sh` lulus (2 file valid).
7. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-10-29] Bugfix: Eliminate Hardcoded "1 Jam Lagi" & Enforce Strict remind_at vs due_at Semantics

### 1. Investigasi Akar Masalah & Temuan Lapangan
Pengguna melaporkan: *"ingatkan saya di jam 10:35 ada meeting pppl"*, namun bot mengirim pesan:
`"🔔 Pengingat: Tugas Meeting PPPL mendekati batas waktu (Tenggat: 10:35 · 1 jam lagi). Semangat tuntaskan ya!"`.

Dua akar masalah:
1. **Penyimpangan Pemetaan Input LLM**: Permintaan agenda/pengingat jam tertentu dipetakan LLM ke `due_at` (tenggat) bukan `remind_at`.
2. **Hardcoded String di Generator Alarm**: Generator pesan mencantumkan string statis `"· 1 jam lagi"` setiap kali `due_at` ada tanpa menghitung selisih waktu riil secara dinamis terhadap waktu eksekusi (`now`).

### 2. Perbaikan yang Diterapkan

| Path Berkas | Status | Deskripsi Perbaikan |
|---|---|---|
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Menghapus string statis `"· 1 jam lagi"`. Rangkai pesan pengingat berdasarkan konteks waktu riil:<br/>• Jika `due_at` dan `remind_at` ada serta `due_at > remind_at`: hitung selisih menit matematis `(due_at - now) / 60000`, lalu tampilkan `Tenggat: ${time} · ${diffMinutes} menit lagi`.<br/>• Jika hanya `due_at`: tampilkan `🔔 Pengingat: Batas waktu tugas *${title}* tiba sekarang (${time}).`.<br/>• Jika hanya `remind_at` (agenda/pengingat): tampilkan `🔔 Pengingat: Waktunya *${title}* sekarang (${time}). Semangat!`. Menambahkan suffix zona waktu otomatis (WIB/WITA/WIT). |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Memastikan payload dengan `remind_at` tanpa `due_at` disimpan dengan `due_at: null` dan `has_specific_time: true`. Menambahkan properti `time_label` pada respons konfirmasi: menggunakan frasa `"Pengingat: [Waktu]"` jika hanya ada `remind_at`, dan `"Tenggat: [Waktu]"` jika ada `due_at`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Mengetatkan instruksi sistem: permintaan pengingat/agenda ('ingatkan saya jam 10:35 ada meeting', 'ingatkan jam 2 siang...') WAJIB dikirim sebagai `remind_at` dan `due_at: null`. HANYA isi `due_at` jika pengguna eksplisit menyebut kata 'deadline', 'tenggat', atau 'paling lambat jam X'. Konfirmasi balik wajib menggunakan 'Pengingat: [Waktu]' (dilarang menggunakan kata 'Tenggat' jika bukan deadline). |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Memperjelas deskripsi parameter `due_at` dan `remind_at` pada deklarasi tool n8n agar LLM tidak keliru memetakan jam pengingat ke due_at. |
| `dashboard/tests/unit/scheduler-message.test.ts` | Baru | 5 skenario uji unit Vitest untuk memastikan perakitan pesan alarm deterministik: to-do hanya remind_at menghasilkan format `(10:35 WIB)` tanpa kata Tenggat dan tanpa 1 jam lagi; to-do due_at menghasilkan selisih menit terhitung dinamis ("60 menit lagi", "15 menit lagi"); sanitasi format WhatsApp; dan nol karakter em dash. |
| `dashboard/tests/unit/reminder-logic.test.ts` | Modifikasi | Menyesuaikan ekspektasi teks pengujian dengan format dinamis baru dan suffix WIB. |
| `dashboard/tests/unit/task-alarm.test.ts` | Modifikasi | Menyesuaikan ekspektasi teks pengujian dengan format dinamis baru dan suffix WIB. |
| `updates.md` | Modifikasi | Pencatatan kronologis penghapusan hardcoded 1 jam lagi dan pengetatan semantik remind_at vs due_at. |

### 3. Hasil Verifikasi & Pengujian Lapangan
1. **Unit Test String Builder (Vitest):**
   - To-do dengan `remind_at = 10:35 WIB` menghasilkan:
     `🔔 Pengingat: Waktunya *Meeting PPPL* sekarang (10:35 WIB). Semangat!` (tanpa kata Tenggat, tanpa 1 jam lagi).
   - To-do dengan `due_at = 11:35 WIB` dan `remind_at = 10:35 WIB` menghasilkan:
     `🔔 Pengingat: Tugas *Tugas PPPL* mendekati batas waktu (Tenggat: 11:35 WIB · 60 menit lagi). Semangat tuntaskan ya!`.
   - Seluruh 5 pengujian di `scheduler-message.test.ts` lulus 100%.
2. **Uji Langsung Percakapan & Ekstraksi Tool (Live LLM):**
   - Chat: *"ingatkan saya di jam 13:40 ada evaluasi tim"*.
   - LLM secara akurat mengekstrak: `title: "Evaluasi tim"`, `remind_at: "2026-10-29T13:40:00+07:00"`, `due_at: null`.
   - Respons konfirmasi bot: *"Siap, sudah dicatat ✅\n• Evaluasi tim · Pengingat: Kamis, 29 Okt 2026, 13:40 WIB (prioritas Kritis)"* (tanpa kata "Tenggat").
3. **Uji Pengiriman Alarm Riil Saat Waktu Tiba (Live DB & Cron):**
   - Saat jam pengingat tiba, scheduler cron n8n mengeksekusi alarm tanpa LLM dan mencatat pesan OUTBOUND di `message_log`:
     `🔔 Pengingat: Waktunya *Evaluasi tim* sekarang (13:25 WIB). Semangat!`
4. **Unit Test Suite:** 24 test file, **208 test cases** lulus 100%.
5. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
6. **Smoke Test:** `./scripts/smoke.sh` lulus 8/8 PASS.
7. **Workflow n8n:** `./scripts/validate-workflows.sh` lulus (2 file valid).
8. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-02] Allow Customer Outbound Messages in /api/internal/waha/send & Add CUSTOMER_REPLY Trigger

### 1. Ringkasan Perbaikan
Mengatasi kendala pemblokiran balasan pesan bot ke nomor pelanggan baru (`UNAUTHORIZED_RECIPIENT` / HTTP 403):
- **Akar Masalah:**
  - Endpoint `/api/internal/waha/send` dan modul `dashboard/src/lib/waha/humanizer.ts` sebelumnya memvalidasi nomor penerima secara ketat hanya pada tabel `authorized_numbers`.
  - Akibatnya, pengiriman balasan ke nomor pelanggan yang terdaftar di `customer_sessions` ditolak dengan kode `UNAUTHORIZED_RECIPIENT`.
- **Solusi yang Diterapkan:**
  - Pada `dashboard/src/app/api/internal/waha/send/route.ts`:
    - Menambahkan pengecekan `customerSession.findUnique` jika nomor tujuan tidak terdaftar di `authorized_numbers`.
    - Pengiriman diizinkan bila nomor terdaftar di salah satu dari `authorized_numbers` atau `customer_sessions`.
    - Jika nomor tidak ada di kedua tabel, mengembalikan respons HTTP 403: `"Nomor tujuan tidak terdaftar di authorized_numbers maupun customer_sessions"`.
    - Menambahkan nilai `'CUSTOMER_REPLY'` ke daftar enum Zod `triggers`.
  - Pada `dashboard/src/lib/waha/humanizer.ts`:
    - Memperbarui fungsi `validateRecipient` agar turut mengecek tabel `customer_sessions` sebelum melemparkan `HumanizerError('UNAUTHORIZED_RECIPIENT', 403)`.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Menambahkan verifikasi `customer_sessions`, pesan error komprehensif, dan trigger `CUSTOMER_REPLY`. |
| `dashboard/src/lib/waha/humanizer.ts` | Modifikasi | Memperbarui `validateRecipient` agar mengizinkan nomor yang terdaftar di `customer_sessions`. |
| `dashboard/tests/unit/waha-send-route.test.ts` | Modifikasi | Menambahkan unit test untuk pengiriman ke nomor customer session dan verifikasi penolakan nomor tak terdaftar. |
| `updates.md` | Modifikasi | Pencatatan kronologis perbaikan customer outbound routing. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 26 test file, **256 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** Bebas em dash.

---

## [2026-11-02] Tool Get Orders for Owner & Instant WhatsApp Alert for New Incoming Orders

### 1. Ringkasan Fitur & Perbaikan
1. **Tool Get Orders (`tool_get_orders`):**
   - Menambahkan endpoint internal `dashboard/src/app/api/internal/tools/get-orders/route.ts` yang mendukung `GET` dan `POST`.
   - Mengambil daftar pesanan aktif dari tabel `orders` terurut `event_date ASC`, diformat ke zona waktu lokal `Asia/Jakarta`, lengkap dengan ekstraksi `delivery_time` dan `special_notes`.
   - Mendaftarkan sub-node tool `@n8n/n8n-nodes-langchain.toolHttpRequest` bernama `tool_get_orders` di workflow n8n `botseri-inbound-agent.json` dan menghubungkannya ke `ai_tool` pada AI Agent.
2. **Pertahanan Ganda pada `tool_get_prioritized_todos`:**
   - Menyertakan ringkasan `upcoming_orders` di samping to-do aktif agar saat agen LLM memeriksa agenda hari ini, data pesanan pelanggan tetap tampak dan terbaca.
3. **Notifikasi Alert Pesanan Baru ke Owner:**
   - Memperbaiki `dashboard/src/app/api/internal/customer/handle/route.ts` saat pesanan berhasil disimpan (`PROCESS_ORDER`) untuk menghasilkan dua pesan:
     1. Konfirmasi pesanan ke pelanggan (`trigger_type: "CUSTOMER_REPLY"`).
     2. Pesan alert instan ke Owner Utama (`trigger_type: "NEW_ORDER_ALERT"`) memuat nama pemesan, rincian pesanan, tanggal/jam acara, lokasi, dan status pembayaran.
   - Fungsi helper `getPrimaryOwner()` dilengkapi mekanisme auto-healing: jika belum ada nomor dengan `is_primary: true`, sistem secara otomatis mempromosikan nomor owner terbaru menjadi primary.
4. **Penanganan Anti-429 & Batching WAHA:**
   - Menambahkan trigger `'NEW_ORDER_ALERT'` pada enum Zod `dashboard/src/app/api/internal/waha/send/route.ts` dan membebaskannya dari blokir penerima.
   - Mengaktifkan opsi batching pada node `Kirim WhatsApp` di n8n dengan `batchInterval: 2500` ms (jeda 2.5 detik) agar pesan konfirmasi pelanggan dan alert owner tidak saling tumpang-tindih.
5. **Penyelarasan Prompt Sistem (`base.id.md`):**
   - Menambahkan aturan nomor 7 pada instruksi `CHAT_MASUK`: saat pemilik menanyakan pesanan pelanggan, WAJIB memanggil `tool_get_orders` dan dilarang hanya memanggil `tool_get_prioritized_todos`. Format balasan dalam satu balon chat (Single-Bubble).

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/tools/get-orders/route.ts` | Baru | Endpoint internal `tool_get_orders` (GET & POST) dengan format tanggal Indonesia dan ekstraksi detail catatan. |
| `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts` | Modifikasi | Menyertakan kueri dan properti `upcoming_orders` pada response payload to-do. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Helper auto-healing `getPrimaryOwner` dan pembuatan 2 pesan (klien + alert owner) saat pesanan baru tercatat. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Menambahkan enum trigger `NEW_ORDER_ALERT` dan bypass verifikasi untuk alert owner. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Instruksi sistem kewajiban pemanggilan `tool_get_orders` dan penyajian Single-Bubble. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Sub-node `tool_get_orders` terhubung ke AI Agent, pembacaan payload fleksibel, dan batching 2500ms di `Kirim WhatsApp`. |
| `dashboard/tests/unit/get-orders-route.test.ts` | Baru | 3 skenario tes unit untuk endpoint `get-orders` (auth, empty state, format data). |
| `dashboard/tests/unit/customer-handle.test.ts` | Modifikasi | Pengujian 2 balasan pada pembuatan order dan auto-healing primary owner. |
| `dashboard/tests/unit/waha-send-route.test.ts` | Modifikasi | Pengujian pengiriman dengan trigger `NEW_ORDER_ALERT`. |
| `updates.md` | Modifikasi | Dokumentasi kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 27 test file, **261 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Validasi n8n Workflow:** JSON parsing valid, seluruh relasi node konsisten.
4. **Antislop R-02:** Bebas em dash pada seluruh berkas.

---

## [2026-11-02] Segmented Orders Response (Today vs Upcoming) & Guaranteed Owner Order Alert

### 1. Ringkasan Perbaikan & Fitur
Mengatasi kendala penyaringan tanggal literal oleh LLM dan kegagalan alert pesanan baru ke WhatsApp owner:
1. **Segmentasi Respons `get-orders` (`orders_today` vs `upcoming_orders`):**
   - Pada `dashboard/src/app/api/internal/tools/get-orders/route.ts`:
     - Menggunakan `localDayUtcBounds` untuk membagi pesanan aktif secara presisi ke dalam dua kelompok:
       - `orders_today`: Pesanan dengan `event_date` hari ini (00:00:00 sampai 23:59:59 WIB).
       - `upcoming_orders`: Pesanan dengan `event_date` setelah hari ini (maksimal 10 pesanan terdekat).
     - Menghasilkan field `today_count`, `upcoming_count`, `total_active`, `orders_today[]`, dan `upcoming_orders[]`.
     - Format `payment_status` manusiawi: `"Belum dibayar"` untuk `UNPAID`, `"DP dibayar"` untuk `DP_PAID`, dan `"Lunas"` untuk `PAID`.
     - Menyediakan properti `event_date_formatted` dan `event_date` untuk kejelasan tampilan LLM.
2. **Penyelarasan Prompt Sistem (`base.id.md`):**
   - Menambahkan petunjuk tegas: jika `orders_today` kosong, asisten wajib menyatakan jadwal hari ini kosong lalu WAJIB menyebutkan pesanan aktif dari `upcoming_orders` (nama pemesan, jenis layanan, tanggal acara, status bayar).
   - Melarang keras membalas "Belum ada pesanan masuk" jika terdapat pesanan di `upcoming_orders`.
3. **Jaminan Pengiriman Alert Pesanan Baru (`customer/handle/route.ts`):**
   - Menghapus syarat kaku pada helper `getPrimaryOwner`: jika tidak ada nomor dengan `is_primary: true`, sistem mengambil nomor pertama di `authorized_numbers` berdasarkan `created_at ASC` dan otomatis menjadikannya primary (`is_primary: true`).
   - Menghasilkan 2 pesan terstruktur: konfirmasi pelanggan (`CUSTOMER_REPLY`) dan alert owner (`NEW_ORDER_ALERT`).
4. **Verifikasi Pemetaan Workflow n8n (`botseri-inbound-agent.json`):**
   - Memastikan node `Format WAHA ChatId` dan `Kirim WhatsApp` memetakan `$json.chat_id` dan `$json.phone_e164` secara independen untuk tiap item hasil split out, tanpa fallback keliru ke chat pengirim pesan masuk.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/tools/get-orders/route.ts` | Modifikasi | Menambahkan segmentasi `orders_today` dan `upcoming_orders`, perbaikan format status bayar dan tanggal. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Panduan sintesis Single-Bubble untuk pesanan hari ini dan pesanan mendatang. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Helper `getPrimaryOwner` tanpa syarat kaku dan format alert pesanan baru. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Pemetaan independen chat_id, phone_e164, to, body, dan trigger_type pada Format WAHA ChatId. |
| `dashboard/tests/unit/get-orders-route.test.ts` | Modifikasi | Pengujian struktur segmentasi `today_count`, `upcoming_count`, `orders_today`, dan `upcoming_orders`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 27 test file, **261 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Validasi n8n Workflow:** JSON parsing valid, seluruh graph node terhubung akurat.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-02] Tool Update Order (Complete/Delete) & Fix Silent Customer Order Submission Failure

### 1. Ringkasan Perbaikan & Fitur
Mengatasi kendala ketiadaan tool untuk menandai pesanan selesai/hapus dan memastikan pelanggan selalu menerima balasan konfirmasi:
1. **Tool Pembaruan/Penghapusan Pesanan (`tool_update_order`):**
   - Membuat endpoint internal `dashboard/src/app/api/internal/tools/update-order/route.ts` (POST):
     - Menerima `order_id` (format `#ORD-504D0BA0`, `504D0BA0`, atau nama pemesan), `action` (`COMPLETE`, `DELETE`, `CANCEL`), dan `notes`.
     - Membersihkan prefix `#ORD-` dan mencari pesanan secara akurat menggunakan PostgreSQL query prefix matching (`id::text ILIKE`).
     - Aksi `COMPLETE`: Memperbarui status pembayaran menjadi `PAID` dan menambahkan `[STATUS: SELESAI]` ke `notes`.
     - Aksi `DELETE` / `CANCEL`: Menghapus baris pesanan dari database.
   - Menambahkan sub-node `@n8n/n8n-nodes-langchain.toolHttpRequest` bernama `tool_update_order` di `n8n-engine/workflows/botseri-inbound-agent.json` terhubung ke port `ai_tool` pada AI Agent.
2. **Pemisahan Tegas To-Do vs Pesanan di Prompt Sistem (`base.id.md`):**
   - Menambahkan aturan nomor 5: saat pengguna menyebut 'pesanan', 'order', atau ID '#ORD-', agen WAJIB memanggil `tool_get_orders` (untuk melihat) atau `tool_update_order` (untuk selesai/hapus). Melarang keras memanggil `tool_update_todo_status` untuk pesanan pelanggan.
3. **Pembersihan Teks Pesanan Pelanggan (`orderFormat.ts`):**
   - Menghapus teks pengantar sebelum `*FORMAT PESANAN BERSERI*` dan teks petunjuk footer (seperti "_Salin dan isi format di atas..._") agar tidak mengacaukan field `request_khusus` atau membingungkan parser.
4. **Jaminan Balasan Pelanggan (Defensive Owner Alert):**
   - Membungkus persiapan alert WhatsApp owner dalam blok `try / catch` mandiri di `customer/handle/route.ts` agar jika pencarian owner gagal, pesan konfirmasi pesanan pelanggan tetap terkirim tanpa melempar HTTP 500.
5. **Penyelarasan Node n8n (`Format WAHA ChatId`):**
   - Memperbarui kode JavaScript pada node `Format WAHA ChatId` menggunakan `$input.all()` untuk memetakan seluruh item hasil split out secara aman.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Baru | Endpoint internal `tool_update_order` untuk menandai selesai/lunas atau menghapus pesanan. |
| `dashboard/src/lib/customer/orderFormat.ts` | Modifikasi | Sanitasi teks intro dan footer template bot saat pelanggan menyalin form. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Defensive try/catch pada alert owner agar balasan konfirmasi pelanggan tidak pernah terblokir. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Penegasan pemisahan eksekusi tool To-Do vs Orders pada aturan nomor 5. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Sub-node `tool_update_order` terhubung ke AI Agent dan perbaikan `$input.all()` pada Format WAHA ChatId. |
| `dashboard/tests/unit/update-order-route.test.ts` | Baru | 5 skenario pengujian unit untuk endpoint `update-order` (auth, validation, 404, complete, delete). |
| `dashboard/tests/unit/customer-core.test.ts` | Modifikasi | Pengujian unit ekstraksi form pesanan yang memuat teks intro dan footer. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 28 test file, **267 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Validasi n8n Workflow:** JSON parsing valid, seluruh graph node terhubung akurat.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-02] Active Order Bot Mute Policy & Customer Session Unmute Integration

### 1. Ringkasan Perbaikan & Fitur
Mengeliminasi interupsi bot pasca-pesanan dan menyelesaikan integrasi pelepasan kunci sesi pelanggan:
1. **Active Order Bot Mute Policy di Inbound Gate (`inbound/accept/route.ts`):**
   - Saat pesan masuk dari nomor non-owner, sistem memeriksa apakah nomor tersebut memiliki pesanan aktif di tabel `orders` yang belum berstatus `[STATUS: SELESAI]`.
   - Jika pesanan aktif ditemukan, endpoint mengembalikan `{ accept: false, reason: "ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED" }`.
   - Efek di n8n: Alur langsung dibelokkan ke "Selesai Tanpa Balasan", bot diam 100% sehingga interaksi pelanggan dengan Admin Berseri berjalan lancar tanpa interupsi menu bot.
2. **Pelepasan Kunci Bot Otomatis Saat Pesanan Selesai / Dihapus (`update-order/route.ts`):**
   - Saat owner menandai pesanan selesai (`action: "COMPLETE"`) atau menghapus pesanan (`action: "DELETE"` / `"CANCEL"`), sistem secara otomatis mengupdate `customer_sessions` nomor pelanggan terkait (`state: "ACTIVE"`, `paused_at: null`).
   - Format respons `COMPLETE` menyertakan konfirmasi unmuting: `"Pesanan #ORD-XXXX (Nama) telah ditandai selesai dan lunas. Bot di-unmute untuk nomor pelanggan ini."`
3. **Penyelarasan Prompt Sistem (`base.id.md`):**
   - Mempertegas instruksi aturan nomor 5: saat owner meminta selesaikan/hapus pesanan, agen WAJIB memanggil `tool_update_order` dan mengonfirmasi dalam Single-Bubble WhatsApp.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Implementasi Active Order Bot Mute Policy (`ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED`). |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Pelepasan kunci bot di `customer_sessions` dan format pesan selesai/unmute. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Penegasan aturan pemanggilan `tool_update_order` pada prompt instruksi sistem. |
| `dashboard/tests/unit/inbound-accept.test.ts` | Modifikasi | Penambahan pengujian unit Active Order Bot Mute Policy. |
| `dashboard/tests/unit/update-order-route.test.ts` | Modifikasi | Pengujian unit pelepasan kunci `customerSession.updateMany` saat pesanan selesai. |
| `updates.md` | Modifikasi | Pencatatan kronologis pembaruan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 28 test file, **268 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Validasi n8n Workflow:** JSON parsing valid, relasi node konsisten.
4. **Antislop R-02:** Bebas em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-02] Strict Separation of Order Operational Status vs Payment Status

### 1. Ringkasan Perbaikan & Fitur
Membangun pemisahan resmi antara status operasional (pengerjaan/pengiriman) dan status pembayaran (finansial) pada seluruh lapisan sistem:
1. **Skema Database & Migrasi Forward-Only (`schema.prisma` & SQL Migration):**
   - Menambahkan enum baru `OrderStatus` (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`).
   - Menambahkan kolom `status OrderStatus @default(PENDING)` dan `completed_at DateTime? @db.Timestamptz` pada model `Order`.
   - Menambahkan indeks database `@@index([status])` dan `@@index([customer_contact])`.
   - Membuat file migrasi forward-only `20261102100000_add_order_operational_status/migration.sql` lengkap dengan backfill data pesanan selesai.
2. **Inbound Gate Bot Mute Refactoring (`inbound/accept/route.ts`):**
   - Menggantikan pengecekan string kotor pada `notes` dengan kueri enum status deterministik: pesanan dianggap aktif jika `status` bernilai `PENDING` atau `IN_PROGRESS`.
   - Nomor pelanggan yang seluruh pesanannya sudah `COMPLETED` atau `CANCELLED` otomatis kembali dapat berinteraksi dengan bot.
3. **Refactoring Tool Update Order (`update-order/route.ts`):**
   - Memisahkan mutasi operasional dan finansial melalui 7 aksi eksplisit:
     - `MARK_COMPLETED`: Menandai operasional selesai dan unmuting bot.
     - `MARK_IN_PROGRESS`: Menandai pengerjaan sedang berlangsung.
     - `MARK_PAID`: Menandai pembayaran lunas tanpa mengubah status operasional.
     - `MARK_DP`: Menandai pembayaran DP tanpa mengubah status operasional.
     - `COMPLETE_AND_PAY`: Menandai operasional selesai sekaligus pembayaran lunas.
     - `CANCEL`: Membatalkan pesanan dan unmuting bot.
     - `DELETE`: Menghapus baris pesanan dan unmuting bot.
4. **Penyesuaian Tool Get Orders (`get-orders/route.ts`):**
   - Menyaring kueri pesanan aktif hanya untuk `status` in `[PENDING, IN_PROGRESS]`.
   - Menyertakan label `operational_status` dan `payment_status` secara eksplisit pada respons JSON.
5. **Penyelarasan Prompt Sistem (`base.id.md`):**
   - Panduan eksplisit membedakan status operasional dan finansial, pemetaan pemanggilan aksi `tool_update_order`, dan format Single-Bubble WhatsApp.
6. **Dashboard UI & Orders API (`OrderBoard.tsx`, `api/orders/route.ts`, `api/orders/[id]/route.ts`):**
   - Menambahkan dropdown selektor dan badge visual utilitarian untuk Status Pengerjaan (PENDING outline netral, IN_PROGRESS terakota aksen, COMPLETED tinta pekat).
   - Mendukung mutasi PATCH kolom `status` pada endpoint `/api/orders/[id]`.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan enum `OrderStatus` dan kolom `status`, `completed_at` pada model `Order`. |
| `dashboard/prisma/migrations/20261102100000_add_order_operational_status/migration.sql` | Baru | Migrasi DDL forward-only untuk penambahan kolom status dan indeks. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Bot mute policy menggunakan kueri enum `status: { in: [PENDING, IN_PROGRESS] }`. |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Penanganan terpisah aksi status operasional vs pembayaran. |
| `dashboard/src/app/api/internal/tools/get-orders/route.ts` | Modifikasi | Filter status aktif dan penyertaan field `operational_status`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Instruksi sistem pemisahan status operasional vs pembayaran. |
| `dashboard/src/app/api/orders/route.ts` | Modifikasi | Dukungan field `status` pada skema create order. |
| `dashboard/src/app/api/orders/[id]/route.ts` | Modifikasi | Dukungan update PATCH kolom `status` dan `completed_at`. |
| `dashboard/src/app/(app)/orders/page.tsx` | Modifikasi | Meneruskan field `status` ke komponen `OrderBoard`. |
| `dashboard/src/app/(app)/orders/OrderBoard.tsx` | Modifikasi | Selektor dropdown dan badge visual Status Pengerjaan bersanding dengan Status Pembayaran. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Sinkronisasi aksi `tool_update_order` pada deklarasi tool n8n. |
| `dashboard/tests/unit/update-order-route.test.ts` | Modifikasi | Pengujian unit 7 aksi pembaruan status pesanan. |
| `dashboard/tests/unit/get-orders-route.test.ts` | Modifikasi | Pengujian field `operational_status` dan `payment_status`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 28 test file, **271 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Validasi n8n Workflow:** JSON parsing valid, seluruh koneksi tool konsisten.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-02] Visual Pipeline Studio & Modular Container Configurator (/pipeline) with Dynamic Runtime Execution

### 1. Ringkasan Fitur & Arsitektur
Mengabstraksikan seluruh aturan statis (hardcoded) alur kerja percakapan WhatsApp Botseri ke dalam sistem **Visual Pipeline Studio** modular dengan 6 kontainer yang terkonfigurasi dinamis di database PostgreSQL (`pipeline_configs`):
1. **Skema Database & Preset Engine (`schema.prisma`, `lib/pipeline/`):**
   - Menambahkan model `PipelineConfig` (`pipeline_configs`) dengan kolom `config_json` (JSONB), `preset_key`, dan `version`.
   - Membuat skema validasi Zod `PipelineConfigSchema` untuk 6 kontainer modular:
     1. `inbound_gate`: Pintu masuk, rate limiting per menit, allow unregistered customers, ignore groups, dan active order bot mute policy.
     2. `customer_greeting`: Teks sapaan T1, kata kunci order vs tanya-tanya, dan teks reminder T5.
     3. `order_form`: Template formulir T2, checkbox field wajib, awalan field kurang T6, dan toggle fallback AI LLM.
     4. `cs_handover`: Pesan handover T3, durasi jeda bot (pause TTL), saklar alert owner, dan template alert T7.
     5. `order_confirmation`: Template konfirmasi order T4, saklar alert pesanan baru owner, dan template alert pesanan baru.
     6. `owner_assistant`: Saklar alat operasional to-do, alat manajemen order, dan transkripsi voice note STT.
   - Menyediakan 3 Preset terkurasi siap pakai:
     - `FLORIST_DECOR` ("Bisnis Florist & Dekorasi (Default Berseri)")
     - `GENERIC_COMMERCE` ("UMKM Jasa & Retail Umum")
     - `PERSONAL_ASSISTANT` ("Asisten Produktivitas Pribadi · Tanpa CS Pelanggan")
2. **Dynamic Runtime Execution (`inbound/accept` & `customer/handle`):**
   - Rute masuk membaca konfigurasi aktif via `getActivePipelineConfig()`.
   - Kata kunci menu, template pesan (T1 s/d T7), validasi kelengkapan form, pembatasan kuota pesan, dan policy bot mute kini sepenuhnya dieksekusi dari konfigurasi pipeline aktif di database.
3. **API Manajemen Pipeline (`/api/pipeline`):**
   - `GET /api/pipeline`: Mengembalikan konfigurasi aktif beserta seluruh preset.
   - `PUT /api/pipeline`: Memperbarui konfigurasi pipeline, menaikkan version, menyinkronkan flag `enable_orders`, dan mencatat event audit `PIPELINE_UPDATED`.
   - `POST /api/pipeline/reset`: Mengembalikan konfigurasi ke salah satu preset yang dipilih.
4. **Halaman Visual Pipeline Studio (`/pipeline`):**
   - Tautan navigasi "Alur Kerja" di bilah menu `AppNav.tsx`.
   - Peta visual 6 kontainer terhubung hulu ke hilir dengan saklar on/off cepat dan pemilih preset.
   - Container Inspector & Editor lengkap dengan chip penyisip variabel cepat (`+ {{customer_name}}`, `+ {{order_id}}`, dsb.).
   - Live WhatsApp Bubble Preview real-time dengan simulasi balon chat WhatsApp untuk menguji tampilan pesan sebelum disimpan.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Menambahkan model `PipelineConfig` untuk tabel `pipeline_configs`. |
| `dashboard/prisma/migrations/20261102200000_add_pipeline_configs/migration.sql` | Baru | Migrasi DDL forward-only untuk tabel `pipeline_configs`. |
| `dashboard/src/lib/pipeline/schema.ts` | Baru | Skema validasi Zod untuk 6 kontainer pipeline modular. |
| `dashboard/src/lib/pipeline/presets.ts` | Baru | Preset siap pakai `FLORIST_DECOR`, `GENERIC_COMMERCE`, dan `PERSONAL_ASSISTANT`. |
| `dashboard/src/lib/pipeline/manager.ts` | Baru | Helper `getActivePipelineConfig` (auto-seed) dan `renderPipelineTemplate` (antislop). |
| `dashboard/src/app/api/pipeline/route.ts` | Baru | API handler GET dan PUT konfigurasi pipeline aktif terproteksi sesi admin. |
| `dashboard/src/app/api/pipeline/reset/route.ts` | Baru | API handler POST reset konfigurasi ke preset terpilih. |
| `dashboard/src/components/AppNav.tsx` | Modifikasi | Menambahkan link "Alur Kerja" (`/pipeline`) pada navigasi utama. |
| `dashboard/src/app/(app)/pipeline/page.tsx` | Baru | Server component halaman Studio Pipeline. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Baru | Antarmuka visual peta kontainer, inspector editor, chip variabel, dan Live WhatsApp Preview. |
| `dashboard/src/lib/customer/choice.ts` | Modifikasi | Mendukung kata kunci dinamis `order_trigger_keywords` dan `ask_trigger_keywords`. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Eksekusi runtime gate dinamis (rate limit, allow unregistered, bot mute). |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Eksekusi runtime dinamis untuk sapaan, menu, form, handover, dan konfirmasi. |
| `dashboard/tests/unit/pipeline.test.ts` | Baru | Unit test skema preset, interpolasi template, dan manager pipeline. |
| `dashboard/tests/unit/inbound-accept.test.ts` | Modifikasi | Pengujian flag `allow_unregistered_customers: false`. |
| `dashboard/tests/unit/customer-handle.test.ts` | Modifikasi | Pengujian respons sapaan dinamis dari konfigurasi pipeline. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis fitur. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **281 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas UI, kode, dan template.

---

## [2026-11-03] Interactive Visual Node-Based Workflow Canvas Builder (@xyflow/react + Dynamic Graph Runner)

### 1. Ringkasan Fitur & Arsitektur
Meng-upgrade halaman `/pipeline` dari kartu statis menjadi **Visual Node-Based Workflow Builder** interaktif berbasis `@xyflow/react` dengan eksekusi graf dinamis di backend:
1. **Kanvas Alur Kerja Node Interaktif (@xyflow/react):**
   - Membangun kanvas diagram node penuh (`h-[620px]`) dengan tema editorial dot grid teknikal (`#d8d0c0` di atas `#f4f0e6`), kontrol zoom/pan, dan minimap.
   - Mendukung manipulasi interaktif: drag and drop posisi node, seleksi node, penambahan kabel koneksi (*edges*) antar port, serta penghapusan kabel dan node tambahan.
   - Kartu node kustom (`PipelineNodeCard`) bertipografi tajam dengan badge peran berwarna, status aktif/nonaktif, ringkasan data, port input target (kiri), dan port output source (kanan) berlabel jelas.
2. **Katalog Tipe Node Modular (`PipelineNodeTypeEnum`):**
   - `TRIGGER_INBOUND`: Pintu masuk & filter (port `out_customer`, `out_owner`).
   - `MESSAGE_MENU`: Kirim chat sapaan & menu teks (port `out_next`).
   - `CONDITION_ROUTER`: Router percabangan kata kunci (port `branch_1`, `branch_2`, `branch_custom`, `branch_fallback`).
   - `ORDER_FORM_PROCESSOR`: Formulir pesanan & validasi (port `out_valid`, `out_incomplete`).
   - `CS_HANDOVER`: Jeda bot & handover owner (port `out_done`).
   - `ORDER_FULFILLMENT`: Konfirmasi pesanan & alert admin (port `out_done`).
   - `CUSTOM_WA_REPLY`: Kirim chat kustom bebas rantai (port `out_next`), dapat ditambahkan berkali-kali.
   - `OWNER_AI_AGENT`: Asisten operasional internal pemilik.
3. **Eksekusi Rantai Node Kustom & Cabang Dinamis (`graph-runner.ts`):**
   - `syncGraphToCoreConfig`: Menyinkronkan perubahan konfigurasi pada node kanvas ke 6 kontainer inti database agar seluruh endpoint internal tetap 100% kompatibel.
   - `executeChainedCustomNodes`: Menelusuri kabel koneksi dari port output untuk mengeksekusi satu atau beberapa node `CUSTOM_WA_REPLY` (misal cabang menu 3 kustom atau rantai pesan bonus pasca-order).
   - Terintegrasi langsung ke `customer/handle/route.ts` pada evaluasi cabang kata kunci kustom dan konfirmasi order.
4. **Simulator Alur Kerja Interaktif (Execute Workflow Simulator):**
   - Bilah simulator di bawah kanvas untuk menguji pengiriman pesan (Pelanggan / Owner) dengan berbagai state sesi (`INIT`, `AWAITING_CHOICE`, `AWAITING_ORDER`, `ACTIVE`, `PAUSED_FOR_OWNER`).
   - Menyorot (*highlight*) secara visual node yang dilalui dengan border terakota tebal `#9a3412` dan kabel koneksi animasi berdenyut (*animated smoothstep edges*).
   - Menyajikan log eksekusi dan pratinjau balon chat WhatsApp yang dihasilkan secara instan.
5. **Inspektor Kontainer & Live WhatsApp Bubble Preview:**
   - Panel editor terintegrasi saat node dipilih: edit label, template pesan, chip penyisip variabel cepat (`+ {{customer_name}}`, `+ {{order_id}}`, dsb.), kata kunci percabangan, dan target penerima.
   - Pratinjau balon chat WhatsApp real-time di samping formulir editor.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/package.json` | Modifikasi | Menambahkan dependensi `@xyflow/react` v12. |
| `dashboard/src/lib/pipeline/schema.ts` | Modifikasi | Menambahkan `PipelineNodeTypeEnum`, `PipelineGraphNodeSchema`, `PipelineGraphEdgeSchema`, dan `PipelineGraphSchema`. |
| `dashboard/src/lib/pipeline/presets.ts` | Modifikasi | Menambahkan struktur koordinat graf visual bawaan untuk ketiga preset. |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Baru | Mesin penjelajah graf dinamis, sinkronisasi kontainer inti, eksekusi rantai node kustom, dan simulator alur kerja. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Integrasi eksekusi percabangan kustom dan rantai node kustom pasca-order. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Penggantian kanvas statis menjadi visual node builder interaktif berbasis `@xyflow/react`. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian struktur graf preset, eksekusi rantai kustom, dan simulator kanvas. |
| `updates.md` | Modifikasi | Pencatatan kronologis pembaruan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **287 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Next.js Standalone Build:** `npm run build` sukses mengompilasi seluruh 27 route dan kanvas React Flow.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas UI, kode, dan template.

---

## [2026-11-03] Fix React Flow Handle Drag-and-Connect & Implement Slide-Over Node Inspector Drawer

### 1. Ringkasan Perbaikan
Mengatasi kendala kegagalan drag kabel pada handle port kanvas dan menyediakan panel inspektor kontainer slide-over yang interaktif:
1. **Perbaikan Handle Port Koneksi (@xyflow/react):**
   - Menyematkan atribut `isConnectable={true}` pada seluruh komponen `<Handle />` resmi `@xyflow/react`.
   - Mengatur dimensi port sentuh presisi 14x14px (`!w-3.5 !h-3.5`) dengan styling taktil `!bg-stone-800 !border-2 !border-stone-100 hover:!bg-[#9a3412] hover:!scale-125 cursor-crosshair !z-30`.
   - Memposisikan port target di sisi kiri dengan offset `style={{ left: -7 }}` dan seluruh cabang port source di sisi kanan dengan offset `style={{ right: -7 }}` pada pembungkus baris terpisah.
   - Menambahkan event dan konfigurasi kanvas `<ReactFlow>`: `onConnect`, `onNodeClick`, `onPaneClick`, `nodesDraggable={true}`, `nodesConnectable={true}`, dan `elementsSelectable={true}`.
   - Kartu node mendapatkan kelas `cursor-pointer select-none` serta penanda outline terakota tebal (`ring-2 ring-[#9a3412] shadow-md`) saat dipilih.
2. **Slide-Over Node Inspector Drawer:**
   - Membangun panel samping geser (*slide-over drawer*) berukuran lebar 460px (`w-[460px]`) yang otomatis terbuka saat kartu node diklik di kanvas, dan menutup saat area kosong kanvas diklik (`onPaneClick`) atau tombol tutup (x) ditekan.
   - Menyajikan diagram alur mini teks teknis langkah proses untuk masing-masing dari 8 tipe kontainer.
   - Formulir parameter interaktif: edit nama/label, template pesan WhatsApp dengan chip variabel cepat (`+ {{customer_name}}`, `+ {{order_id}}`, dsb.), kata kunci percabangan, checkbox field wajib, dan pemilihan target penerima chat kustom.
   - Live WhatsApp Bubble Preview real-time terintegrasi di dalam panel samping.
   - Tombol aksi `[ Terapkan Perubahan ke Node ]` dan `[ Hapus Node ]` (untuk kontainer tambahan).

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Perbaikan komponen `<Handle>` resmi dengan `isConnectable`, offset tepi kartu, event kanvas React Flow, dan panel slide-over drawer inspektor. |
| `updates.md` | Modifikasi | Dokumentasi kronologis perbaikan interaktivitas kanvas. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **287 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-03] Dynamic Branch Router, Auto-Expanding Textarea, Live WhatsApp Markdown, Canvas Panel, & Drawer Depth of Field

### 1. Ringkasan Perbaikan & Fitur
Menyempurnakan antarmuka visual Studio Pipeline (/pipeline) dan fleksibilitas percabangan dinamis:
1. **Dynamic Branch Router & Auto-Spawning Field (`CONDITION_ROUTER`):**
   - Mendukung array cabang kustom `branches` (`id`, `label`, `keywords`) di skema node dan presets.
   - Mekanisme auto-spawning: Saat cabang terakhir (misal cabang ke-3) diisi kata kunci, sistem secara otomatis menambahkan baris cabang baru kosong di bawahnya (cabang ke-4).
   - Menyediakan tombol hapus (`x`) pada cabang kustom untuk menghapus cabang yang tidak terpakai.
   - Port handle output source pada kartu node kanvas (`PipelineNodeCard`) bertambah dan berkurang secara reaktif mengikuti jumlah cabang aktif.
   - Mendukung penelusuran graf dan pengeksekusian cabang kustom di runtime (`customer/handle` dan `simulatePipelineExecution`).
2. **Auto-Expanding Textarea:**
   - Komponen `AutoExpandingTextarea` yang secara otomatis menyesuaikan tinggi (`scrollHeight`) sesuai panjang teks pesan (rentang min 120px hingga maks 500px) tanpa memotong isi formulir order atau template pesan panjang.
3. **Live WhatsApp Markdown Formatter (`whatsapp-formatter.tsx`):**
   - Modul parser Markdown khas WhatsApp yang mengubah `*teks*` menjadi tebal (`<strong>teks</strong>`), `_teks_` menjadi miring (`<em>teks</em>`), `~teks~` menjadi coret (`<del>teks</del>`), ````kode```` menjadi kode inline, dan `\n` menjadi jeda baris.
   - Terintegrasi langsung pada balon simulasi chat WhatsApp sehingga tanda bintang otomatis hilang dan kata di dalamnya tampil tebal sesuai aplikasi WhatsApp riil.
4. **Depth of Field (DoF) & Transisi Drawer Inspektor:**
   - Menambahkan lapisan latar belakang peredup dengan efek blur (`bg-stone-950/40 backdrop-blur-[3px]`) di belakang drawer untuk memisahkan fokus panel inspektor dari kanvas.
   - Transisi geser halus (*slide-in-from-right*) dan penutupan otomatis saat backdrop diklik atau tombol `Escape` ditekan.
5. **Integrasi Toolbar Kanvas (`<Panel position="top-left" />`):**
   - Memindahkan tombol `[ + Tambah Kontainer ]` dan `[ Rapikan Tata Letak ]` langsung menyatu ke sudut kiri-atas bidang kanvas React Flow tanpa mengganggu navigasi pan/zoom.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/pipeline/whatsapp-formatter.tsx` | Baru | Parser Markdown WhatsApp untuk balon simulasi chat (`WhatsAppFormattedText`). |
| `dashboard/src/lib/pipeline/schema.ts` | Modifikasi | Skema `RouterBranchSchema` dan `ConditionRouterDataSchema`. |
| `dashboard/src/lib/pipeline/presets.ts` | Modifikasi | Data bawaan `branches` untuk `node-router` pada seluruh preset. |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Penelusuran graf untuk array `branches` dinamis pada simulator dan compiler. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Eksekusi runtime cabang kustom dari array `branches`. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Auto-expanding textarea, handles dinamis router, WhatsApp markdown preview, backdrop DoF, dan React Flow panel. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian unit parser markdown WhatsApp dan rute percabangan dinamis. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **289 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-03] Fix Keyword Input Typing Bug, Sequential Branch Re-indexing, Full Container Catalog (Singleton Trigger), Deletable Edges, & Handle Hover UX

### 1. Ringkasan Perbaikan
Memperbaiki 5 kendala interaktivitas dan fungsionalitas kanvas Studio Pipeline (/pipeline):
1. **Perbaikan Input Kata Kunci Bebas Karakter (Bug 1):**
   - Menyimpan properti `raw_input` pada objek cabang kata kunci router sehingga pengguna bebas mengetik spasi, koma, titik, atau tanda baca tanpa karakter terakhir terhapus otomatis oleh `.trim()`.
   - Ekstraksi array `keywords` berjalan di latar belakang secara bersih.
2. **Normalisasi & Re-indexing Berurutan Cabang Kustom (Bug 2):**
   - Membuat fungsi deterministik `normalizeCustomBranches`: saat cabang dihapus (misal Cabang 3 dihapus), nomor cabang di bawahnya otomatis di-renumber secara berurutan mulai dari angka 3 (`Cabang 3 (Kustom)`, `Cabang 4 (Kustom)`, dsb.) tanpa melompat.
   - Menyelaraskan `sourceHandle` pada kabel `edges` yang terhubung secara otomatis saat ID cabang bergeser.
   - Selalu menambahkan tepat 1 cabang kustom kosong di urutan akhir sebagai slot *auto-spawning*.
3. **Katalog Kontainer Lengkap 8 Modul & Aturan Singleton Pintu Masuk (Bug 3):**
   - Memperluas modal "Pilih Tipe Kontainer Baru" menampilkan seluruh 8 tipe kontainer modular (`TRIGGER_INBOUND`, `MESSAGE_MENU`, `CONDITION_ROUTER`, `ORDER_FORM_PROCESSOR`, `ORDER_FULFILLMENT`, `CS_HANDOVER`, `CUSTOM_WA_REPLY`, `OWNER_AI_AGENT`).
   - Aturan Singleton: Jika `TRIGGER_INBOUND` sudah terpasang di kanvas, kartu kontainer tersebut ditampilkan nonaktif (*disabled*) dengan badge `"Sudah Terpasang · Maks 1"`.
4. **Kabel Deletable & Section Koneksi Kabel di Inspektor (Bug 4):**
   - Membuat komponen kustom `PipelineDeletableEdge.tsx` (`BaseEdge`, `EdgeLabelRenderer`, `getSmoothStepPath`) yang merender tombol bulat `x` tepat di tengah jalur kabel untuk memutuskan kabel secara instan.
   - Mengaktifkan `deleteKeyCode={["Backspace", "Delete"]}`, `edgesFocusable={true}`, dan `edgesReconnectable={true}` pada kanvas `<ReactFlow>`.
   - Menambahkan section "Koneksi Kabel Terhubung" di dalam Panel Inspektor Kontainer yang menampilkan daftar kabel masuk dan keluar lengkap dengan tombol `[ Putuskan ]`.
5. **Stabilisasi Titik Handle Port Tanpa Efek Melompat (Bug 5):**
   - Menghapus seluruh class `hover:!scale-125` dan `transition-transform` yang bertabrakan dengan CSS `transform` bawaan React Flow.
   - Menggantikannya dengan efek pembesaran ring fokus yang stabil (`hover:!ring-4 hover:!ring-[#9a3412]/25 !transition-shadow !duration-150`).
   - Memposisikan titik handle tepat vertikal di tengah baris port (`top: "50%"`) sehingga handle tidak pernah bergeser dari kursor saat disentuh.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/(app)/pipeline/PipelineDeletableEdge.tsx` | Baru | Komponen kabel kustom deletable dengan tombol putuskan kabel dan label port. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Helper `normalizeCustomBranches`, raw_input state, katalog 8 kontainer dengan singleton trigger, section koneksi kabel inspektor, dan stabilisasi hover handle. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian unit fungsi `normalizeCustomBranches`, auto-spawning, dan re-indexing kabel. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **291 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-03] Fix Editable Branch Labels, Edge Labels on Connect, Dynamic Graph Runtime Execution, & Anti-Bisu Fallback

### 1. Ringkasan Perbaikan
Memperbaiki 3 masalah pada Studio Pipeline dan runtime eksekusi percabangan dinamis bot WhatsApp:
1. **Label Cabang Kustom Editable (Section A):**
   - Menyediakan 2 kolom input di Panel Inspektor Kontainer `CONDITION_ROUTER`: Kolom 1 (Kiri, lebar 36%) untuk Label Port (misal `Katalog Menu` atau `Pilihan 3 (Katalog)`), dan Kolom 2 (Kanan) untuk Kata Kunci.
   - Menambahkan handler `handleBranchLabelChange` yang menyinkronkan label cabang kustom ke kartu kanvas (`PipelineNodeCard`) dan kabel yang terhubung.
   - Memperbarui `normalizeCustomBranches` agar tidak menimpa nama label kustom yang sudah diisi oleh pengguna saat normalisasi cabang.
2. **Otomatisasi Label pada Kabel Koneksi (Section B):**
   - Memperbarui fungsi `onConnect` di `PipelineStudio.tsx` agar secara otomatis memberikan label deskriptif sesuai port sumber (`Pilihan 1 · Order`, `Pilihan 2 · Tanya CS`, `Pilihan · <Nama Cabang>`, `Pelanggan Baru`, `Nomor Owner`, `Form Lengkap`, dsb.).
   - Menyempurnakan komponen `PipelineDeletableEdge.tsx` agar merender teks label di dalam pill bulat (`rounded-full`) berdampingan dengan tombol putuskan kabel `✕`.
3. **Sinkronisasi Runtime Graf Dinamis & Defensive Fallback Anti-Bisu (Section C):**
   - Menghubungkan eksekusi percabangan dinamis di `/api/internal/customer/handle/route.ts` dengan graf visual yang tersimpan di database (`pipeline.config.graph.nodes` dan `edges`).
   - Saat pelanggan mengirim pesan pilihan kustom (misal "3" untuk cabang Katalog Menu) di status `AWAITING_CHOICE`, route handler mengeksekusi rantai node target (`CUSTOM_WA_REPLY`), merender template pesan, dan memperbarui sesi di database.
   - Memperbaiki `executeChainedCustomNodes` di `graph-runner.ts` agar mencocokkan `sourceHandle` secara akurat dan menggunakan `trigger_type: "CUSTOMER_REPLY"`. Menambahkan `CUSTOM_REPLY` ke enum triggers di `/api/internal/waha/send/route.ts`.
   - Menerapkan **Defensive Fallback (Anti-Bisu)**: Jika pesan pelanggan tidak cocok dengan opsi mana pun di status `AWAITING_CHOICE`, endpoint dijamin 100% selalu mengembalikan pesan pengingat sopan (`fallback_reply_text` atau `unrecognized_choice_text`) dan DILARANG KERAS mengembalikan array balasan kosong atau membiarkan bot membisu di WhatsApp.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/(app)/pipeline/PipelineDeletableEdge.tsx` | Modifikasi | Pill label bulat dengan rendering teks label port dan tombol putuskan kabel `✕`. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Dua kolom input editor cabang (Label & Kata Kunci), preservasi label kustom di `normalizeCustomBranches`, sinkronisasi label kartu kanvas, dan `onConnect` auto-label. |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Filter `sourceHandle` presisi, dukungan template ganda, dan `trigger_type: "CUSTOMER_REPLY"`. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Penambahan `CUSTOM_REPLY` ke whitelist skema `triggers`. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Eksekusi runtime graf cabang kustom dari database dan mekanisme anti-bisu defensive fallback. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian unit preservasi label cabang kustom pengguna dan sinkronisasi label edge. |
| `dashboard/tests/unit/customer-handle.test.ts` | Modifikasi | Pengujian integrasi Case 10 (eksekusi cabang kustom database) dan Case 11 (defensive fallback anti-bisu). |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **294 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-03] Fix Dynamic Message Extraction for Chained MESSAGE_MENU & Implement Nested Sub-Router Execution

### 1. Ringkasan Perbaikan
Memperbaiki 3 kendala rantai alur pesan dinamis dan navigasi sub-menu bertingkat:
1. **Polymorphic Message Extractor (`extractNodeMessageText`) (Section A):**
   - Membuat fungsi pembantu `extractNodeMessageText` di `dashboard/src/lib/pipeline/graph-runner.ts` yang mampu membaca teks secara polimorfik dari berbagai tipe kontainer node (`message_template`, `greeting_text`, `message_text`, `form_template_text`, `handover_customer_text`, `customer_confirmation_template`, `body`).
   - Memperbarui `executeChainedCustomNodes` agar mendukung rantai kontainer bertipe `MESSAGE_MENU` selain `CUSTOM_WA_REPLY`.
2. **Pembersihan String Dummy & Navigasi Sub-Router Simulator (Section B):**
   - Menghapus 100% string placeholder tiruan `(Cabang ... Tereksekusi)` pada `simulatePipelineExecution`.
   - Simulator kini mengekstrak dan merender teks nyata dari node tujuan menggunakan `renderPipelineTemplate`.
   - Jika node tujuan terhubung keluar (`out_next`) ke node `CONDITION_ROUTER` lain (Sub-Router), simulator mendeteksi router turunan tersebut, menetapkan `active_router_id`, dan mencatat perpindahan di log simulator (`Navigasi ke sub-menu: [Nama Router]`).
   - Pada giliran pesan berikutnya, simulator menerima `currentRouterId` dan mengevaluasi kata kunci dari router turunan tersebut (misal pilihan 1 mengarah ke Formulir Order milik sub-menu).
3. **Penyelarasan Runtime WhatsApp Nyata via Pointer `current_router_id` (Section C):**
   - Memanfaatkan pointer `current_router_id` di kolom JSONB `metadata` pada tabel `customer_sessions`.
   - Saat pelanggan membalas pesan di status `AWAITING_CHOICE`, endpoint `/api/internal/customer/handle/route.ts` memprioritaskan evaluasi kata kunci pada router yang sedang aktif (`current_router_id`).
   - Saat sub-menu terpilih dan memiliki kabel `out_next` ke router baru, ID router turunan otomatis disimpan ke `metadata.current_router_id`.
   - Saat pelanggan melanjutkan alur ke order atau handover, pointer `current_router_id` dibersihkan (`null`) dan state berpindah sesuai alur.
4. **Sinkronisasi Reaktif Preview Kartu `MESSAGE_MENU` (Section D):**
   - Memperbarui kartu `MESSAGE_MENU` di kanvas (`PipelineNodeCard`) agar membaca `message_text || greeting_text` sehingga teks sub-menu langsung tampil secara reaktif saat diedit di panel inspektor.
   - Menyinkronkan `simActiveRouterId` pada antarmuka simulator `PipelineStudio.tsx`.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Fungsi `extractNodeMessageText`, dukungan `MESSAGE_MENU` pada `executeChainedCustomNodes`, hapus mock strings, dan nested sub-router navigation di `simulatePipelineExecution`. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Sinkronisasi `simActiveRouterId` simulator dan fallback `message_text \|\| greeting_text` kartu `MESSAGE_MENU`. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Navigasi router bertingkat via pointer `session.metadata.current_router_id` di database runtime WhatsApp. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian unit `extractNodeMessageText` polimorfik dan simulasi rantai sub-router dua tahap (pilihan 3 -> sub-menu -> pilihan 1 order). |
| `dashboard/tests/unit/customer-handle.test.ts` | Modifikasi | Pengujian integrasi Case 12 untuk nested sub-router runtime WhatsApp nyata. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **297 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-03] Fix Initial Greeting Node Target Resolution (Trace Trigger Edge) & Auto-Heal Contaminated Config

### 1. Ringkasan Perbaikan
Memperbaiki anomali pesan sapaan awal saat pelanggan baru chat pertama kali (`state: INIT`):
1. **Pencegahan Kontaminasi di `syncGraphToCoreConfig` (Section A):**
   - Membatasi sinkronisasi properti `customer_greeting.greeting_text` HANYA dari kontainer sapaan awal (`rootGreetingNode`) yang terhubung langsung dari port `out_customer` pada `TRIGGER_INBOUND` (atau `id === 'node-greeting'`).
   - Mencegah kontainer sub-menu tambahan (`custom-message_menu-*` seperti sub-menu katalog) menimpa teks sapaan selamat datang utama.
2. **Edge Tracing Murni pada Status Awal (INIT) (Section B):**
   - **Di Simulator (`simulatePipelineExecution`)**: Saat pesan pertama masuk pada `INIT`, simulator menelusuri kabel `customerEdge` dari `TRIGGER_INBOUND` port `out_customer` untuk menemukan node sapaan awal dan mengekstrak teks aslinya via `extractNodeMessageText`. Menandai kabel dan node sapaan sebagai aktif di simulator.
   - **Di Runtime WhatsApp (`customer/handle/route.ts`)**: Saat aksi `SEND_GREETING` dieksekusi, handler menelusuri kabel dari `TRIGGER_INBOUND` ke node sapaan awal pada graf visual untuk mengambil teks selamat datang yang autentik.
3. **Auto-Heal Konfigurasi Database PostgreSQL (Section C):**
   - Pada `getActivePipelineConfig` di `dashboard/src/lib/pipeline/manager.ts`, sistem mendeteksi secara otomatis jika `customer_greeting.greeting_text` sebelumnya terlanjur tertimpa teks katalog atau link `drive.google.com`.
   - Secara otomatis memulihkan kembali nilai `greeting_text` ke teks selamat datang autentik Berseri dari `node-greeting` atau preset bawaan, dan menyimpan perbaikan tersebut ke tabel `pipeline_configs` di PostgreSQL.

### 2. Berkas Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Filter `rootGreetingNode` pada `syncGraphToCoreConfig` dan edge tracing sapaan awal pada `simulatePipelineExecution`. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Edge tracing sapaan awal dari `TRIGGER_INBOUND` port `out_customer` pada aksi `SEND_GREETING`. |
| `dashboard/src/lib/pipeline/manager.ts` | Modifikasi | Mekanisme auto-heal di `getActivePipelineConfig` untuk memulihkan konfigurasi sapaan yang tertimpa link katalog. |
| `dashboard/tests/unit/pipeline.test.ts` | Modifikasi | Pengujian unit auto-heal `customer_greeting`, isolasi `syncGraphToCoreConfig` dari sub-menu, dan simulasi INIT via edge tracing. |
| `dashboard/tests/unit/customer-handle.test.ts` | Modifikasi | Pengujian integrasi Case 13 untuk pesan awal INIT yang kebal terhadap kontaminasi sub-menu katalog. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 29 test file, **301 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-04] Fix Order Status Filtering in Todos Tool, Auto-Unmute Customer Sessions on Completion, and Support Bulk Order Complete

### 1. Ringkasan Perbaikan
Memperbaiki kebocoran pesanan selesai pada to-do tool, mengimplementasikan auto-unmute sesi pelanggan saat order selesai, dan menambahkan dukungan aksi massal (bulk):
1. **Filter Ketat Status & Tanggal `upcoming_orders` di To-Do Tool (Section A):**
   - Pada `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts`, kueri `upcomingOrders` sekarang memfilter secara ketat `status: { in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS] }` dan `event_date: { gte: startOfDayWib }`.
   - Pesanan yang sudah berstatus `COMPLETED` atau `CANCELLED` maupun pesanan lampau tidak akan pernah lagi bocor ke respon to-do WhatsApp owner.
   - Jika seluruh pesanan telah selesai, `upcoming_orders` bernilai array kosong `[]` dan `total_upcoming_orders: 0`.
2. **Auto-Unmute Pelanggan Saat Pesanan Selesai di Dashboard UI (Section B):**
   - Pada `dashboard/src/app/api/orders/[id]/route.ts`, saat status operasional pesanan diubah menjadi `COMPLETED`, sistem secara otomatis membuka kunci sesi pelanggan terkait di tabel `customer_sessions` (`state: "ACTIVE"`, `paused_at: null`, reset draft & retry count).
3. **Auto-Heal Sesi Pelanggan di Inbound Gate (Section C):**
   - Pada `dashboard/src/app/api/internal/inbound/accept/route.ts`, saat pesan masuk dari pelanggan yang TIDAK memiliki pesanan aktif (`PENDING` atau `IN_PROGRESS`), sistem secara otomatis me-reset sesi yang sempat ter-pause (`paused_at: null`, `state: "ACTIVE"`) sehingga bot segera membalas chat pelanggan tanpa membisu.
   - Jika pesanan aktif masih ada dan `mute_bot_on_active_order` aktif, bot tetap hening (`ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED`) agar admin bebas mengobrol manual.
4. **Dukungan Aksi Massal (Bulk) di `tool_update_order` (Section D):**
   - Memperbarui `dashboard/src/app/api/internal/tools/update-order/route.ts` untuk menerima `order_id: "ALL"` atau `"SEMUA"`.
   - Mengambil seluruh pesanan aktif (`PENDING` dan `IN_PROGRESS`), menandainya sebagai `COMPLETED` (dan `PAID` jika `COMPLETE_AND_PAY` / `MARK_PAID`), membuka kunci sesi seluruh pelanggan terkait, dan mengembalikan pesan ringkasan jumlah pesanan yang diselesaikan.
   - Jika tidak ada pesanan aktif, mengembalikan pesan bahwa semua pesanan memang sudah berstatus selesai sebelumnya.
   - Memperbarui deskripsi tool dan parameter `order_id` di `n8n-engine/workflows/botseri-inbound-agent.json`.
5. **Penyelarasan Prompt Sistem Agent (Section E):**
   - Pada `dashboard/src/lib/prompt/templates/base.id.md`, melarang LLM menampilkan bagian "Pesanan mendatang" jika data `upcoming_orders` dari tool bernilai kosong.
   - Menambahkan instruksi eksplisit: jika owner meminta menyelesaikan seluruh/semua pesanan, LLM wajib memanggil `tool_update_order` dengan parameter `order_id: "ALL"` dan `action: "MARK_COMPLETED"` (atau `"COMPLETE_AND_PAY"`).

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts` | Modifikasi | Filter `status: [PENDING, IN_PROGRESS]` dan `event_date: gte startOfDayWib` pada `upcoming_orders`. |
| `dashboard/src/app/api/orders/[id]/route.ts` | Modifikasi | Auto-unmute sesi pelanggan di `customer_sessions` saat order ditandai `COMPLETED`. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Auto-heal sesi pelanggan saat tidak ada pesanan aktif (`paused_at: null`, `state: "ACTIVE"`). |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Penanganan aksi massal (`order_id: "ALL" \| "SEMUA"`) dan auto-unmute massal. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Pembaruan deskripsi tool `tool_update_order` dan placeholder parameter `order_id: ALL`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Penyelarasan prompt: larangan sebut pesanan jika kosong dan instruksi bulk complete `order_id: 'ALL'`. |
| `dashboard/tests/unit/get-prioritized-todos-route.test.ts` | Baru | Pengujian unit filter status dan tanggal pada endpoint `get-prioritized-todos`. |
| `dashboard/tests/unit/api-orders-id-route.test.ts` | Baru | Pengujian unit auto-unmute sesi pelanggan saat order berstatus `COMPLETED` di dashboard UI. |
| `dashboard/tests/unit/update-order-route.test.ts` | Modifikasi | Pengujian unit aksi massal `ALL` dan `SEMUA` pada `tool_update_order`. |
| `dashboard/tests/unit/inbound-accept.test.ts` | Modifikasi | Pengujian unit auto-heal sesi pelanggan saat tidak ada pesanan aktif. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 31 test file, **310 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

---

## [2026-11-04] S02: Kebersihan Repo dan Perlindungan Rahasia (Git Init, Secret Scanner, Pre-commit Hook, Panduan Lokasi Repo)

### 1. Ringkasan Perbaikan
Menerapkan perbaikan fondasi keamanan dan kontrol versi repositori (P0):
1. **Inisialisasi Git & Penguncian `.gitignore`:**
   - Menginisialisasi repositori Git lokal (`git init`).
   - Memperbarui berkas root `.gitignore` untuk mengunci seluruh berkas sensitif dan artefak: `.env`, `.env.*` (kecuali `.env.example`), `backups/`, `*.dump`, `*.tar.gz`, `node_modules/`, `**/.next/`, `n8n-engine/data/`, dan `*.log`.
   - Memastikan berkas `.env` dan dump database di direktori `backups/` tidak terlacak oleh Git (`git status --ignored`).
   - Membuat commit inisialisasi terpisah: `chore(s02): inisialisasi git`.
2. **Pemindai Rahasia Otomatis (`scripts/check-secrets.sh`):**
   - Membuat skrip `scripts/check-secrets.sh` yang memindai berkas pohon kerja dari kebocoran kunci API OpenAI (`sk-...`), Google Gemini (`AIzaSy...`), private key PEM (`BEGIN ... KEY`), dan `ENCRYPTION_KEY=...`.
   - Menjaga kerahasiaan saat pelanggaran terdeteksi: skrip hanya mencetak nama file dan nomor baris ke stderr tanpa mencetak nilai rahasia (zero secret exposure), lalu keluar dengan exit code `1`.
   - Menambahkan pengujian regresi di `dashboard/tests/unit/check-secrets.test.ts` (uji kasus bersih exit 0, uji kasus deteksi kunci palsu exit 1, dan verifikasi nilai rahasia disamarkan).
3. **Integrasi CI, Smoke Test, & Git Hook:**
   - Menambahkan langkah eksekusi `check-secrets.sh` di dalam alur `.github/workflows/ci.yml`.
   - Mengintegrasikan pemeriksaan rahasia di dalam skrip `scripts/smoke.sh`.
   - Membuat pre-commit hook di `.githooks/pre-commit` dan mengonfigurasi `core.hooksPath` agar setiap commit secara otomatis memindai kebocoran rahasia.
4. **Panduan Lokasi Repositori di Dokumentasi:**
   - Menambahkan panduan di `README.md` dan `docs/RUNBOOK.md` terkait larangan meletakkan repositori di folder sinkronisasi cloud (Google Drive, Dropbox, OneDrive, iCloud) demi mencegah kebocoran `.env` serta korupsi file lock Git.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `.gitignore` | Modifikasi | Pengecualian ketat berkas `.env*`, `backups/`, `*.dump`, `*.tar.gz`, `node_modules/`, dan cache build. |
| `.env.example` | Modifikasi | Penghapusan karakter em dash pada komentar header. |
| `scripts/check-secrets.sh` | Baru | Skrip bash pemindaian rahasia otomatis pada pohon kerja. |
| `.githooks/pre-commit` | Baru | Hook pre-commit Git untuk menjalankan pemindai rahasia sebelum commit. |
| `dashboard/tests/unit/check-secrets.test.ts` | Baru | Pengujian unit kasus positif dan negatif untuk `check-secrets.sh`. |
| `.github/workflows/ci.yml` | Modifikasi | Penambahan langkah pemindaian rahasia di job test CI. |
| `scripts/smoke.sh` | Modifikasi | Penambahan pemeriksaan `check-secrets.sh` pada pengujian asap lokal. |
| `README.md` | Modifikasi | Sub-bagian panduan lokasi repositori yang disarankan dan pre-commit hook. |
| `docs/RUNBOOK.md` | Modifikasi | Sub-bagian 5.5 panduan penataan direktori lokal dan pencegahan sinkronisasi cloud. |
| `docs/reports/step-05-execution-report.md` | Modifikasi | Penyamaran dummy API key agar bersih dari deteksi pemindai rahasia. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan S02. |

### 3. Hasil Verifikasi
1. **Git Ignored Check:** `.env` dan `backups/` masuk daftar *Ignored files* dan tidak berada di staging area.
2. **Secret Scanner Check:** `./scripts/check-secrets.sh` menghasilkan exit code 0 tanpa temuan rahasia.
3. **Unit Test Suite:** 32 test file, **313 test cases** lulus 100%.
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 4. Langkah Manual Pemilik Proyek (Known Issues / Perlu Verifikasi Manual)
1. Pindahkan direktori proyek dari Google Drive (`/Users/michaelarhdyn/Library/CloudStorage/GoogleDrive-...`) ke direktori disk lokal murni (misal: `/Users/michaelarhdyn/projects/Botseri`).
2. Rotasi nilai `ENCRYPTION_KEY`, API key provider LLM, dan token internal karena repositori sempat berada di dalam folder sinkronisasi cloud.

---

## [2026-11-04] S03: Kontrak, Enum Tunggal, dan Pembaruan Invarian

### 1. Ringkasan Perbaikan
Menerapkan fondasi kontrak sistem, enum tunggal trigger outbound, dan konsolidasi invarian arsitektur (P1):
1. **Sumber Kebenaran Enum Tunggal Outbound (`triggers.ts`):**
   - Membuat berkas kanonik `dashboard/src/lib/waha/triggers.ts` yang mengekspor konstanta `OUTBOUND_TRIGGERS` berisi 11 jenis pemicu pesan keluar yang sah: `CHAT_MASUK`, `MORNING_BRIEF`, `WORK_HOURS_REMINDER`, `END_OF_DAY_EVAL`, `PAIRING`, `TASK_ALARM`, `CUSTOMER_REPLY`, `CUSTOM_REPLY`, `NEW_ORDER_ALERT`, `OWNER_DIGEST` (fondasi S05), dan `CONFIRMATION_REPLY` (fondasi S04).
   - Mendefinisikan `TRIGGER_PRIORITY` dengan pembagian prioritas P0 (Alarm, Alert, Digest), P1 (Interaksi Langsung Owner), dan P2 (Balasan Pelanggan).
   - Mendefinisikan `TRIGGER_RECIPIENT_POLICY` untuk memvalidasi nomor penerima (`OWNER_ONLY`, `CUSTOMER_ONLY`, `ANY`).
2. **Penyelarasan Enum di API Route:**
   - Memperbarui skema Zod pada `dashboard/src/app/api/internal/waha/send/route.ts` agar menggunakan `z.enum(OUTBOUND_TRIGGERS)` langsung dari sumber kebenaran tunggal.
3. **Koreksi Label Trigger pada Workflow Scheduler:**
   - Memperbaiki node `http-send-alarm` ("Kirim WhatsApp Alarm") di `n8n-engine/workflows/botseri-scheduler.json` baris 115 agar mengirimkan `trigger_type: 'TASK_ALARM'` secara konsisten (menggantikan label lama `'WORK_HOURS_REMINDER'`).
4. **Perluasan Validasi Kontrak Workflow & Uji Regresi:**
   - Membuat skrip Node.js pendamping `scripts/validate-workflow-contracts.mjs` yang memverifikasi bahwa seluruh trigger outbound pada workflow n8n valid dan terdaftar di `OUTBOUND_TRIGGERS`, termasuk pengujian fixture negatif terisolasi.
   - Mengintegrasikan pemeriksaan kontrak trigger ke dalam `scripts/validate-workflows.sh`.
   - Menambahkan unit test kontrak `dashboard/tests/unit/workflow-contract.test.ts` (3 tes lulus 100%).
5. **Konsolidasi Invarian Arsitektur Kanonik (`docs/INVARIANTS.md`):**
   - Membuat dokumen kanonik tunggal `docs/INVARIANTS.md` merangkum `INV-01` s.d. `INV-16`.
   - Memperbarui `INV-07 (revisi)` untuk alur pelanggan publik, `INV-13 (revisi)` untuk penjaga outbound WAHA dan enum tunggal, serta menambahkan invarian baru: `INV-14` (pemisahan data pelanggan tidak tepercaya), `INV-15` (konfirmasi dua langkah deterministik untuk aksi kritis/massal), dan `INV-16` (validasi graf alur kerja di server).
   - Menautkan dokumen kanonik ini dari `docs/ARCHITECTURE.md`.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/waha/triggers.ts` | Baru | Sumber kebenaran tunggal `OUTBOUND_TRIGGERS`, `TRIGGER_PRIORITY`, dan `TRIGGER_RECIPIENT_POLICY`. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Validasi skema Zod menggunakan `z.enum(OUTBOUND_TRIGGERS)`. |
| `n8n-engine/workflows/botseri-scheduler.json` | Modifikasi | Koreksi `trigger_type: 'TASK_ALARM'` pada node pengiriman alarm to-do. |
| `scripts/validate-workflow-contracts.mjs` | Baru | Validator ekstrak literal trigger outbound dan uji fixture negatif. |
| `scripts/validate-workflows.sh` | Modifikasi | Integrasi validasi kontrak trigger dan uji fixture negatif. |
| `dashboard/tests/unit/workflow-contract.test.ts` | Baru | Pengujian unit kontrak workflow dan penolakan trigger ilegal. |
| `docs/INVARIANTS.md` | Baru | Dokumen kanonik 16 invarian arsitektur Botseri (`INV-01` s.d. `INV-16`). |
| `docs/ARCHITECTURE.md` | Modifikasi | Tautan dan sinkronisasi ringkasan tabel invarian sistem ke `docs/INVARIANTS.md`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S03. |

### 3. Hasil Verifikasi
1. **Workflow Contract Test:** `npx vitest run tests/unit/workflow-contract.test.ts` lulus 3/3 tes.
2. **Workflow Validator:** `./scripts/validate-workflows.sh` lulus 2 file workflow asli dan lulus uji fixture negatif.
3. **Unit Test Suite:** 33 test file, **316 test cases** lulus 100%.
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
7. **Grep Scheduler:** `grep -Rn "WORK_HOURS_REMINDER" n8n-engine/workflows/botseri-scheduler.json` bersih (0 kemunculan literal hardcoded pada job alarm).

### 4. Migrasi & Rollback
- Migrasi: Tidak ada migrasi database.
- Rollback: `git revert <commit-s03>`

---

## [2026-11-04] S04: Keamanan Agen Owner: Injeksi Prompt dan Aksi Destruktif

### 1. Ringkasan Perbaikan
Menerapkan pengamanan menyeluruh terhadap ancaman Indirect Prompt Injection, aksi destruktif, dan manipulasi data massal (P0):
1. **Pemisahan Data Tidak Tepercaya (`INV-14` & `lib/security/untrusted.ts`):**
   - Membuat modul sanitasi `sanitizeUntrusted` yang menghapus karakter kontrol (ASCII 0-31 dan 127), karakter zero-width, menormalkan spasi, membatasi panjang (default 300), menetralkan triple backtick, dan menetralkan tag peran prompt injection (`<system>`, `[INST]`, `###`).
   - Memisahkan data teks bebas pelanggan (`special_notes`/`request_khusus`) pada `get-orders` dan `get-prioritized-todos` ke dalam field `customer_text` dengan penanda eksplisit `untrusted: true`.
   - Menambahkan aturan pagar pengaman `R-UNTRUSTED` pada prompt sistem `base.id.md`.
2. **Konfirmasi Dua Langkah Deterministik (`INV-15` & Tabel `pending_confirmations`):**
   - Menambahkan tabel `pending_confirmations` dengan indeks pada `(owner_chat_id, executed_at, expires_at)`.
   - Pada `tool_update_order`, aksi `DELETE`, `CANCEL`, serta `ALL`/`SEMUA` (termasuk `MARK_COMPLETED` massal) tidak lagi mengeksekusi mutasi langsung di dalam tool.
   - Membatasi eksekusi massal maksimum 50 pesanan aktif.
   - Tiket konfirmasi dibuat berbatas waktu 5 menit (`expires_at`), mengembalikan `{ requires_confirmation: true, preview, instruksi_untuk_owner }`.
   - Pada `inbound/accept/route.ts`, saat pesan owner baru cocok dengan kata persetujuan (`ya`, `oke`, dll.), aksi dieksekusi secara deterministik di sisi server tanpa memanggil LLM kembali, ditandai `executed_at = now()` secara idempoten, dan dibalas via trigger `CONFIRMATION_REPLY`.
   - Pesan yang kedaluwarsa dilaporkan secara sopan, dan pesan lain dari owner secara otomatis membatalkan tiket konfirmasi tertunda.
3. **Soft Delete & Pemulihan Pesanan:**
   - Menambahkan kolom `orders.deleted_at` (`timestamptz null`) dengan indeks `orders_deleted_at_idx`.
   - Mengubah aksi `DELETE` dan `CANCEL` menjadi soft delete (`status = CANCELLED`, `deleted_at = now()`) tanpa penghapusan fisik dari PostgreSQL (`0` panggilan `order.delete` di `dashboard/src`).
   - Seluruh kueri pesanan aktif (`get-orders`, `get-prioritized-todos`, `api/orders`, mute bot) otomatis memfilter `deleted_at: null`.
   - Menambahkan tampilan tab **"Sampah"** (< 30 hari) dan tombol **"Pulihkan"** pada antarmuka `/orders` (memulihkan `deleted_at: null` dan `status = PENDING`).
   - Membuat skrip pembersihan permanen `scripts/purge-deleted-orders.ts` untuk pesanan terhapus > 30 hari.
4. **Audit Mutasi & Ambiguitas ID:**
   - Setiap mutasi pesanan dicatat ke `system_events` (`source: 'OWNER_TOOL'`, `code: 'ORDER_MUTATED'`).
   - Menangani ambiguitas prefix `order_id`: bila prefix cocok ke > 1 pesanan, tool mengembalikan `ambiguous: true` beserta daftar kandidat tanpa mengeksekusi mutasi.
   - Membuat skrip pembersih `scripts/clean-legacy-notes-status.ts` dan menghapus penambahan penanda lama `[STATUS: SELESAI]` pada `notes`.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/security/untrusted.ts` | Baru | Modul sanitasi karakter kontrol, zero-width, backtick, tag prompt role, dan wrapper `customer_text`. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan model `PendingConfirmation` dan kolom `Order.deleted_at`. |
| `dashboard/prisma/migrations/20261104100000_add_pending_confirmations_and_order_soft_delete/migration.sql` | Baru | Migrasi SQL forward-only tabel `pending_confirmations` dan kolom `deleted_at`. |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Penahanan konfirmasi 2 langkah (`DELETE`/`CANCEL`/`ALL`), batas massal 50, audit mutasi, dan cek ambiguitas prefix. |
| `dashboard/src/app/api/internal/tools/get-orders/route.ts` | Modifikasi | Sanitasi seluruh field dan pembungkusan `customer_text` (`untrusted: true`). Filter `deleted_at: null`. |
| `dashboard/src/app/api/internal/tools/get-prioritized-todos/route.ts` | Modifikasi | Sanitasi dan pembungkusan `customer_text`. Filter `deleted_at: null`. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Eksekusi deterministik konfirmasi dua langkah di server, proteksi self-confirmation, dan filter `deleted_at: null`. |
| `dashboard/src/app/api/orders/[id]/route.ts` | Modifikasi | Soft delete pada `DELETE`, dukungan `restore: true` pada `PATCH`, dan auto-unmute pelanggan. |
| `dashboard/src/app/api/orders/route.ts` | Modifikasi | Filter `deleted_at: null` pada daftar pesanan aktif. |
| `dashboard/src/app/(app)/orders/page.tsx` | Modifikasi | Pembacaan data pesanan aktif dan pesanan sampah 30 hari terakhir. |
| `dashboard/src/app/(app)/orders/OrderBoard.tsx` | Modifikasi | Penambahan tab "Sampah", aksi "Pulihkan", dan pencegahan konfirmasi fisik langsung. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Penambahan aturan `R-UNTRUSTED` pada pagar pengaman prompt sistem. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Penyelarasan pengiriman `trigger_type: CONFIRMATION_REPLY` pada balasan langsung. |
| `dashboard/scripts/purge-deleted-orders.ts` & `scripts/purge-deleted-orders.ts` | Baru | Skrip pembersihan permanen pesanan terhapus > 30 hari. |
| `dashboard/scripts/clean-legacy-notes-status.ts` & `scripts/clean-legacy-notes-status.ts` | Baru | Skrip pembersihan penanda lama `[STATUS: SELESAI]` pada `notes`. |
| `docs/RUNBOOK.md` | Modifikasi | Dokumentasi sub-bagian 7.3 panduan menjalankan `purge-deleted-orders.ts`. |
| `dashboard/tests/unit/s04-security.test.ts` | Baru | Pengujian unit sanitasi teks tidak tepercaya (`INV-14`). |
| `dashboard/tests/unit/update-order-route.test.ts` | Modifikasi | Pengujian unit penahanan konfirmasi `DELETE`/`CANCEL`/`ALL`, batas 50, dan ambiguitas prefix. |
| `dashboard/tests/unit/inbound-accept.test.ts` | Modifikasi | Pengujian integrasi eksekusi deterministik server, self-confirmation check, dan expired confirmation. |
| `dashboard/tests/unit/api-orders-id-route.test.ts` | Modifikasi | Pengujian unit soft delete dan pemulihan `restore: true`. |
| `dashboard/tests/unit/get-orders-route.test.ts` | Modifikasi | Pengujian unit sanitasi prompt injection pada `special_notes`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S04. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 34 test file, **330 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
5. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).
6. **Physical Delete Check:** `grep -RnE "order\.delete\(|DELETE FROM [\"']?orders[\"']?" dashboard/src` bersih (0 pemanggilan hapus fisik).

### 4. Migrasi & Rollback
- Migrasi: `20261104100000_add_pending_confirmations_and_order_soft_delete` (tabel `pending_confirmations`, kolom `orders.deleted_at`, indeks).
- Rollback Migrasi:
  ```sql
  DROP TABLE IF EXISTS "pending_confirmations";
  DROP INDEX IF EXISTS "orders_deleted_at_idx";
  ALTER TABLE "orders" DROP COLUMN IF EXISTS "deleted_at";
  ```

---

## [2026-11-04] S05: Integritas Pesanan-Sesi dan Kebijakan Mute

### 1. Ringkasan Perbaikan
Menerapkan perbaikan integritas relasi sesi pesanan, normalisasi nomor telepon, kebijakan batas waktu (TTL) mute, dan ringkasan berkala ke owner (P0):
1. **Normalisasi Telepon Indonesia E.164 (`lib/customer/phone.ts`):**
   - Menambahkan fungsi `normalizePhone(input)` untuk menghasilkan string digit murni E.164 standar Indonesia (`628...`, mengubah `08xx`, `+628xx`, `8xx`, membuang karakter pemisah spasi/strip/titik/plus/tanda kurung, menghapus akhiran `@c.us` dan `:1`, serta memvalidasi batas panjang 8 s.d. 16 digit).
   - Menambahkan fungsi `toChatId(phone)` yang mengonversi nomor telepon menjadi JID WhatsApp resmi (`<digits>@c.us`).
2. **Migrasi Kolom `orders.customer_chat_id` & Relasi Sesi yang Kuat:**
   - Menambahkan kolom `orders.customer_chat_id text null` dengan indeks `(customer_chat_id, status)` di skema Prisma dan migrasi SQL forward-only.
   - Saat pesanan dibuat via alur pelanggan di `customer/handle/route.ts`, kolom `customer_chat_id` langsung diisi dari JID sesi WhatsApp (`toChatId(customer_phone)`), bukan dari nomor mentah formulir.
   - Pesanan buatan owner via dashboard/tool dibiarkan bernilai `customer_chat_id: null` sehingga tidak memicu mute keliru pada nomor pelanggan.
   - Membuat skrip backfill `dashboard/scripts/backfill-customer-chat-id.ts` untuk mencocokkan data pesanan lama dengan nomor sesi `customer_sessions`.
   - Membuat helper terpadu `unmuteCustomerSessionByOrder` (`lib/customer/session.ts`) yang mengutamakan `customer_chat_id` dengan fallback ke `customer_contact`.
3. **Batas Waktu (TTL) Mute & Pengecualian Kata Kunci:**
   - Menambahkan field `inbound_gate.mute_max_hours` (default 48 jam, rentang 1 s.d. 336 jam) pada skema pipeline dan panel inspektor Studio Pipeline.
   - Jika umur pesanan aktif melampaui `mute_max_hours`, bot mengirimkan satu kali pesan pengingat: *"Pesanan Anda sedang dikonfirmasi/ditangani admin. Ketik MENU untuk melihat pilihan."*
   - Pengecualian bypass: jika pelanggan yang sedang di-mute mengetik pesan dengan kata kunci `"MENU"` atau `"BARU"`, bot seketika merespons (`accept: true`) tanpa memblokir pesan pelanggan.
4. **Pemberitahuan Berkala ke Owner (`OWNER_DIGEST`):**
   - Saat pelanggan yang di-mute mengirim pesan, sistem mencatat waktu tunggu awal di `customer_sessions.metadata.waiting_since` dan menambah `unread_count`.
   - Pada scheduler tick (`lib/scheduler/tick.ts`), sistem secara otomatis mengevaluasi job `OWNER_DIGEST` deterministik (tanpa LLM) setiap jendela 2 jam jika ada pelanggan yang menunggu balasan, pada jam wajar (07:00 s.d. 21:00) atau kapan saja jika pelanggan telah menunggu lebih dari 6 jam.
   - Menghapus penanda `waiting_since` saat owner membalas pesan manual atau saat pesanan diselesaikan/dibatalkan.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/customer/phone.ts` | Modifikasi | Penambahan fungsi `normalizePhone` dan `toChatId` serta penanganan format lokal Indonesia. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan kolom `Order.customer_chat_id` dan indeks `@@index([customer_chat_id, status])`. |
| `dashboard/prisma/migrations/20261104120000_add_customer_chat_id_to_orders/migration.sql` | Baru | Migrasi SQL forward-only penambahan kolom `customer_chat_id` dan indeks status. |
| `dashboard/src/lib/customer/session.ts` | Baru | Helper terpadu `unmuteCustomerSessionByOrder` untuk membuka kunci sesi pelanggan via chat ID / kontak. |
| `dashboard/src/lib/pipeline/schema.ts` | Modifikasi | Penambahan field `inbound_gate.mute_max_hours` (default 48 jam, min 1, max 336). |
| `dashboard/src/lib/pipeline/presets.ts` | Modifikasi | Pendaftaran nilai default `mute_max_hours: 48` pada ketiga preset alur kerja. |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Sinkronisasi `mute_max_hours` pada `syncGraphToCoreConfig`. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Field konfigurasi input batas waktu mute (jam) di panel inspektor `TRIGGER_INBOUND`. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Pengisian `customer_chat_id` saat pesanan dibuat dari alur chat pelanggan. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Pengecekan active order via `customer_chat_id`, bypass mute "MENU"/"BARU", mute TTL reminder, tracking waiting_since, dan reset unread saat owner membalas manual. |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Penggunaan `unmuteCustomerSessionByOrder` saat pesanan diselesaikan. |
| `dashboard/src/app/api/orders/[id]/route.ts` | Modifikasi | Dukungan field `customer_chat_id` dan pembukaan sesi terpadu pasca-penyelesaian/penghapusan order. |
| `dashboard/src/app/api/orders/route.ts` | Modifikasi | Dukungan field `customer_chat_id` pada pembuatan pesanan manual. |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Fungsi `buildOwnerDigestJob` dan evaluasi berkala job `OWNER_DIGEST` pada scheduler tick. |
| `dashboard/scripts/backfill-customer-chat-id.ts` & `scripts/backfill-customer-chat-id.ts` | Baru | Skrip migrasi backfill untuk menyelaraskan data `orders` lama ke `customer_sessions`. |
| `dashboard/tests/unit/s05-order-session-mute.test.ts` | Baru | Pengujian unit normalisasi nomor telepon, unmuter sesi terpadu, dan evaluasi `buildOwnerDigestJob`. |
| `dashboard/tests/unit/inbound-accept.test.ts` | Modifikasi | Pengujian integrasi bypass mute "MENU" dan kedaluwarsa TTL mute. |
| `dashboard/tests/unit/api-orders-id-route.test.ts` | Modifikasi | Pengujian unit `unmuteCustomerSessionByOrder` pada update/delete order. |
| `dashboard/tests/unit/update-order-route.test.ts` | Modifikasi | Pengujian unit `unmuteCustomerSessionByOrder` pada tool update order. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S05. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 35 test file, **348 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
5. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).
6. **Audit Penggunaan `customer_contact`:** Seluruh referensi tersisa adalah pembacaan kontak manusia, parameter display UI, atau fallback data lama.

### 4. Migrasi & Rollback
- Migrasi: `20261104120000_add_customer_chat_id_to_orders` (penambahan kolom `orders.customer_chat_id`, indeks `orders_customer_chat_id_status_idx`).
- Rollback Migrasi:
  ```sql
  DROP INDEX IF EXISTS "orders_customer_chat_id_status_idx";
  ALTER TABLE "orders" DROP COLUMN IF EXISTS "customer_chat_id";
  ```

## [2026-11-04] S06: Validasi Graf Pipeline, SSOT, Kontrol Versi Optimistik, dan Pengamanan Sesi

### 1. Ringkasan Perbaikan
Menerapkan validasi graf alur kerja tingkat server murni (`validateGraph`) untuk mencegah siklus tanpa henti (DAG), port bercabang ganda, variabel template tidak sah, dan pelanggaran singleton trigger (INV-16). Menggantikan sumber data paralel dengan Single Source of Truth (SSOT) melalui fungsi proyeksi murni `projectCoreConfig`. Menambahkan kontrol versi optimistik (HTTP 409) pada penyimpanan alur kerja beserta riwayat versi (tabel `pipeline_config_versions`) dan pemulihan konfigurasi instan (`POST /api/pipeline/rollback`). Memulihkan sesi pelanggan dari pointer router usang (`PIPELINE_POINTER_STALE`) dan membatasi kedalaman rantai pesan maksimal 3 hop dengan runtime cycle guard (`PIPELINE_CYCLE_GUARD`).

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/pipeline/validate-graph.ts` | Baru | Validator server murni untuk graf alur kerja (siklus, port tunggal, singleton trigger, panjang teks, variabel template). |
| `dashboard/src/lib/pipeline/projector.ts` | Baru | Fungsi proyeksi murni `projectCoreConfig` untuk menurunkan 6 kontainer konfigurasi inti secara dinamis dari graf visual (SSOT). |
| `dashboard/src/app/api/pipeline/route.ts` | Modifikasi | Penegakan validasi graf (HTTP 422), kontrol versi optimistik (HTTP 409), pencatatan riwayat versi, dan pemangkasan versi lama (>20). |
| `dashboard/src/app/api/pipeline/reset/route.ts` | Modifikasi | Validasi graf preset alur kerja sebelum reset dan pencatatan riwayat versi baru. |
| `dashboard/src/app/api/pipeline/rollback/route.ts` | Baru | Endpoint pemulihan konfigurasi alur kerja historis berdasarkan nomor versi. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan model `PipelineConfigVersion` dan pemetaan ke tabel `pipeline_config_versions`. |
| `dashboard/prisma/migrations/20261104140000_add_pipeline_config_versions/migration.sql` | Baru | Migrasi SQL forward-only untuk tabel `pipeline_config_versions`. |
| `dashboard/src/lib/pipeline/manager.ts` | Modifikasi | Pembersihan heuristik string rapuh `drive.google.com`/`katalog` dan integrasi proyeksi SSOT `projectCoreConfig`. |
| `dashboard/scripts/repair-pipeline-greeting.ts` & `scripts/repair-pipeline-greeting.ts` | Baru | Skrip idempoten satu kali untuk memperbaiki teks sapaan pipeline yang terkontaminasi. |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Penambahan runtime cycle guard dan batas kedalaman maksimal 3 hop pada `executeChainedCustomNodes` (`PIPELINE_CYCLE_GUARD`). |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Deteksi dan pemulihan pointer router basi ke router akar serta pencatatan `PIPELINE_POINTER_STALE`. |
| `dashboard/src/app/(app)/pipeline/PipelineStudio.tsx` | Modifikasi | Indikator visual error merah pada node kanvas, pelacakan warning alur, tombol simpan dinonaktifkan saat error, dan modal riwayat versi / rollback. |
| `dashboard/src/app/(app)/pipeline/page.tsx` | Modifikasi | Pengambilan riwayat versi awal untuk dimuat langsung di Studio Pipeline. |
| `dashboard/tests/unit/pipeline-validation.test.ts` | Baru | Pengujian unit 9 aturan validasi graf server (siklus, port cabang ganda, panjang teks, template vars, dll). |
| `dashboard/tests/unit/pipeline-route.test.ts` | Baru | Pengujian integrasi API route pipeline (HTTP 422 graf siklik/ganda, HTTP 409 versi usang, HTTP 200 rollback). |
| `dashboard/tests/unit/pipeline-runtime.test.ts` | Baru | Pengujian runtime cycle guard, batas kedalaman 3 hop, pemulihan pointer router basi, dan proyeksi SSOT. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S06. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 38 test file, **366 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
5. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104140000_add_pipeline_config_versions` (pembuatan tabel `pipeline_config_versions` dan indeks versi).
- Rollback Migrasi:
  ```sql
  DROP INDEX IF EXISTS "pipeline_config_versions_version_idx";
  DROP TABLE IF EXISTS "pipeline_config_versions";
  ```

## [2026-11-04] S07: Waktu dan Alarm: Server sebagai Penentu (P1)

### 1. Ringkasan Perbaikan
Menyatukan parsing waktu yang terfragmentasi ke dalam fasad tunggal kanonik `dashboard/src/lib/time/resolve.ts` (`resolveTaskTimes`) guna menegakkan aturan server (INV-03, INV-05). Mengimplementasikan tabel keputusan Kasus A secara deterministik ($R \ge 62$ menit $\to$ 60 menit sebelum tenggat, $12 \le R < 62$ menit $\to \lfloor R/2 \rfloor$ menit sebelum tenggat, $R < 12$ menit $\to$ alarm tepat saat tenggat tanpa pengingat otomatis). Menolak waktu lampau (`REMIND_AT_IN_PAST`), membatasi horizon maksimal 366 hari, menyelaraskan diskrepansi ekspresi vs ISO (`TIME_MISMATCH`), mengembalikan respons jujur (`alarm_will_fire`, `alarm_at_local_text`, `alarm_note`), menambahkan aturan prompt `R-KONFIRMASI-WAKTU`, dan mencegah alarm terbuang dengan kolom `todos.reminder_expired_at` serta pemulihan klaim basi scheduler > 5 menit.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/time/resolve.ts` | Baru | Fasad waktu tunggal kanonik `resolveTaskTimes`, batas Kasus A, validasi waktu lampau, horizon 366 hari, dan `parseFlexibleDueAt`. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan kolom `reminder_expired_at` pada model `Todo` beserta indeks status. |
| `dashboard/prisma/migrations/20261104160000_add_reminder_expired_at_to_todos/migration.sql` | Baru | Migrasi SQL forward-only penambahan kolom `todos.reminder_expired_at`. |
| `dashboard/src/lib/todos/create.ts` | Modifikasi | Delegasi `resolveDueAndReminder` ke `resolveTaskTimes` untuk eliminasi jalur parser ganda (A-06). |
| `dashboard/src/app/api/internal/tools/create-todo-and-order/route.ts` | Modifikasi | Integrasi `resolveTaskTimes` dan penambahan respons transparan `alarm_will_fire`, `alarm_at_local_text`, `alarm_note`. |
| `dashboard/src/app/api/internal/tools/update-todo/route.ts` | Modifikasi | Integrasi `resolveTaskTimes` dan penambahan respons transparan `alarm_will_fire`, `alarm_at_local_text`, `alarm_note`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Penambahan aturan pagar pengaman prompt `R-KONFIRMASI-WAKTU`. |
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Penambahan fungsi `processExpiredAlarms` (>12 jam), `recoverStaleTaskClaims` (>5 menit), dan filter `reminder_expired_at IS NULL`. |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Pemanggilan berkala `recoverStaleTaskClaims` dan `processExpiredAlarms` pada housekeeping serta penyajian pengingat terlewat di Morning Brief. |
| `dashboard/tests/unit/time-resolve.test.ts` | Baru | Pengujian unit 11 skenario batas Kasus A, validasi lampau, horizon, diskrepansi waktu, batas tengah malam WIB, alarm kedaluwarsa, pemulihan klaim basi, dan idempotensi tick. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S07. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 39 test file, **377 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
5. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104160000_add_reminder_expired_at_to_todos` (penambahan kolom `todos.reminder_expired_at` dan indeks).
- Rollback Migrasi:
  ```sql
  DROP INDEX IF EXISTS "todos_status_reminded_at_reminder_expired_at_idx";
  ALTER TABLE "todos" DROP COLUMN IF EXISTS "reminder_expired_at";
  ```

## [2026-11-04] S08: Reliabilitas Scheduler dan Observabilitas (P1)

### 1. Ringkasan Perbaikan
Menerapkan penguncian atomik level database pada tabel `scheduler_locks` dengan masa sewa 55 detik untuk mencegah eksekusi tick scheduler tumpang tindih (`TICK_OVERLAP`) tanpa menggunakan advisory lock pada connection pool. Mengganti ambang hardcode 30 menit menjadi variabel dinamis `SCHEDULER_STALE_MINUTES` (default 3 menit). Membatasi anggaran waktu eksekusi tick (Google Calendar timeout 20 detik) dan memisahkan retry Google sync serial hanya pada interval 5 menit. Menambahkan healthcheck container `botseri-n8n` di `docker-compose.yml`, verifikasi healthy di `smoke.sh`, integrasi dead-man switch eksternal via `HEARTBEAT_URL` (timeout 3 detik), pembersihan batch `pruneOldTickEvents` (maksimal 500 baris, retensi 48 jam), dan memperkaya halaman `/status` dengan 6 metrik observabilitas (Alarm 24 Jam, Circuit Breaker WAHA, LLM 429 Throttle, Sesi Menunggu, Versi Pipeline, dan Tick Overlap).

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan model `SchedulerLock` dan pemetaan ke tabel `scheduler_locks`. |
| `dashboard/prisma/migrations/20261104180000_add_scheduler_locks/migration.sql` | Baru | Migrasi SQL forward-only pembuatan tabel `scheduler_locks`. |
| `dashboard/src/lib/scheduler/tick.ts` | Modifikasi | Penguncian atomik `scheduler_locks`, batas waktu Calendar 20s via `Promise.withResolvers`, interval sync Google 5m, integrasi `HEARTBEAT_URL`, dan batch prune. |
| `dashboard/src/app/api/internal/scheduler/tick/route.ts` | Modifikasi | Penanganan `TICK_OVERLAP` agar tidak mencatat `TICK_OK` saat eksekusi tumpang tindih dilewati. |
| `dashboard/src/lib/analytics/helpers.ts` | Modifikasi | Implementasi `getSchedulerStaleMinutes` dan pembaruan `tickHealth` berbasis ambang dinamis. |
| `dashboard/src/lib/waha/humanizer.ts` | Modifikasi | Ekspor fungsi `getWahaCircuitBreakerStatus` untuk observabilitas status pendinginan breaker WAHA. |
| `dashboard/src/app/(app)/status/page.tsx` | Modifikasi | Penambahan banner stale dinamis dan 6 panel metrik baru (alarm 24h, breaker WAHA, LLM 429, sesi menunggu, versi pipeline, overlap). |
| `docker-compose.yml` | Modifikasi | Penambahan blok `healthcheck` untuk service `botseri-n8n` menggunakan endpoint `/healthz`. |
| `scripts/smoke.sh` | Modifikasi | Penambahan pemeriksaan status container `botseri-n8n` berstatus `healthy`. |
| `docs/RUNBOOK.md` | Modifikasi | Sinkronisasi interval tick 1 menit, ambang `SCHEDULER_STALE_MINUTES`, arsitektur `scheduler_locks`, dan panduan dead-man switch. |
| `dashboard/tests/unit/scheduler-reliability.test.ts` | Baru | Pengujian unit kunci atomik `TICK_OVERLAP`, pemulihan kunci basi, ambang stale dinamis, dan ketahanan dead-man switch `HEARTBEAT_URL`. |
| `dashboard/tests/unit/analytics-helpers.test.ts` | Modifikasi | Penyelarasan pengujian unit `tickHealth` dengan ambang stale dinamis. |
| `dashboard/tests/unit/time-resolve.test.ts` | Modifikasi | Penyelarasan urutan kueri mock `$queryRaw` dengan penguncian atomik scheduler. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S08. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 40 test file, **383 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Smoke Test:** `./scripts/smoke.sh` lulus bersih (11 pemeriksaan lulus, 0 kegagalan).
5. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
6. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104180000_add_scheduler_locks` (pembuatan tabel `scheduler_locks`).
- Rollback Migrasi:
  ```sql
  DROP TABLE IF EXISTS "scheduler_locks";
  ```

## [2026-11-04] S09: WAHA: Antrean Prioritas, Batas Pelanggan, dan Debounce (P1)

### 1. Ringkasan Perbaikan
Menerapkan antrean berbobot prioritas P0-P2 pada `humanizer.ts` (`TASK_ALARM`, `NEW_ORDER_ALERT`, `OWNER_DIGEST`, `PAIRING` sebagai P0 mendahului antrean) dengan pembersihan pesan basi (P2 TTL 120 detik mencatat `WAHA_QUEUE_EXPIRED`). Mengamankan kuota reservasi anti-kelaparan P0 (1 slot/menit dan 5 slot/jam eksklusif untuk P0). Menetapkan batas laju pelanggan (maksimal 12 pesan keluar/jam per pelanggan dan 30 pesan masuk/jam per pengirim), menambahkan kolom `blocked_at` pada `customer_sessions` serta endpoint `/api/customer/block` dan `/api/customer/unblock`. Menerapkan persistensi state Circuit Breaker dan lazy init rate limiter pada tabel `runtime_flags`, endpoint reset guard `POST /api/waha/guard/reset`, tombol reset guard di `/status`, debounce gelembung pesan formulir pelanggan (< 2 detik), penggabungan alert pesanan baru (> 3 dalam 10 menit), dan banner peringatan mode bypass testing di `/status`.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/waha/triggers.ts` | Modifikasi | Pendaftaran pemetaan prioritas trigger `TRIGGER_PRIORITY` dengan `PAIRING` sebagai prioritas P0. |
| `dashboard/src/lib/waha/humanizer.ts` | Modifikasi | Antrean berbobot prioritas P0-P2, kuota reservasi P0, TTL guard P2 120s, persistensi breaker via `runtime_flags`, dan lazy init. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan kolom `customer_sessions.blocked_at` dan model `RuntimeFlag` (`runtime_flags`). |
| `dashboard/prisma/migrations/20261104200000_add_runtime_flags_and_blocked_at/migration.sql` | Baru | Migrasi SQL forward-only penambahan kolom `blocked_at` dan tabel `runtime_flags`. |
| `dashboard/src/app/api/waha/guard/reset/route.ts` | Baru | Endpoint reset guard circuit breaker WAHA terproteksi sesi dan validasi origin CSRF. |
| `dashboard/src/app/api/customer/block/route.ts` | Baru | Endpoint pemblokiran nomor pelanggan (`blocked_at`). |
| `dashboard/src/app/api/customer/unblock/route.ts` | Baru | Endpoint pembukaan blokir nomor pelanggan. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Pengecekan blocklist pelanggan dan batas maksimal 30 pesan masuk/jam per pengirim (`INBOUND_HOURLY_LIMIT`). |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Debounce pesan beruntun pelanggan (< 2 detik) pada status `AWAITING_ORDER` dan penggabungan alert owner jika > 3 pesanan dalam 10 menit. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Modifikasi | Penerusan jenis trigger ke `sendHumanizedMessage` untuk evaluasi prioritas antrean. |
| `dashboard/src/app/(app)/status/ResetGuardButton.tsx` | Baru | Komponen tombol Reset Guard dengan dialog konfirmasi keselamatan. |
| `dashboard/src/app/(app)/status/page.tsx` | Modifikasi | Integrasi tombol Reset Guard dan banner peringatan kontras tinggi mode bypass pengujian. |
| `dashboard/src/app/(app)/orders/OrderBoard.tsx` | Modifikasi | Aksi pemblokiran/buka blokir kontak pelanggan langsung dari tabel pesanan. |
| `docs/RUNBOOK.md` | Modifikasi | Dokumentasi antrean prioritas, kuota reservasi P0, dan panduan kapan aman/dilarang mereset guard. |
| `dashboard/tests/unit/waha-priority-guard.test.ts` | Baru | Pengujian unit antrean prioritas, reservasi kuota P0, TTL 120s, debounce chat pelanggan, persistensi breaker, dan endpoint reset guard. |
| `dashboard/tests/unit/waha-humanizer.test.ts` | Modifikasi | Penyelarasan pengujian rate limiter dengan parameter trigger P0. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S09. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 41 test file, **389 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Smoke Test:** `./scripts/smoke.sh` lulus bersih (11 pemeriksaan lulus, 0 kegagalan).
5. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
6. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104200000_add_runtime_flags_and_blocked_at` (penambahan kolom `customer_sessions.blocked_at` dan tabel `runtime_flags`).
- Rollback Migrasi:
  ```sql
  DROP TABLE IF EXISTS "runtime_flags";
  ALTER TABLE "customer_sessions" DROP COLUMN IF EXISTS "blocked_at";
  ```

## [2026-11-04] S10: Refactor Duplikasi dan Satu Engine (P2)

### 1. Ringkasan Perbaikan
Mengonsolidasikan arsitektur internal tanpa regresi fungsional:
1. Menyatukan manipulasi database pesanan dan sesi pelanggan ke dalam service domain tunggal `dashboard/src/lib/orders/service.ts` (`completeOrder`, `cancelOrder`, `softDeleteOrder`, `setOrderStatus`, `markPayment`, `hasActiveOrder`, `releaseCustomerSession`, `listOrdersSegmented`), serta merefaktor seluruh endpoint pemanggil menjadi pembungkus tipis.
2. Menetapkan spesifikasi kanonik tunggal `getPrimaryOwner` pada `dashboard/src/lib/owner/primary.ts` dengan pembersihan pra-migrasi dan penegakan unique index parsial PostgreSQL (`authorized_numbers_one_primary` pada `is_primary = true`).
3. Menyatukan evaluator alur kerja visual ke dalam satu engine terpadu `dashboard/src/lib/pipeline/engine.ts` (`runPipelineStep`) dan menghubungkan simulator studio `simulator.ts` langsung ke engine inti untuk eliminasi percabangan graf paralel.
4. Menambahkan 20 skenario uji paritas simulator vs runtime yang membuktikan konsistensi hasil eksekusi 100%.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/orders/service.ts` | Baru | Service domain pesanan atomik, segmentasi pesanan, pengecekan pesanan aktif, dan pembukaan sesi pelanggan. |
| `dashboard/src/lib/owner/primary.ts` | Baru | Modul kanonik tunggal penentuan owner utama Botseri (`getPrimaryOwner`) dengan mekanisme auto-heal. |
| `dashboard/prisma/migrations/20261104220000_add_unique_primary_owner_index/migration.sql` | Baru | Migrasi SQL forward-only pembersihan data dan pembuatan indeks unik parsial `authorized_numbers_one_primary`. |
| `dashboard/src/lib/pipeline/engine.ts` | Baru | Mesin alur kerja visual murni terpadu `runPipelineStep` untuk evaluasi simpul runtime dan simulasi. |
| `dashboard/src/lib/pipeline/simulator.ts` | Baru | Simulator studio yang mendelegasikan eksekusi langsung ke `runPipelineStep` (`dryRun: true`). |
| `dashboard/src/lib/pipeline/graph-runner.ts` | Modifikasi | Re-ekspor `simulatePipelineExecution` dari `simulator.ts` untuk eliminasi duplikasi logika simulator. |
| `dashboard/src/app/api/internal/tools/get-orders/route.ts` | Modifikasi | Refactor menjadi pemanggil tipis fungsi `listOrdersSegmented` pada service pesanan. |
| `dashboard/src/app/api/internal/tools/update-order/route.ts` | Modifikasi | Refactor pembaruan pesanan via service dan standarisasi pengambilan owner via `getPrimaryOwner`. |
| `dashboard/src/app/api/orders/[id]/route.ts` | Modifikasi | Penggunaan `softDeleteOrder` pada penghapusan pesanan dan import service. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Pengecekan active order pelanggan via `getActiveOrderForCustomer` dari service. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Standarisasi pengambilan owner utama via `getPrimaryOwner` dari `owner/primary.ts`. |
| `dashboard/src/app/api/internal/scheduler/jobs/[jobId]/result/route.ts` | Modifikasi | Import langsung `getPrimaryOwner` dari `owner/primary.ts`. |
| `dashboard/src/lib/scheduler/queries.ts` | Modifikasi | Re-ekspor kanonik `getPrimaryOwner` dari `owner/primary.ts`. |
| `dashboard/tests/unit/orders-service.test.ts` | Baru | Pengujian unit 8 skenario service transaksi pesanan dan kebijakan buka kunci sesi. |
| `dashboard/tests/unit/owner-primary.test.ts` | Baru | Pengujian unit spesifikasi kanonik `getPrimaryOwner` dan auto-heal. |
| `dashboard/tests/unit/pipeline-parity.test.ts` | Baru | Pengujian paritas 20 skenario alur graf simulator vs runtime. |
| `dashboard/tests/unit/authorized-numbers.test.ts` | Modifikasi | Penyelarasan pengujian unit `getPrimaryOwner` dengan spesifikasi kanonik S10. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S10. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 44 test file, **420 test cases** lulus 100%.
2. **Audit Pembersihan Kode:**
   - `grep -Rn "getPrimaryOwner" dashboard/src`: Terpusat mengimpor dari `lib/owner/primary.ts`.
   - Paritas Simulator vs Runtime: 20/20 skenario terverifikasi menghasilkan `next_state`, `nodeTrace`, dan `replies` identik.
3. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
4. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
5. **Smoke Test:** `./scripts/smoke.sh` lulus bersih (11 pemeriksaan lulus, 0 kegagalan).
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
7. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104220000_add_unique_primary_owner_index` (pembersihan pra-migrasi dan indeks unik parsial `authorized_numbers_one_primary`).
- Rollback Migrasi:
  ```sql
  DROP INDEX IF EXISTS "authorized_numbers_one_primary";
  ```

## [2026-11-04] S11: LLM Gateway: Konfigurasi Nyata, Klasifikasi Error, dan Gemini (P2)

### 1. Ringkasan Perbaikan
Menerapkan penimpaan parameter otoritatif (`temperature` dan `max_output_tokens`) dari database aktif pada gateway internal untuk mengatasi nilai statis default n8n, dengan kompensasi lantai 4096 token khusus model thinking. Mengklasifikasikan error upstream ke format terstruktur `ProviderErrorKind` (`RATE_LIMIT`, `AUTH`, `TIMEOUT`, `BAD_REQUEST`, `UPSTREAM`, `TRUNCATED`) serta menyelaraskan node penanganan fallback di n8n (`botseri-inbound-agent.json`). Mendeteksi output terpotong (`finish_reason: "length"`) dan mencatat `LLM_TRUNCATED`. Menambahkan retry 1x dengan penghormatan `Retry-After` <= 5 detik, migrasi kolom `is_fallback` pada `llm_configs` dengan indeks parsial unik di PostgreSQL, otomatis failover ke model cadangan (`LLM_FALLBACK_TRIGGERED`), serta banner peringatan model gratis di UI. Mengamankan adapter Gemini dengan pengiriman API key via header `x-goog-api-key` (menghapus `?key=` dari URL), pembersihan skema OpenAPI berbasis whitelist ketat, dan stabilisasi ID pemanggilan tool.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `dashboard/src/lib/llm-gateway/errors.ts` | Baru | Definisi tipe terstruktur `ProviderErrorKind`, `ProviderError`, `OutputTruncatedError`, dan serialisasi JSON standar. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan kolom `is_fallback` pada model `LlmConfig`. |
| `dashboard/prisma/migrations/20261104230000_add_is_fallback_to_llm_configs/migration.sql` | Baru | Migrasi SQL forward-only penambahan kolom `is_fallback` dan indeks unik parsial `llm_configs_one_fallback`. |
| `dashboard/src/lib/llm-gateway/index.ts` | Modifikasi | Implementasi retry 1x, otomatis failover ke model fallback (`getFallbackConfig`), dan deteksi output terpotong. |
| `dashboard/src/lib/llm-gateway/gemini.ts` | Modifikasi | Pembersihan skema whitelist resmi OpenAPI, header `x-goog-api-key`, kompensasi model thinking, dan penghapusan query `?key=`. |
| `dashboard/src/lib/llm-gateway/catalog.ts` | Modifikasi | Pemanggilan katalog Gemini via header `x-goog-api-key` tanpa query parameter. |
| `dashboard/src/app/api/internal/llm/v1/chat/completions/route.ts` | Modifikasi | Penimpaan parameter otoritatif dari database dan pemetaan response error terklasifikasi. |
| `dashboard/src/app/api/llm/configs/route.ts` | Modifikasi | Validasi dan penanganan kolom `is_fallback` pada pembuatan konfigurasi LLM baru. |
| `dashboard/src/app/api/llm/configs/[id]/route.ts` | Modifikasi | Dukungan pembaruan status `is_fallback` pada konfigurasi LLM tersimpan. |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Modifikasi | Checkbox model fallback, badge model fallback pada daftar kartu, dan banner peringatan model gratis. |
| `dashboard/src/app/(app)/integrations/page.tsx` | Modifikasi | Penerusan nilai `is_fallback` ke panel Integrasi. |
| `n8n-engine/workflows/botseri-inbound-agent.json` | Modifikasi | Pembaruan node fallback error n8n berbasis `error.code` terstruktur dan penanganan pesan terpotong. |
| `dashboard/tests/unit/llm-gateway.test.ts` | Baru | Pengujian unit penimpaan parameter, batas lantai model thinking, deteksi output terpotong, retry, dan failover model fallback. |
| `dashboard/tests/unit/gemini-adapter.test.ts` | Modifikasi | Pengujian unit header API key Gemini, url bersih dari query key, dan pembersih skema whitelist. |
| `dashboard/tests/unit/llm-gateway-route.test.ts` | Modifikasi | Penyelarasan mock error gateway dengan tipe `OutputTruncatedError`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S11. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 45 test file, **424 test cases** lulus 100%.
2. **Audit Keamanan Kunci API:**
   - `grep -Rn "generativelanguage.*key=" dashboard/src`: 0 temuan (URL bersih, kunci dikirim via header `x-goog-api-key`).
3. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
4. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
5. **Smoke Test:** `./scripts/smoke.sh` lulus bersih (11 pemeriksaan lulus, 0 kegagalan).
6. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
7. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261104230000_add_is_fallback_to_llm_configs` (penambahan kolom `is_fallback` dan indeks unik parsial `llm_configs_one_fallback`).
- Rollback Migrasi:
  ```sql
  DROP INDEX IF EXISTS "llm_configs_one_fallback";
  ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "is_fallback";
  ```

## [2026-11-05] S12: Privasi Data Pelanggan dan Retensi (P2)

### 1. Ringkasan Perbaikan
Menerapkan kerangka kerja privasi data pelanggan menyeluruh:
1. Menyusun dokumen inventaris data pribadi kanonik `docs/DATA-PRIVACY.md` yang merinci tabel PII (`orders`, `customer_sessions`, `message_log`, `authorized_numbers`), tujuan, masa retensi, hak subjek data, dan penafian kepatuhan hukum UU PDP.
2. Membangun utilitas `dashboard/src/lib/security/redact.ts` untuk redaksi nomor telepon dan email sebelum payload dikirim ke LLM Gateway (`redactForLlm`) serta masking log audit (`maskPhone`, `maskChatId`).
3. Menambahkan pengaturan retensi dan privasi pada `bot_settings` (`customer_data_retention_days` default 365, `ai_form_fallback_requires_paid_model` default false) beserta migrasi forward-only.
4. Membangun skrip retensi otomatis `scripts/retention.ts` (bawaan `--dry-run`) untuk pembersihan pesan log > 90 hari, sesi inaktif > 90 hari, anonimisasi pesanan lama > 365 hari (menjaga integritas agregat keuangan), dan pembersihan soft-delete > 30 hari.
5. Membangun skrip penghapusan data atas permintaan `scripts/purge-customer.ts` (Right to be Forgotten) dan mendokumentasikan panduan eksekusi pada `docs/RUNBOOK.md`.
6. Menambahkan banner peringatan privasi untuk model gratis pada UI Integrasi.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `docs/DATA-PRIVACY.md` | Baru | Dokumen inventaris data pribadi, retensi, hak subjek data, dan penafian hukum. |
| `dashboard/src/lib/security/redact.ts` | Baru | Utilitas redaksi teks PII untuk LLM (`redactForLlm`) dan penyamaran nomor/chat ID (`maskPhone`, `maskChatId`). |
| `dashboard/src/lib/security/retention.ts` | Baru | Mesin inti retensi berkala (`runRetention`) dan penghapusan data pelanggan atas permintaan (`purgeCustomerData`). |
| `dashboard/scripts/retention.ts` & `scripts/retention.ts` | Baru | CLI skrip retensi otomatis dengan mode aman `--dry-run` bawaan dan opsi `--apply`. |
| `dashboard/scripts/purge-customer.ts` & `scripts/purge-customer.ts` | Baru | CLI skrip penghapusan data pribadi pelanggan berdasarkan nomor atau chat ID. |
| `dashboard/prisma/schema.prisma` | Modifikasi | Penambahan kolom `customer_data_retention_days` dan `ai_form_fallback_requires_paid_model` pada `BotSettings`. |
| `dashboard/prisma/migrations/20261105090000_add_privacy_settings_to_bot_settings/migration.sql` | Baru | Migrasi SQL forward-only penambahan kolom pengaturan privasi. |
| `dashboard/src/app/api/internal/customer/handle/route.ts` | Modifikasi | Penerapan `redactForLlm` pada teks formulir sebelum dikirim ke fallback LLM dan pembatasan model berbayar. |
| `dashboard/src/app/api/internal/inbound/accept/route.ts` | Modifikasi | Penyamaran nomor telepon dan chat ID pada pencatatan log audit event (`maskPhone`, `maskChatId`). |
| `dashboard/src/lib/analytics/helpers.ts` | Modifikasi | Re-ekspor fungsi `maskChatId` dan `maskPhone` dari modul kanonik `redact.ts`. |
| `dashboard/src/lib/waha/humanizer.ts` | Modifikasi | Penerapan `maskChatId` pada seluruh pencatatan event audit WAHA. |
| `dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx` | Modifikasi | Penambahan banner peringatan privasi untuk penggunaan model gratis. |
| `docs/RUNBOOK.md` | Modifikasi | Panduan operasional eksekusi skrip `retention.ts` dan `purge-customer.ts`. |
| `dashboard/tests/unit/privacy-redact.test.ts` | Baru | Pengujian unit fungsi redaksi teks PII dan masking nomor/chat ID. |
| `dashboard/tests/unit/retention.test.ts` | Baru | Pengujian unit skrip retensi dry-run, apply, dan pembersihan customer data. |
| `dashboard/tests/unit/reminder-logic.test.ts` | Modifikasi | Penyelarasan mock `dummySettings` dengan kolom baru `BotSettings`. |
| `dashboard/tests/unit/analytics-helpers.test.ts` | Modifikasi | Penyelarasan pengujian unit `maskChatId` dengan format domain WhatsApp. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S12. |

### 3. Hasil Verifikasi
1. **Unit Test Suite:** 47 test file, **432 test cases** lulus 100%.
2. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
3. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
4. **Smoke Test:** `./scripts/smoke.sh` lulus bersih (11 pemeriksaan lulus, 0 kegagalan).
5. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
6. **Secret Scanner:** `./scripts/check-secrets.sh` lulus bersih (exit code 0).

### 4. Migrasi & Rollback
- Migrasi: `20261105090000_add_privacy_settings_to_bot_settings` (penambahan kolom `customer_data_retention_days` dan `ai_form_fallback_requires_paid_model`).
- Rollback Migrasi:
  ```sql
  ALTER TABLE "bot_settings" DROP COLUMN IF EXISTS "ai_form_fallback_requires_paid_model";
  ALTER TABLE "bot_settings" DROP COLUMN IF EXISTS "customer_data_retention_days";
  ```

## [2026-11-05] S13: Staging, Test Integrasi, dan Evaluasi Prompt (P2)

### 1. Ringkasan Perbaikan
Menerapkan profil staging, pengujian integrasi end-to-end, evaluasi prompt terotomatisasi, serta restrukturisasi template prompt:
1. **Profil Staging Terisolasi (`docker-compose.staging.yml`):** Konfigurasi Docker Compose dengan database terpisah (`botseri_staging`), port terisolasi (3001, 3002, 5433, 5679), `WAHA_MOCK_OUTBOUND=1`, dan `WAHA_FAST_TEST=1` tanpa Cloudflare tunnel.
2. **Otomasi Staging (`scripts/staging-up.sh`):** Skrip otomasi startup, migrasi database staging, dan seeding data awal.
3. **Seeding Terproteksi (`scripts/staging-seed.ts`):** Validasi ketat `DATABASE_URL` yang menolak eksekusi jika tidak mengarah ke database staging, menginisialisasi data terstandarisasi dengan prefiks `TEST-`.
4. **Suite Test Integrasi (`dashboard/tests/integration/pipeline-e2e.test.ts`):** Mengimplementasikan 8 skenario integrasi menyeluruh mencakup alur pelanggan baru, formulir tidak lengkap, siklus mute-digest-unmute, konfirmasi destruktif dua langkah idempoten, alarm dedup, validasi graf dan kontrol versi optimistik, antrean prioritas P0 vs P2, serta failover LLM gateway 429.
5. **Evaluasi Prompt Otomatis (`scripts/eval-prompt.ts` & `dashboard/tests/prompt-eval/cases.yaml`):** Membangun suite 30 kasus ucapan Owner dengan validasi ekspektasi tool, parameter, dan kata terlarang; mendukung mode `--mock` (deterministik di CI) dan `--live` (manual) dengan ambang kelulusan 100% pada kategori keamanan prompt injection dan tindakan destruktif.
6. **Restrukturisasi Prompt Kanonik (`dashboard/src/lib/prompt/templates/base.id.md`):** Menata ulang template prompt sistem menjadi modul dengan ID stabil (`R-SAPA`, `R-BUAT-TUGAS`, `R-WAKTU`, `R-LIHAT-TUGAS`, `R-PESANAN`, `R-KONFIRMASI`, `R-UNTRUSTED`, `R-GAYA`), membersihkan rujukan aturan yang membingungkan, dan memangkas ukuran menjadi 6.716 karakter (anggaran <= 9.000 karakter).
7. **Peningkatan Smoke Test (`scripts/smoke.sh`):** Menambahkan penghitung dinamis `PASSED_COUNT/TOTAL_COUNT`, pemeriksaan read-only `get-orders`, auth guard `/api/pipeline`, dan indikator migrasi pada healthcheck.
8. **Integrasi Pipeline CI (`.github/workflows/ci.yml`):** Memperbarui CI dengan service container PostgreSQL, pengujian integrasi Vitest, dan evaluasi prompt dalam mode aman.

### 2. Berkas Dibuat & Dimodifikasi

| Path Berkas | Status | Deskripsi Perubahan |
|---|---|---|
| `docker-compose.staging.yml` | Baru | Konfigurasi Docker Compose staging terisolasi (DB terpisah, mock WAHA, port khusus). |
| `scripts/staging-up.sh` | Baru | Skrip bash otomasi menyalakan container staging, migrasi DB, dan seeding. |
| `scripts/staging-seed.ts` & `dashboard/scripts/staging-seed.ts` | Baru | Skrip inisialisasi data uji staging dengan pengaman ketat `DATABASE_URL`. |
| `dashboard/tests/integration/pipeline-e2e.test.ts` | Baru | Suite pengujian integrasi end-to-end 8 skenario menyeluruh. |
| `dashboard/tests/prompt-eval/cases.yaml` | Baru | Kumpulan 30 kasus uji ucapan Owner untuk evaluasi prompt LLM. |
| `scripts/eval-prompt.ts` | Baru | Skrip pengevaluasi prompt otomatis dengan mode `--mock` dan `--live`. |
| `dashboard/src/lib/prompt/templates/base.id.md` | Modifikasi | Restrukturisasi prompt sistem agen dengan ID stabil dan pemangkasan anggaran karakter (6.716 chars). |
| `scripts/smoke.sh` | Modifikasi | Penghitung dinamis pemeriksaan, pengecekan `get-orders`, auth guard pipeline, dan indikator migrasi. |
| `.github/workflows/ci.yml` | Modifikasi | Integrasi service container PostgreSQL, test integrasi, dan evaluasi prompt di CI. |
| `dashboard/package.json` | Modifikasi | Penambahan perintah `test:integration`, `test:all`, dan `eval:prompt`. |
| `updates.md` | Modifikasi | Dokumentasi log kronologis perbaikan Section S13. |

### 3. Hasil Verifikasi
1. **Test Integrasi:** 8 dari 8 skenario lulus 100% (`npm run test:integration`).
2. **Evaluasi Prompt:** 30 dari 30 kasus lulus 100% (`npm run eval:prompt -- --mock`), kategori keamanan 100% lulus.
3. **Unit Test Suite:** 47 test file, 432 test cases lulus 100% (`npm test -- --run`).
4. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` lulus bersih (0 error, 0 warning).
5. **Build Standalone:** `npm run build` sukses mengompilasi 27 rute Next.js.
6. **Validasi Workflow n8n:** `./scripts/validate-workflows.sh` lulus bersih (2 file valid).
7. **Pemindaian Rahasia:** `./scripts/check-secrets.sh` lulus bersih (0 rahasia terekspos).
8. **Pengaman Basis Data:** `staging-seed.ts` terbukti langsung menghentikan proses saat `DATABASE_URL` mengarah ke database non-staging/produksi.
9. **Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 4. Migrasi & Rollback
- Migrasi: Tidak ada migrasi skema database baru pada Section S13 (skema tetap stabil).

## [2026-11-05] S14: Dokumentasi, Operasional, dan Penutupan Utang Lama (P2)

### 1. Ringkasan Pekerjaan
1. **Pencabutan Sesi JWT (`token_version`):**
   - Menambahkan kolom `token_version` pada tabel `admin_users` dengan default `0`.
   - Menyertakan klaim `token_version` pada penerbitan JWT di endpoint login (`/api/auth/login`) dan setup (`/api/setup`).
   - Memperbarui `getSession()` untuk memverifikasi `token_version` dari token terhadap nilai di database; token usang seketika ditolak dengan `null` / HTTP 401.
   - Memperbarui endpoint logout (`/api/auth/logout`) untuk menaikkan `token_version` secara atomik (`increment: 1`) sehingga seluruh token JWT aktif sebelumnya dicabut seketika.
2. **Constraint Singleton Tabel Pengaturan (`bot_settings`):**
   - Menambahkan CHECK constraint `bot_settings_single_row CHECK (id = 1)` via migrasi SQL forward-only.
3. **Penyusunan Checklist Penutupan Step 07:**
   - Menyusun `docs/reports/step-07-closure-checklist.md` berisi 6 butir verifikasi operasional manual untuk dieksekusi pemilik proyek tanpa mencentang `00-MASTER-ROADMAP.md`.
4. **Sinkronisasi Dokumentasi Sistem:**
   - `docs/ARCHITECTURE.md`: Menambahkan Bagian 23 merangkum Jalur Pelanggan, Studio Pipeline, Standarisasi Waktu & Alarm, Konfirmasi Destruktif Dua Langkah, LLM Gateway Failover, serta Antrean WAHA Humanizer.
   - `docs/DATABASE.md`: Memperbarui kamus data tabel (`admin_users`, `bot_settings`, `orders`, `todos`, `authorized_numbers`, `llm_configs`) dan mendokumentasikan tabel baru (`customer_sessions`, `pipeline_configs`, `pipeline_config_versions`, `pending_confirmations`, `scheduler_locks`, `runtime_flags`).
   - `docs/RUNBOOK.md`: Menghapus klaim frekuensi cron 15 menit menjadi 1 menit, mendokumentasikan rate limiter single-replica, `SETUP_TOKEN`, banner STALE, reset guard WAHA, troubleshooting tree pelanggan tidak dibalas, dan rollback alur.
   - `docs/reports/step-08-execution-report.md`: Menambahkan catatan ralat bertanggal (*Errata*) untuk hitungan `llm_configs`, ringkasan smoke test, dan respon 404 vs 401.
   - `updates.md`: Menambahkan Daftar Isi dan catatan historis tabel `customer_sessions`.

### 2. Commit Git
- Commit format `G-04`: `feat(s14): pencabutan jwt token_version, constraint bot_settings, checklist step 07, dan sinkronisasi dokumentasi sistem`

### 3. Migrasi dan Rollback
- **Migrasi 1:** `20261105110000_add_token_version_to_admin_users`
  - SQL: `ALTER TABLE "admin_users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;`
  - Rollback: `ALTER TABLE "admin_users" DROP COLUMN IF EXISTS "token_version";`
- **Migrasi 2:** `20261105120000_add_bot_settings_single_row_constraint`
  - SQL: `ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_single_row" CHECK (id = 1);`
  - Rollback: `ALTER TABLE "bot_settings" DROP CONSTRAINT IF EXISTS "bot_settings_single_row";`

### 4. Bukti Verifikasi
1. **Unit Test S14:** `npx vitest run tests/unit/auth-token-version.test.ts tests/unit/db-constraints.test.ts` · **8 passed** (5 token version, 3 db constraint).
2. **Unit Test Suite Lengkap:** `npm test -- --run` · **49 test files, 440 passed** (100% lulus, exit code 0).
3. **Integration Test Suite:** `npm run test:integration` · **8 passed** (100% lulus, exit code 0).
4. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · **30 passed** (100% lulus, exit code 0).
5. **Typecheck & Lint:** `npx tsc --noEmit` dan `npm run lint` · **Lulus bersih (0 error, 0 warning)**.
6. **Build Standalone:** `npm run build` · **Lulus (27 routes compiled)**.
7. **Workflow Validation:** `./scripts/validate-workflows.sh` · **Lulus (2 files valid)**.
8. **Pemeriksaan Bebas Em Dash (R-02):** `git diff | grep -nE "[—–]"` · **Bersih (0 em dash)**.
9. **Audit Klaim 15 Menit:** `grep -n "15 menit" docs/RUNBOOK.md` · **Bersih (0 temuan)**.
10. **Roadmap Lock (G-07):** `git diff docs/steps/00-MASTER-ROADMAP.md` · **Tidak ada perubahan (0 diff)**.

### 5. Known Issues / Catatan Operasional
- Penolakan token lama saat logout memerlukan koneksi database yang aktif; jika database down, fallback keamanan menolak token yang tidak dapat divalidasi.
- Kotak centang pada `docs/reports/step-07-closure-checklist.md` sengaja dibiarkan kosong `[ ]` dan roadmap Step 07 tetap tidak dicentang hingga pemilik sistem melakukan verifikasi fisik WhatsApp di lingkungan operasional nyata.

## [2026-11-05] S15: Akseptansi Akhir dan Penutupan Patch Plan

### 1. Ringkasan Pekerjaan
1. **Verifikasi Gerbang Kualitas Penuh:**
   - Menjalankan 9 gerbang pengujian sistem: typecheck (`tsc`), linting (`eslint`), unit test regresi, test integrasi 8 skenario, evaluasi prompt 30 kasus, Next.js build standalone, validasi 2 workflow n8n, scanner rahasia, dan smoke test 14/14 titik.
2. **Matriks Akseptansi 25 Butir Temuan:**
   - Memvalidasi dan mendokumentasikan penyelesaian 25 butir temuan kanonik dari S01 hingga S14 berbasis bukti kode dan terminal nyata.
3. **Penyusunan Laporan Penutupan Komprehensif:**
   - Membuat dokumen resmi `docs/reports/patch-final-report.md` merangkum pencapaian arsitektur, daftar periksa tindakan manual pemilik sistem, analisis risiko tersisa, dan rekomendasi operasional.
4. **Kepatuhan Invarian Kunci:**
   - Roadmap `docs/steps/00-MASTER-ROADMAP.md` dipertahankan tidak disentuh (`G-07`), mematuhi prinsip anti-halusinasi dan pendelegasian verifikasi manual lapangan ke pemilik sistem.

### 2. Commit Git
- Commit format `G-04`: `docs(s15): matriks akseptansi akhir dan laporan penutupan patch plan`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada migrasi skema database baru pada Section S15 (tahap audit dan akseptansi murni).

### 4. Bukti Verifikasi
1. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
2. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
3. **Unit Test Suite:** `npm test -- --run` · 49 test files, 440 test cases passed (100% lulus, exit code 0).
4. **Integration Test Suite:** `npm run test:integration` · 8 dari 8 skenario lulus (100% lulus, exit code 0).
5. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 dari 30 kasus lulus (100% lulus, exit code 0).
6. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
7. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
8. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
9. **Smoke Test:** `./scripts/smoke.sh` · 14 dari 14 titik pemeriksaan lulus (14/14 PASS, exit code 0).
10. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.
11. **Roadmap Lock G-07:** Berkas `docs/steps/00-MASTER-ROADMAP.md` bersih dari perubahan (0 diff).

### 5. Known Issues / Catatan Operasional
- Seluruh tindakan manual yang memerlukan perangkat fisik WhatsApp atau akun eksternal owner telah dipusatkan pada Bagian 4 dokumen `docs/reports/patch-final-report.md` dan `docs/reports/step-07-closure-checklist.md`.

## [2026-11-05] Hotfix: Kompatibilitas Promise Antrean WAHA & Pencegahan Hang Studio Alur

### 1. Ringkasan Pekerjaan
1. **Ponyfill Kompatibilitas Node.js 20 (`createDeferredPromise`):**
   - Membangun utilitas `dashboard/src/lib/utils/promise.ts` yang menyediakan fungsi `createDeferredPromise<T>()` untuk menggantikan ketergantungan API Node.js 22+ (`Promise.withResolvers`).
   - Mengganti seluruh pemanggilan `Promise.withResolvers` di `humanizer.ts` (antrean prioritas WAHA) dan `tick.ts` (timeout kalender).
   - Menambahkan pengujian unit pada `waha-priority-guard.test.ts` untuk memastikan antrean prioritas berjalan mulus saat `Promise.withResolvers` tidak terdefinisi.
2. **Pencegahan Infinite Re-render Loop & Browser Freeze di Studio Alur:**
   - Memperbaiki re-render tak berujung pada `PipelineStudio.tsx` dengan memoisasi `errorSignature` sebagai string primitif dan mengembalikan referensi `nds` lama jika tidak ada perubahan error status pada node.
   - Memperkuat penelusuran DFS cycle detection di `validate-graph.ts` dengan deduplikasi tetangga simpul (`adj` list) dan penjagaan rekursi kedalaman rantai pesan hanya saat graf bebas siklus tak terhingga.
3. **Ketahanan SSR Halaman Studio Alur:**
   - Membungkus pembacaan database pada `dashboard/src/app/(app)/pipeline/page.tsx` dengan blok try/catch defensif dan memberikan fallback preset default valid jika database/parsing mengalami kegagalan, mencegah Error Boundary terpicu saat refresh.

### 2. Commit Git
- Commit format: `fix: perbaiki kompatibilitas promise antrean waha dan cegah browser hang studio alur kerja`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada hotfix ini.

### 4. Bukti Verifikasi
1. **Unit Test Suite:** `npm test -- --run` · 49 test files, 441 test cases passed (100% lulus, exit code 0).
2. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
3. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
4. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
5. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
6. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
7. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
8. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
9. **Smoke Test:** `./scripts/smoke.sh` · 14/14 titik pemeriksaan lulus (14/14 PASS, exit code 0).
10. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Seluruh proses deferred promise kini 100% kompatibel dengan Node.js versi 18, 20, dan 22+.
- Halaman Studio Alur (`/pipeline`) kini dapat dinavigasi ke halaman lain secara instan tanpa membebani CPU browser.

## [2026-11-05] Perbaikan Sub-Menu Chaining (Pilihan 3), Guard Sapaan Awal, & Handler Fallback Input

### 1. Ringkasan Pekerjaan
1. **Ekstraksi Pesan Polimorfik & Penelusuran Sub-Router (`findDownstreamRouter`):**
   - Memperluas fungsi `extractNodeMessageText` di `graph-runner.ts` agar mengekstrak seluruh properti pesan (`message_template`, `greeting_text`, `message_text`, `body`, `text`, `content`, `message`) dari node `MESSAGE_MENU` non-root maupun `CUSTOM_WA_REPLY`.
   - Membangun fungsi murni `findDownstreamRouter` yang aman terhadap siklus untuk menelusuri rantai kabel keluar dan mendeteksi simpul `CONDITION_ROUTER` turunan secara otomatis.
   - Menyimpan `nextRouterId` ke dalam `metadata.current_router_id` saat pelanggan memilih cabang sub-menu (Pilihan 3 / Katalog).
2. **Pencegahan Re-Trigger Sapaan Awal:**
   - Menegakkan aturan ketat bahwa simpul `node-greeting` HANYA dieksekusi jika sesi berstatus `INIT` (pelanggan baru pertama kali).
   - Memastikan saat pelanggan berada di status `AWAITING_CHOICE` atau `AWAITING_ORDER`, input pelanggan tidak pernah memicu eksekusi ulang `node-greeting`.
   - Evaluasi pilihan setelah katalog (Pilihan 1) langsung mengalir ke Formulir Order (`AWAITING_ORDER`).
3. **Handler Fallback Input Tidak Dikenal:**
   - Jika pelanggan mengirim input di luar cabang terdaftar pada router aktif, sistem memeriksa koneksi port `fallback` / `branch_fallback`.
   - Jika port fallback tidak terhubung, sistem mengirim pesan deterministik:
     `"Mohon maaf Kak, pilihan belum sesuai format 🙏\nSilakan balas dengan mengetik angka atau pilihan yang tertera pada menu di atas ya Kak."`
   - Status sesi tetap dipertahankan `AWAITING_CHOICE` dan `current_router_id` tetap mengunci router aktif tanpa me-reset sesi ke sapaan awal.

### 2. Commit Git
- Commit format: `fix: perbaiki sub-menu chaining pilihan 3, cegah reset sapaan awal, dan terapkan fallback input`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.

### 4. Bukti Verifikasi
1. **Unit Test Suite Lengkap:** `npm test -- --run` · 49 test files, 447 test cases passed (100% lulus, exit code 0).
2. **Parity Tests Sub-Menu (21, 22, 23):** `npx vitest run tests/unit/pipeline-parity.test.ts` · 23 passed (100% lulus, exit code 0).
3. **Customer Handle Tests (14, 15, 16):** `npx vitest run tests/unit/customer-handle.test.ts` · 19 passed (100% lulus, exit code 0).
4. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
5. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
6. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
7. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
8. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
9. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
10. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
11. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (14/14 PASS, exit code 0).
12. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Seluruh navigasi percabangan bertingkat (root router -> sub-menu -> sub-router -> order form) kini terekam secara konsisten di kolom `metadata.current_router_id` pada tabel `customer_sessions`.

## [2026-11-05] Perbaikan Penyimpanan current_router_id, Auto-Resolve Root Router, & Eliminasi Silent Drops

### 1. Ringkasan Pekerjaan
1. **Penyimpanan Eksplisit `current_router_id` pada Transisi INIT:**
   - Pada saat sesi pelanggan baru memproses chat pertama (`state === 'INIT'`), sistem secara otomatis melacak edge keluar dari node sapaan awal (`node-greeting`) untuk menemukan router utama (`node-router`).
   - Nilai `current_router_id` wajib disimpan ke dalam `customer_sessions.metadata` saat transisi ke `AWAITING_CHOICE`, menghilangkan kondisi di mana `metadata.current_router_id` kosong/undefined di database.
2. **Auto-Resolve Root Router (Self-Healing):**
   - Jika `current_router_id` pada metadata sesi bernilai undefined, null, atau tidak ditemukan di graf, sistem secara otomatis:
     a) Mencari simpul router dengan ID `node-router` atau `root-router`.
     b) Menelusuri router yang terhubung dari kabel keluar `node-greeting`.
     c) Mengambil simpul `CONDITION_ROUTER` pertama di graf sebagai jaring pengaman terakhir.
   - Sesi yang hilang pointer secara otomatis pulih tanpa menimbulkan kegagalan routing atau silent drop.
3. **Normalisasi Pencocokan Kata Kunci (Toleran Format):**
   - Input teks dibersihkan dengan `trim().toLowerCase()`.
   - Pilihan 1: Cocok jika input persis '1' atau kata kunci memuat 'pesan', 'order', 'beli'.
   - Pilihan 2: Cocok jika input persis '2' atau kata kunci memuat 'tanya', 'konsultasi', 'cs', 'admin'.
   - Pilihan 3: Cocok jika input persis '3' atau kata kunci memuat 'katalog', 'lihat', 'menu', 'pricelist'.
4. **Penanganan Fallback Input Tidak Dikenal & Eliminasi Silent Drop:**
   - Jika pelanggan mengirim input di luar pilihan (misal '4', 'halo', 'tes'):
     a) Jika port 'fallback' pada router aktif terhubung ke suatu simpul, simpul tersebut dieksekusi.
     b) Jika port fallback tidak terhubung / kosong, sistem WAJIB mengirim balasan deterministik:
        `"Mohon maaf Kak, pilihan belum sesuai format 🙏\nSilakan balas dengan mengetik angka 1, 2, atau 3 sesuai pilihan menu ya Kak."`
     c) Status sesi dipertahankan `AWAITING_CHOICE` dan `current_router_id` tetap mengunci router aktif saat ini (tidak me-reset ke sapaan awal).
   - Ditambahkan jaring pengaman pertahanan mutlak di akhir handler: jika `replies` kosong pada status non-silent, sistem otomatis mengembalikan pesan fallback, mengeliminasi silent drop 100%.

### 2. Commit Git
- Commit format: `fix: simpan current_router_id pada init, auto-resolve root router, dan eliminasi silent drop`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.

### 4. Bukti Verifikasi
1. **Unit Test Suite Lengkap:** `npm test -- --run` · 50 test files, 454 test cases passed (100% lulus, exit code 0).
2. **Router Resolution Tests:** `npx vitest run tests/unit/pipeline-router-resolution.test.ts` · 7 passed (100% lulus, exit code 0).
3. **Customer Handle Tests:** `npx vitest run tests/unit/customer-handle.test.ts` · 19 passed (100% lulus, exit code 0).
4. **Parity Tests:** `npx vitest run tests/unit/pipeline-parity.test.ts` · 23 passed (100% lulus, exit code 0).
5. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
6. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
7. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
8. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
9. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
10. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
11. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
12. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (14/14 PASS, exit code 0).
13. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Metadata sesi `customer_sessions` kini dipastikan selalu memiliki properti `current_router_id` terdefinisi sejak sapaan pertama kali dikirimkan.

## [2026-11-05] Hotfix Kritis: Eliminasi Silent Drops & Jaminan Eksekusi Fallback customer/handle

### 1. Ringkasan Pekerjaan
1. **Normalisasi Nomor Telepon Inbound:**
   - Memastikan nomor `customer_phone` dinormalisasi secara toleran ke format E.164 (`+62...`) dan memeriksa keberadaan sesi baik dengan awalan `+` maupun tanpa `+` untuk mencegah miskomunikasi format antara n8n dan database.
2. **Overhaul Defensif State AWAITING_CHOICE:**
   - Memastikan blok evaluasi `AWAITING_CHOICE` selalu berjalan bahkan jika konfigurasi graf belum dimuat (otomatis fallback ke graf preset).
   - Memperbaiki penentuan cabang: jika `branches` kosong atau tidak terdefinisi di database, sistem menggunakan cabang standar 1 (Pesan), 2 (Tanya), dan 3 (Katalog).
   - Menyelaraskan seluruh properti balasan (`to`, `phone_e164`, `chat_id`, `body`, `text`) agar terisi lengkap untuk konsumsi n8n.
3. **Penyelamatan Error Boundary & Anti-Membisu Mutlak:**
   - Membungkus seluruh logika evaluasi percabangan alur dalam blok `try/catch` mandiri: jika terjadi kegagalan tak terduga, sistem mengirimkan balasan darurat dan mengembalikan HTTP 200.
   - Mengubah handler fatal tingkat atas agar tidak mengembalikan HTTP 500 (yang memicu silent drop di n8n), melainkan mengembalikan HTTP 200 dengan balasan sopan kepada pelanggan di WhatsApp.

### 2. Commit Git
- Commit format: `fix: eliminasi silent drops dan jamin eksekusi fallback di customer/handle`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada hotfix ini.

### 4. Bukti Verifikasi
1. **Unit Test Suite Lengkap:** `npm test -- --run` · 50 test files, 454 test cases passed (100% lulus, exit code 0).
2. **Router Resolution Tests:** `npx vitest run tests/unit/pipeline-router-resolution.test.ts` · 7 passed (100% lulus, exit code 0).
3. **Customer Handle Tests:** `npx vitest run tests/unit/customer-handle.test.ts` · 19 passed (100% lulus, exit code 0).
4. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
5. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
6. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
7. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
8. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
9. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
10. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
11. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (14/14 PASS, exit code 0).
12. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Endpoint `/api/internal/customer/handle` kini dijamin 100% selalu mengembalikan array `replies` terisi untuk n8n dan tidak pernah melempar HTTP 500 pada chat interaktif pelanggan.

## [2026-11-05] Hotfix: Pembatasan Timeout LangChain n8n & Isolasi Ketat Inbound Pelanggan

### 1. Ringkasan Pekerjaan
1. **Pembatasan Timeout Model Bahasa LangChain (Maksimal 30 Detik):**
   - Pada workflow `n8n-engine/workflows/botseri-inbound-agent.json`, mengatur properti `timeout: 30000` (30 detik, bukan default 300 detik) dan `maxRetries: 0` pada node `Botseri Gateway` (`lmChatOpenAi`).
   - Membatasi batas waktu eksekusi tingkat workflow `executionTimeout: 60` pada pengaturan n8n untuk mencegah hanging 5 menit jika terjadi kendala jaringan internal.
   - Memastikan parameter URL kredensial internal gateway mengarah ke `http://botseri-dashboard:3000/api/internal/llm/v1`.
2. **Penegasan Isolasi Ketat Percabangan Peran (Switch Role):**
   - Memperbarui aturan pada node `Switch Role` agar hanya meneruskan ke sub-graf AI Agent jika `$json.is_owner === true` DAN `$json.role === 'OWNER'`.
   - Menjamin seluruh pesan pelanggan (`$json.role === 'CUSTOMER'` atau `$json.is_owner === false` atau peran selain owner) WAJIB mengalir hanya ke `Customer Handle` (`POST /api/internal/customer/handle`) -> `Split Out Replies` -> `Kirim WhatsApp`.
   - Menambahkan properti eksplisit `is_owner: role === "OWNER"` pada fungsi helper respon di `dashboard/src/app/api/internal/inbound/accept/route.ts`.
3. **Deploy Ulang Workflow ke Runtime n8n:**
   - Mengimpor ulang berkas workflow yang telah diperbarui ke kontainer n8n aktif via `n8n import:workflow`.
   - Mengaktifkan kembali workflow dengan `n8n update:workflow --all --active=true` dan me-restart kontainer `botseri-n8n`.

### 2. Commit Git
- Commit format: `fix: batasi timeout langchain n8n dan tegaskan isolasi switch inbound pelanggan`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.

### 4. Bukti Verifikasi
1. **Validasi Workflow n8n:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
2. **JSON Syntax Verification:** `node -e "JSON.parse(fs.readFileSync(...))"` · Valid JSON.
3. **Runtime Import & Start:** Kontainer `botseri-n8n` sukses memuat dan memulai ulang workflow `botseriInboundAgent01` dan `botseriScheduler01`.
4. **Unit Test Suite Lengkap:** `npm test -- --run` · 50 test files, 454 test cases passed (100% lulus, exit code 0).
5. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
6. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
7. **TypeScript Typecheck & ESLint:** `npx tsc --noEmit` dan `npm run lint` · 0 error, 0 warning.
8. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
9. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
10. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (14/14 PASS, exit code 0).
11. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Pesan pelanggan dijamin terisolasi 100% dan tidak pernah mencapai sub-graf LangChain AI Agent.

## [2026-11-05] Hotfix: Penerusan Body Pesan di Accept & Pemetaan Defensif Customer Handle n8n

### 1. Ringkasan Pekerjaan
1. **Penerusan Field `body` & `message_text` pada Endpoint `inbound/accept`:**
   - Memperbarui fungsi pembantu `response(...)` di `dashboard/src/app/api/internal/inbound/accept/route.ts` dengan parameter opsional `messageText?: string | null` dan menyertakan field `body: messageText ?? ""` serta `message_text: messageText ?? ""` pada objek respon JSON.
   - Memastikan saat respon penerimaan pesan dipanggil, teks pesan `input.body` diteruskan sebagai nilai `messageText`.
2. **Pemetaan Defensif Berlapis pada Node `Customer Handle` di n8n:**
   - Memperbarui parameter `jsonBody` pada node `Customer Handle` di `n8n-engine/workflows/botseri-inbound-agent.json` agar mengambil teks pesan, nomor telepon, dan ID pesan dengan urutan prioritas berlapis:
     - `message_text`: `$json.message_text || $json.body || $('Accept').item.json.message_text || $('Accept').item.json.body || $('Filter Event').item.json.payload?.body || $('Filter Event').item.json.body || $('Webhook').item.json.body?.payload?.body || ''`
     - `customer_phone`: `$json.customer_phone || $json.phone_e164 || $json.chat_id || $('Accept').item.json.customer_phone || $('Filter Event').item.json.payload?.from || $('Filter Event').item.json.from || ''`
     - `message_id`: `$json.message_id || $('Accept').item.json.message_id || $('Filter Event').item.json.payload?.id || $('Filter Event').item.json.id || ('msg-' + Date.now())`
   - Menjamin nilai `message_text` tidak pernah kosong saat diteruskan ke `/api/internal/customer/handle`.
3. **Deploy Ulang Workflow ke Runtime n8n:**
   - Menjalankan re-import workflow ke kontainer `botseri-n8n` via CLI `n8n import:workflow`, re-aktivasi, dan me-restart kontainer.

### 2. Commit Git
- Commit format: `fix: teruskan body pesan di accept dan amankan message_text customer handle n8n`

### 3. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.

### 4. Bukti Verifikasi
1. **Unit Test Suite Lengkap:** `npm test -- --run` · 50 test files, 454 test cases passed (100% lulus, exit code 0).
2. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% lulus, exit code 0).
3. **Prompt Evaluation:** `npm run eval:prompt -- --mock` · 30 passed (100% lulus, exit code 0).
4. **TypeScript Typecheck:** `npx tsc --noEmit` · Lulus bersih (0 error).
5. **ESLint:** `npm run lint` · Lulus bersih (0 warning, 0 error).
6. **Next.js Standalone Build:** `npm run build` · 27 rute berhasil dikompilasi (exit code 0).
7. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
8. **Secret Scanner:** `./scripts/check-secrets.sh` · 0 secret terekspos (exit code 0).
9. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (14/14 PASS, exit code 0).
10. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 5. Known Issues / Catatan Operasional
- Teks pesan pelanggan kini terbukti 100% mengalir dari webhook masuk WAHA melalui Accept hingga Customer Handle tanpa risiko terhapus atau kosong di antarmuka n8n.


## [2026-11-05] Forensik & Perbaikan Drop Balasan Sapaan & Guard Unmute Sesi Pelanggan

### 1. Ringkasan Akar Masalah & Solusi Teknis
1. **Akar Masalah Utama (Auto-Heal Session Mutating Inbound State):**
   - Pada `dashboard/src/app/api/internal/inbound/accept/route.ts`, terdapat pemanggilan `unmuteCustomerSessionByOrder` tanpa pengecekan status sesi pelanggan saat tidak ada order aktif.
   - Fungsi `unmuteCustomerSessionByOrder` di `dashboard/src/lib/customer/session.ts` secara membabi-buta meng-update SEMUA sesi dengan nomor telepon yang cocok ke status `ACTIVE` dan menghapus `metadata.draft`.
   - Akibatnya, sesi yang baru saja dibuat atau sedang berada di `AWAITING_CHOICE` langsung terdorong ke state `ACTIVE`.
   - Ketika pelanggan mengirim pesan berikutnya di state `ACTIVE`, mesin alur mengembalikan balasan sapaan berulang (T1).
   - Karena balasan sapaan identik dikirim dalam jendela waktu 45 detik, layer pengiriman keluar (`dashboard/src/app/api/internal/waha/send/route.ts`) menganggapnya sebagai duplikat (`DUPLICATE_OUTBOUND_SUPPRESSED`), sehingga tidak ada pesan yang sampai ke WhatsApp pelanggan (silent drop).
2. **Akar Masalah Kedua (Optimistic Concurrency Fallback & AWAITING_ORDER Guard):**
   - Pada `dashboard/src/app/api/internal/customer/handle/route.ts`, penjagaan `if (session.state === "AWAITING_ORDER")` saat action berupa `SEND_GREETING` mengembalikan `replies: []`.
   - Selain itu, kegagalan update konkurensi optimistik mengembalikan `replies: []` tanpa peringatan.
3. **Solusi Teknis:**
   - Di `dashboard/src/lib/customer/session.ts`: Membatasi query `unmuteCustomerSessionByOrder` hanya untuk sesi dengan `state: "PAUSED_FOR_OWNER"`.
   - Di `dashboard/src/app/api/internal/inbound/accept/route.ts`: Menambahkan guard ketat `if (!activeOrder && customerSession && customerSession.state === "PAUSED_FOR_OWNER" && !customerSession.paused_at)` sebelum memanggil pembuka jeda.
   - Dibuat skrip pengujian reproduksi deterministik `scripts/test-e2e-incoming.ts` yang menguji 6 skenario berurutan (sapaan @c.us, pilihan 1, sapaan @lid, pilihan 3 katalog, pilihan 1 pasca-katalog, dan input fallback).

### 2. Status Hipotesis H1 s.d. H10
| Kode | Deskripsi Hipotesis | Status | Bukti / Catatan |
|---|---|---|---|
| H1 | Filter Event n8n menjatuhkan pesan kedua | TERBANTAH | Eksekusi n8n 3456 dan 3457 mencatat pesan '1' dan '3' berhasil lolos Filter Event tanpa diblokir. |
| H2 | Case sensitivity pada Switch Role n8n | TERBANTAH | Switch Role memakai aturan eksplisit `$json.role === 'CUSTOMER'` dan `$json.is_owner === false`. Pada pesan kedua, rute tetap masuk ke cabang Customer Handle. |
| H3 | Payload terpotong atau kosong pada Customer Handle n8n | TERBANTAH | Pemetaan defensif pada node Customer Handle n8n berhasil meneruskan `message_text` dan `customer_phone`. |
| H4 | Unresolvable LID atau format nomor @lid | TERBANTAH | Eksekusi pesan WAHA menyertakan `remoteJidAlt` berformat `62878...@s.whatsapp.net`, fungsi `resolveSenderE164` sukses mengekstrak nomor E.164. |
| H5 | Deduplikasi pesan (message_id) menjatuhkan pesan sah | TERBANTAH | Setiap pesan masuk memiliki `message_id` unik dari WAHA/n8n; tidak ada deduplikasi inbound yang memblokir pesan sah. |
| H6 | Webhook WAHA tidak sampai ke n8n | TERBANTAH | Log kontainer `botseri-n8n` membuktikan webhook tiba secara konsisten (HTTP 200 Received). |
| H7 | Pengiriman ke WAHA gagal atau silent drop di WAHA | TERBUKTI | Log `message_log` menunjukkan entri `DUPLICATE_OUTBOUND_SUPPRESSED` karena teks balasan sapaan yang identik dikirim berulang kali dalam durasi < 45 detik. |
| H8 | Sesi pelanggan ter-reset atau ter-pause tidak sah | TERBUKTI | Sesi ter-update paksa ke `ACTIVE` oleh `unmuteCustomerSessionByOrder` di rute `inbound/accept` pada setiap pesan masuk saat order aktif kosong. |
| H9 | Perbedaan format input teks atau karakter tak terlihat | TERBANTAH | Input '1', '2', '3' masuk sebagai string bersih tanpa whitespace anomali. |
| H10 | Rute dashboard menolak atau menjatuhkan secara senyap | TERBUKTI | Karena sesi terdorong ke `ACTIVE`, `customer/handle` mengirim ulang T1 yang kemudian ditekan oleh filter duplikasi outbound di dashboard. |

### 3. Commit Git
- Commit format: `fix: batasi auto-unmute sesi hanya untuk PAUSED_FOR_OWNER dan eliminasi drop balasan`

### 4. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.
- Rollback: Jalankan `git revert HEAD` jika ingin mengembalikan perubahan kode.

### 5. Bukti Verifikasi
1. **Pengujian Reproduksi Deterministik E2E:** `npx tsx scripts/test-e2e-incoming.ts` (6/6 langkah PASS, 100% Lulus).
2. **Unit Test Suite Lengkap:** `npm test -- --run` (50 test files, 454 test cases passed, 100% Lulus).
3. **Integration Test Suite:** `npm run test:integration` (8 passed, 100% Lulus).
4. **Prompt Evaluation:** `npm run eval:prompt -- --mock` (30 passed, 100% Lulus).
5. **TypeScript Typecheck & ESLint:** `npx tsc --noEmit && npm run lint` (0 error, 0 warning).
6. **Next.js Standalone Build:** `npm run build` (27 rute berhasil dikompilasi).
7. **Workflow Validation:** `./scripts/validate-workflows.sh` (2 workflow files valid).
8. **Secret Scanner:** `./scripts/check-secrets.sh` (0 secret terekspos).
9. **Smoke Test:** `./scripts/smoke.sh` (14/14 pemeriksaan lulus, exit code 0).
10. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 6. Known Issues / Catatan Operasional
- Sesi pelanggan yang sedang dalam menu `AWAITING_CHOICE` tidak akan pernah lagi terganggu atau terdorong ke `ACTIVE` secara tidak sengaja oleh pesan masuk baru.


## [2026-11-05] Aturan 3-Strike Fallback & Auto-Handover Minri pada Pilihan Pelanggan

### 1. Ringkasan Masalah Runtime & Solusi
1. **Masalah Runtime (Error 429 Rate Limit):**
   - Ketika pelanggan mengirimkan masukan salah secara berulang-ulang dalam rentang waktu singkat, bot sebelumnya membalas setiap pesan dengan fallback secara terus-menerus.
   - Hal ini memicu pembatas laju WAHA / Dashboard (HTTP 429 Too Many Requests: AxiosError) dan menyebabkan bot macet.
2. **Solusi: Aturan 3 Kali Kesempatan (3-Strike Rule):**
   - Melacak akumulasi kesalahan pelanggan di menu utama / sub-menu via kolom `metadata.retry_count` pada tabel `customer_sessions`.
   - **Saat Input Benar (1, 2, atau 3):** Reset `metadata.retry_count = 0` dan proses cabang normal.
   - **Saat Kesalahan 1 & 2 (`currentRetries < 3`):** Kirim pesan fallback pengingat format yang menyertakan informasi kesempatan `(Kesempatan ${currentRetries}/3)` dan pertahankan status sesi di `AWAITING_CHOICE`.
   - **Saat Kesalahan 3 (`currentRetries >= 3`):**
     - Kirim pesan transisi ramah ke pelanggan bahwa percakapan diteruskan langsung ke Minri (Admin Berseri).
     - Ubah status sesi pelanggan ke `PAUSED_FOR_OWNER`, set `paused_at = new Date()`, `metadata.retry_count = 0`, dan `metadata.waiting_since = new Date()`.
     - Kirim notifikasi WhatsApp ke Minri (Primary Owner) dengan template alert `🔔 *Pemberitahuan: Bantuan Pelanggan* 🌸` menggunakan `trigger_type: 'OWNER_DIGEST'` agar lolos kuota prioritas.
3. **Perlindungan Inbound Gate (`inbound/accept/route.ts`):**
   - Setiap pesan spam lanjutan saat status sesi `PAUSED_FOR_OWNER` (dan belum kedaluwarsa serta bukan format pesanan) langsung ditolak dengan `{ accept: false, reason: "SESSION_PAUSED_FOR_MANUAL_OWNER" }` tanpa menghasilkan balasan keluar apa pun, secara mutlak mengeliminasi risiko error 429.

### 2. Berkas yang Dimodifikasi
1. `dashboard/src/app/api/internal/customer/handle/route.ts` · Implementasi aturan 3-strike, format fallback kesempatan 1/3 dan 2/3, notifikasi Minri, dan reset retry_count pada pilihan valid.
2. `dashboard/src/app/api/internal/inbound/accept/route.ts` · Penolakan inbound otomatis `SESSION_PAUSED_FOR_MANUAL_OWNER` saat sesi berstatus `PAUSED_FOR_OWNER`.
3. `dashboard/src/lib/pipeline/engine.ts` · Penyelarasan logika 3-strike rule di simulator pipeline dan reset retryCount pada eksekusi cabang 1, 2, dan 3.
4. `dashboard/tests/unit/pipeline-retry-limit.test.ts` · Berkas pengujian unit baru (8 skenario: engine strike 1-3 & reset, handler strike 1-3 & reset, serta penolakan inbound gate).
5. `dashboard/tests/unit/customer-handle.test.ts` · Penyesuaian ekspektasi fallback anti-bisu terhadap template kesempatan 1/3.
6. `scripts/test-e2e-incoming.ts` · Penambahan langkah pengujian simulasi deterministik end-to-end (9 langkah, 100% Lulus).

### 3. Commit Git
- Commit format: `feat: implementasi aturan 3-strike fallback dan auto-handover minri pada pilihan pelanggan`

### 4. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database (memanfaatkan kolom `metadata.retry_count` yang sudah ada).
- Rollback: `git revert HEAD` jika ingin mengembalikan perubahan.

### 5. Bukti Verifikasi
1. **Pengujian Unit Baru (`pipeline-retry-limit.test.ts`):** `npx vitest run tests/unit/pipeline-retry-limit.test.ts` · 8/8 tests passed (100% Lulus).
2. **Unit Test Suite Lengkap:** `npm test -- --run` · 51 test files, 462 test cases passed (100% Lulus, exit code 0).
3. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% Lulus, exit code 0).
4. **TypeScript Typecheck & ESLint:** `npx tsc --noEmit && npm run lint` · 0 error, 0 warning.
5. **Skrip Simulasi E2E Terpadu (`scripts/test-e2e-incoming.ts`):** 9/9 langkah PASS (100% Lulus).
6. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (exit code 0).
7. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 6. Known Issues / Catatan Operasional
- Pelanggan yang salah memilih 3x berturut-turut akan langsung dijeda untuk penanganan manual oleh Minri. Jika pelanggan kemudian mengirim format pesanan lengkap, rute inbound otomatis membuka kembali jalur pemesanan.


## [2026-11-05] Perbaikan Outbound 429 Queue, Mute Bypass Keyword (MENU/BARU), & Soft-Delete Orders

### 1. Ringkasan Pekerjaan
1. **Antrean Tunda Outbound Anti-429 & Retry n8n:**
   - Pada `dashboard/src/lib/waha/humanizer.ts`, saat kuota sliding window (4 pesan / 60 detik) penuh, eksekusi ditahan secara asinkron (`await sleep(waitMs)`) hingga slot jendela waktu tersedia sebelum pesan dikirim ke WAHA (tanpa langsung melempar 429).
   - Pada `dashboard/src/app/api/internal/waha/send/route.ts`, jika rate limit 429 terjadi pada pesan balasan bot (`CUSTOMER_REPLY`, `CUSTOM_REPLY`, `OWNER_DIGEST`, `TASK_ALARM`, `NEW_ORDER_ALERT`), endpoint mengembalikan status HTTP 202 Accepted (`{ ok: true, queued: true, warning: "OUTBOUND_RATE_LIMIT_DELAYED" }`) dan menjadwalkan pengiriman di latar belakang agar n8n tidak menerima AxiosError 429.
   - Pada `n8n-engine/workflows/botseri-inbound-agent.json`, node "Kirim WhatsApp" ditambahkan opsi `retryOnFail: true`, `maxTries: 3`, dan `waitBetweenTries: 3000` (jeda 3 detik).
2. **Bypass Mute Pelanggan via Kata Kunci (MENU, BARU, HALO):**
   - Pada `dashboard/src/app/api/internal/inbound/accept/route.ts`, diperluas deteksi kata kunci bypass `/^(menu|baru|order baru|pesan baru|halo|hi|batal|restart)[.! ]*$/i`.
   - Jika kata kunci bypass terdeteksi: bot tidak dibisukan (`accept: true, role: "CUSTOMER"`), status sesi di `customer_sessions` di-reset ke `AWAITING_CHOICE`, `paused_at` dinolkan, pointer `current_router_id` dibersihkan, dan draft dinolkan sehingga pelanggan dapat berinteraksi kembali dengan menu.
   - Jika bukan kata kunci bypass dan pelanggan memiliki pesanan aktif: rute mengembalikan `accept: false, reason: "ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED"`.
3. **Standarisasi Soft Delete & Auto-Unmute Pesanan:**
   - Pada `dashboard/src/app/api/orders/[id]/route.ts`, endpoint `DELETE` menggunakan fungsi terpusat `softDeleteOrder(params.id)` dan memastikan pelepasan kunci sesi via `releaseCustomerSession(order.customer_chat_id || order.customer_contact)`.
   - Mengembalikan respon terstruktur `{ ok: true, message: "Pesanan berhasil dihapus dan sesi pelanggan telah dibuka." }`.
   - Pada `dashboard/src/lib/orders/service.ts`, fungsi `releaseCustomerSession` meneruskan `customer_chat_id` dan `customer_contact` ke `unmuteCustomerSessionByOrder` agar dapat mencocokkan nomor telepon dengan akurat.

### 2. Berkas yang Dimodifikasi
1. `dashboard/src/lib/waha/humanizer.ts` · Penambahan penundaan asinkron pada `checkRateLimits` saat kuota 60 detik penuh.
2. `dashboard/src/app/api/internal/waha/send/route.ts` · Penanganan fallback HTTP 202 Accepted dengan pengiriman tunda latar belakang untuk pesan bot.
3. `n8n-engine/workflows/botseri-inbound-agent.json` · Konfigurasi retry on fail (3x percobaan, jeda 3000ms) pada node Kirim WhatsApp.
4. `dashboard/src/app/api/internal/inbound/accept/route.ts` · Deteksi kata kunci bypass mute dan reset sesi pelanggan.
5. `dashboard/src/app/api/orders/[id]/route.ts` · Standarisasi soft-delete dan auto-unmute pada rute DELETE pesanan.
6. `dashboard/src/lib/orders/service.ts` · Penyesuaian `releaseCustomerSession` untuk kompatibilitas format kontak.
7. `dashboard/tests/unit/waha-queue-mute-bypass.test.ts` · Berkas pengujian unit baru mencakup 5 skenario (bypass mute MENU/BARU, mute pesan biasa, soft delete & unmute, dan antrean 202 waha/send).

### 3. Commit Git
- Commit format: `fix: antrean tunda outbound 429 waha send, bypass mute kata kunci menu, dan soft delete order auto unmute`

### 4. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.
- Rollback: Jalankan `git revert HEAD` jika ingin mengembalikan perubahan kode.

### 5. Bukti Verifikasi
1. **Pengujian Unit Baru (`waha-queue-mute-bypass.test.ts`):** `npx vitest run tests/unit/waha-queue-mute-bypass.test.ts` · 5/5 tests passed (100% Lulus).
2. **Unit Test Suite Lengkap:** `npm test -- --run` · 52 test files, 467 test cases passed (100% Lulus, exit code 0).
3. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% Lulus, exit code 0).
4. **TypeScript Typecheck & ESLint:** `npx tsc --noEmit && npm run lint` · 0 error, 0 warning.
5. **Workflow Validation:** `./scripts/validate-workflows.sh` · 2 workflow files valid (exit code 0).
6. **Skrip Simulasi E2E Terpadu (`scripts/test-e2e-incoming.ts`):** 9/9 langkah PASS (100% Lulus).
7. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (exit code 0).
8. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 6. Known Issues / Catatan Operasional
- Pengiriman pesan keluar yang padat dalam waktu singkat kini secara otomatis ditunda secara halus atau dijadwalkan di antrean latar belakang sehingga n8n tidak akan lagi mengalami kegagalan AxiosError 429.


## [2026-11-05] Pembisuan Ketat Saat Pesanan Aktif & Penegasan Pelepasan Sesi Pasca-Pesanan

### 1. Ringkasan Koreksi Logika Bisnis
1. **Pembisuan Mutlak Saat Pesanan Aktif (Zero Interruption):**
   - Menghapus pengecualian kata sapaan (seperti "halo", "hi", "menu", "baru") saat memeriksa pesanan aktif di `dashboard/src/app/api/internal/inbound/accept/route.ts`.
   - Selama pelanggan memiliki pesanan aktif di tabel `orders` (`status` bernilai `PENDING` atau `IN_PROGRESS`, serta `deleted_at IS NULL`), bot dibekukan secara mutlak (`accept: false, reason: "ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED"`).
   - Bot dilarang mengirimkan pesan balasan apa pun ke WhatsApp agar tidak menyela obrolan manual antara admin toko (Minri) dan pelanggan.
2. **Pelepasan Sesi Pasca-Penyelesaian / Penghapusan Pesanan:**
   - Bot hanya aktif kembali setelah pesanan diselesaikan (status `COMPLETED`) atau dihapus (`CANCELLED` / `deleted_at` terisi).
   - Fungsi `unmuteCustomerSessionByOrder` dan `releaseCustomerSession` mereset sesi pelanggan yang terkunci, mengosongkan metadata, serta mencatat log audit pemulihan sesi.
   - Chat berikutnya dari pelanggan setelah pesanan selesai/dihapus akan disambut normal dari awal.

### 2. Berkas yang Dimodifikasi
1. `dashboard/src/app/api/internal/inbound/accept/route.ts` · Menghapus regex bypass sapaan dan memberlakukan penolakan penuh saat pesanan aktif.
2. `dashboard/src/lib/customer/session.ts` · Penambahan logging audit pembukaan sesi pasca-pesanan.
3. `dashboard/tests/unit/waha-queue-mute-bypass.test.ts` · Pengujian unit pembisuan ketat pada pesan "halo", "menu", dan "bisa kirim jam 2?", serta pengujian chat pasca-penyelesaian pesanan.
4. `dashboard/tests/unit/inbound-accept.test.ts` · Penyesuaian skenario penolakan pesan saat pesanan aktif.

### 3. Commit Git
- Commit format: `fix: pembisuan ketat bot saat pesanan aktif tanpa interupsi sapaan dan penegasan rilis sesi`

### 4. Migrasi dan Rollback
- Migrasi: Tidak ada perubahan skema database pada perbaikan ini.
- Rollback: Jalankan `git revert HEAD` jika ingin mengembalikan perubahan kode.

### 5. Bukti Verifikasi
1. **Pengujian Unit Strict Mute (`waha-queue-mute-bypass.test.ts`):** 4/4 passed (100% Lulus).
2. **Unit Test Suite Lengkap:** `npm test -- --run` · 52 test files, 466 test cases passed (100% Lulus, exit code 0).
3. **Integration Test Suite:** `npm run test:integration` · 8 passed (100% Lulus, exit code 0).
4. **TypeScript Typecheck & ESLint:** `npx tsc --noEmit && npm run lint` · 0 error, 0 warning.
5. **Skrip Simulasi E2E Terpadu (`scripts/test-e2e-incoming.ts`):** 9/9 langkah PASS (100% Lulus).
6. **Smoke Test:** `./scripts/smoke.sh` · 14/14 pemeriksaan lulus (exit code 0).
7. **Audit Antislop R-02:** 0 karakter em dash pada seluruh berkas baru dan modifikasi.

### 6. Known Issues / Catatan Operasional
- Pelanggan yang memiliki pesanan aktif dijamin tidak akan pernah menerima interupsi dari bot sampai staf menyelesaikan atau membatalkan pesanan tersebut di dashboard.


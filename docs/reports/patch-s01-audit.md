# Laporan Audit Verifikasi dan Baseline Sistem Botseri (S01)

> **Tanggal audit:** 4 November 2026  
> **Status:** SELESAI  
> **Peran:** Staff Reliability Engineer & Security-minded Full-Stack Developer  
> **Acuan rencana:** `PATCH-PLAN-botseri.md` (Section S01)  
> **Aturan penulisan:** Bebas karakter em dash (R-02), berbasis bukti kode aktual.

---

## 1. Hasil Pemeriksaan Baseline G-06

Sebelum audit kode dijalankan, seluruh perintah gerbang kualitas wajib (G-06) telah dieksekusi di lingkungan kerja saat ini:

| Perintah | Hasil | Keterangan |
|---|---|---|
| `npx tsc --noEmit` (dashboard) | LULUS (0 error) | Pemeriksaan tipe TypeScript bersih pada seluruh file backend dan frontend dashboard. |
| `npm run lint` (dashboard) | LULUS (0 error, 0 warning) | ESLint Next.js bersih tanpa peringatan. |
| `npm test -- --run` (dashboard) | LULUS (31/31 file, 310/310 test passed) | Seluruh unit test suite lulus 100% dalam 9.29 detik. |
| `npm run build` (dashboard) | LULUS (exit code 0) | Next.js 14.2.35 berhasil mengompilasi 27 rute statis/dinamis. |
| `./scripts/validate-workflows.sh` (root) | LULUS (exit code 0) | 2 berkas workflow n8n valid (JSON valid, tanpa node database, tanpa hardcoded secret). |

---

## 2. Hasil Audit dan Jawaban Pertanyaan Verifikasi (A-01 s.d. A-20)

### A-01: Apakah `orders.customer_contact` selalu sama dengan `chat_id` WhatsApp pelanggan? Dari mana nilainya diisi?
- **Status:** TERBUKTI (TIDAK SELALU SAMA)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/customer/handle/route.ts:734`: Diisi dari nomor E.164: `customer_contact: customer_phone.slice(0, 50)` (contoh: `+628123456789`).
  - WAHA `chat_id` menggunakan format JID WhatsApp: `628123456789@c.us`. Nilai string ini berbeda karakter awalan (`+`) dan akhiran (`@c.us`).
  - `dashboard/src/app/(app)/orders/OrderBoard.tsx:294-297`: Pada antarmuka manual web dashboard, input form menerima kontak bebas dengan placeholder `"08xx atau @instagram"`.
  - `dashboard/src/app/api/internal/inbound/accept/route.ts:381-384`: Pencocokan pesanan aktif ke nomor pengirim terpaksa melakukan fallback `OR` antara `validCustomerPhone` dan `validCustomerPhone.replace(/^\+/, "")`. Jika owner memasukkan username Instagram atau format lokal tanpa kode negara, pencocokan gagal total.
- **Konsekuensi:** Inkonsistensi format kontak menyebabkan bot gagal mengenali pesanan aktif pelanggan jika nomor diinput manual dari web dashboard.

---

### A-02: Apakah ada TTL pada mute bot pelanggan? Adakah notifikasi ke owner untuk pesan dari pelanggan yang di-mute?
- **Status:** TERBUKTI (TIDAK ADA TTL DAN TIDAK ADA NOTIFIKASI PADA MUTE ACTIVE ORDER)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/inbound/accept/route.ts:392-399`:
    ```typescript
    if (activeOrder && gate.enabled && gate.mute_bot_on_active_order) {
      return response(
        false,
        "ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED",
        null,
        targetChatId,
      );
    }
    ```
  - Pada `inbound/accept/route.ts`, penolakan akibat pesanan aktif berjalan selamanya tanpa batas waktu (TTL) selama order masih berada di status `PENDING` atau `IN_PROGRESS`.
  - Di workflow n8n (`botseri-inbound-agent.json`), cabang `false` dari node `Accept Sukses?` langsung menuju ke node `Selesai Tanpa Balasan` (no-op).
- **Konsekuensi:** Pesan dari pelanggan yang sedang memiliki pesanan aktif diabaikan secara diam-diam (*silent drop*) tanpa notifikasi apa pun ke WhatsApp owner, sehingga chat pelanggan tidak terpantau jika owner tidak membuka aplikasi WA manual.

---

### A-03: Apakah `PUT /api/pipeline` memvalidasi siklus, singleton `TRIGGER_INBOUND`, dan handle valid di server?
- **Status:** TERBUKTI (SERVER TIDAK MEMVALIDASI)
- **Bukti Kode:**
  - `dashboard/src/app/api/pipeline/route.ts:13-17, 41-47`: Skema validasi hanya mengandalkan `PipelineConfigSchema`.
  - `dashboard/src/lib/pipeline/schema.ts:99-121`: Skema `PipelineGraphSchema` hanya memvalidasi array `nodes` dan `edges` secara struktural tipe data dasar tanpa pemeriksaan graf:
    - Tidak ada algoritma pendeteksi siklus (Cycle Detection / Topological Sort).
    - Tidak ada aturan singleton server untuk `TRIGGER_INBOUND` (pembatasan hanya ada di UI modal client `PipelineStudio.tsx:610`).
    - Tidak ada validasi apakah `sourceHandle` dan `targetHandle` pada setiap edge benar-benar terdaftar pada tipe node sumber/tujuan.
- **Konsekuensi:** Klien API dapat mengirimkan graf siklik atau multi-trigger yang merusak runtime tanpa terdeteksi oleh validasi server.

---

### A-04: Apakah `executeChainedCustomNodes` punya batas kedalaman atau deteksi siklus?
- **Status:** PARSIAL
- **Bukti Kode:**
  - `dashboard/src/lib/pipeline/graph-runner.ts:276-279`:
    ```typescript
    const visited = new Set<string>();
    while (currentSourceId && !visited.has(currentSourceId)) {
      visited.add(currentSourceId);
      ...
    }
    ```
  - **Deteksi Siklus Ada:** `visited: Set<string>` mencegah infinite loop jika simpul yang sama dikunjungi ulang.
  - **Batas Kedalaman Tidak Ada:** Tidak ada konstanta `MAX_DEPTH` atau pembatasan jumlah hop rantai. Rantai linier tanpa siklus berisi 50 node kustom akan mengeksekusi ke-50 node dan mengirimkan 50 pesan sekaligus ke WhatsApp.
- **Konsekuensi:** Berpotensi memicu lonjakan pengiriman pesan spam (*rate limit burst*) jika graf disusun sangat panjang.

---

### A-05: Apa yang terjadi pada sesi dengan `metadata.current_router_id` bila node dihapus dari graf?
- **Status:** TERBUKTI (FALLBACK BEKERJA, TAPI POINTER MATI TERTINGGAL)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/customer/handle/route.ts:208-230`: Jika `activeRouterId` tidak ditemukan di `graph.nodes`, backend melakukan fallback ke node router yang terhubung dari `node-greeting`, lalu ke `node-router`.
  - `dashboard/src/app/api/internal/customer/handle/route.ts:504-515`: Pada blok pilihan tidak dikenali (*fallback*), `current_router_id: activeRouterId` tetap dituliskan kembali ke `metadata` sesi.
- **Konsekuensi:** Sesi pelanggan terus menyimpan ID node usang (*stale pointer*) yang sudah tidak ada di graf database.

---

### A-06: Daftar lengkap parser waktu dan siapa memanggil siapa
- **Status:** TERBUKTI (TERDAPAT DUPLIKASI DAN DUA JALUR TERPISAH)
- **Bukti Kode:**
  1. Jalur Tool Agent (`/api/internal/tools/create-todo-and-order/route.ts`):
     - `parseFlexibleDueAt` (lokal di `create-todo-and-order/route.ts:16`) memanggil `normalizeIsoDateTime` (`lib/time/index.ts:130`).
     - Memanggil `resolveTimeExpression` (`lib/time/index.ts:209`).
  2. Jalur Core Todos (`lib/todos/create.ts`):
     - `createTodo` memanggil `resolveDueAndReminder` (`lib/todos/create.ts:68`).
     - `resolveDueAt` (`lib/todos/create.ts:142`) juga membungkus `resolveDueAndReminder`.
     - `resolveDueAndReminder` melakukan parsing string tanggal sendiri secara independen menggunakan `fromZonedTime` dan `isWorkingDay` tanpa memanfaatkan `resolveTimeExpression` atau `parseFlexibleDueAt`.
- **Graf Pemanggilan:**
  ```
  [create-todo-and-order/route.ts]
     ├──> parseFlexibleDueAt() ──> normalizeIsoDateTime()
     └──> resolveTimeExpression()

  [update-todo/route.ts]
     └──> resolveTimeExpression()

  [lib/todos/create.ts: createTodo()]
     └──> resolveDueAndReminder() ──> fromZonedTime() (terpisah)
  ```
- **Konsekuensi:** Inkonsistensi parsing ekspresi waktu antara route handler dan library inti pembuatan to-do.

---

### A-07: Apa yang terjadi bila `remind_at` sudah lewat atau `due_at` kurang dari 60 menit lagi saat to-do dibuat (Kasus A)?
- **Status:** TERBUKTI (ALARM LANGSUNG BERBUNYI SEKETIKA)
- **Bukti Kode:**
  - `dashboard/src/lib/todos/create.ts:111`: Pada Kasus A, `remindAt = new Date(parsedDue.getTime() - 60 * 60 * 1000)` (mundur 1 jam).
  - Jika to-do dibuat untuk 30 menit ke depan, `remindAt` berada di masa lampau (30 menit yang lalu).
  - `dashboard/src/lib/scheduler/queries.ts:43, 128-130`:
    ```sql
    AND COALESCE(remind_at, due_at) <= ${now}
    AND COALESCE(remind_at, due_at) > (${now}::timestamptz - (${config.maxLatenessMinutes} * interval '1 minute'))
    ```
  - Nilai `maxLatenessMinutes` adalah 720 (12 jam). Karena `remindAt` (30 menit lalu) lebih kecil dari `now` dan masih berada di dalam jendela 12 jam, scheduler pada tick berikutnya (maksimal 1 menit kemudian) langsung mengklaim to-do dan membunyikan alarm seketika.
- **Konsekuensi:** Pemilik usaha langsung menerima pesan alarm pengingat sesaat setelah to-do dibuat untuk tugas yang tenggatnya dekat.

---

### A-08: Nilai `trigger_type` yang dikirim n8n vs enum zod di `waha/send`. Adakah yang tidak cocok atau salah label?
- **Status:** TERBUKTI (SALAH LABEL ALARM DI WORKFLOW SCHEDULER)
- **Bukti Kode:**
  - `n8n-engine/workflows/botseri-scheduler.json:115`: Node `http-send-alarm` (nama: `"Kirim WhatsApp Alarm"`) secara hardcoded mengirim:
    `"jsonBody": "={{ JSON.stringify({ ..., trigger_type: 'WORK_HOURS_REMINDER', ... }) }}"`
  - Padahal kondisi node adalah `$json.job_type === 'TASK_ALARM'` dan enum Zod di `dashboard/src/app/api/internal/waha/send/route.ts:18` sudah mendukung `TASK_ALARM`.
- **Konsekuensi:** Seluruh riwayat pengiriman alarm tugas di `message_logs` salah terlabeli sebagai pengingat jam kerja (`WORK_HOURS_REMINDER`).

---

### A-09: Apakah ambang STALE di `/status` masih 30 menit? Apakah `pruneOldTickEvents` ada dan berapa retensinya?
- **Status:** TERBUKTI (AMBANG 30 MENIT, PRUNE RETENSI 48 JAM)
- **Bukti Kode:**
  - `dashboard/src/lib/analytics/helpers.ts:81, 90`: `const THIRTY_MINUTES_MS = 30 * 60 * 1000`. Jika selisih detak lebih dari 30 menit baru berstatus `STALE`.
  - `dashboard/src/app/(app)/status/page.tsx:171`: Teks banner berbunyi `"Detak scheduler terakhir lebih dari 30 menit atau belum pernah tercatat."`
  - `dashboard/src/lib/scheduler/tick.ts:390-399`: Fungsi `pruneOldTickEvents` ada dan menghapus event `TICK_OK` dengan retensi 48 jam (`const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60_000)`).
- **Konsekuensi:** Scheduler yang mati selama 29 menit masih dianggap `SEGAR` (OK) di dashboard pemantauan.

---

### A-10: Apakah ada lock/guard terhadap tick yang tumpang tindih? Bagaimana klaim basi dipulihkan?
- **Status:** TERBUKTI (TIDAK ADA LOCK TICK, KLAIM BASI HANYA UNTUK TO-DO)
- **Bukti Kode:**
  - `dashboard/src/lib/scheduler/tick.ts`: Fungsi `tick()` tidak memiliki mekanisme PG Advisory Lock atau mutex memori. Pemanggilan paralel akan mengeksekusi logika tick secara bersamaan.
  - `dashboard/src/lib/scheduler/queries.ts:133-134`: Klaim basi to-do dipulihkan secara pasif via timeout 2 menit (`claimCooldownMinutes`), namun job scheduler tipe lain (briefing, reminder jam kerja, evaluasi malam) tidak memiliki lock idempotensi di level tick.
- **Konsekuensi:** Risiko pengiriman notifikasi ganda jika webhook cron terpanggil ganda atau tick mengalami latensi jaringan.

---

### A-11: Apakah rate limiter dan circuit breaker hanya di memori? Apakah dipakai bersama pelanggan dan owner?
- **Status:** TERBUKTI (HANYA IN-MEMORY DAN BERBAGI STATE SECARA GLOBAL)
- **Bukti Kode:**
  - `dashboard/src/lib/waha/humanizer.ts:34-39`:
    `let lastSentAt = 0; const sentTimestamps: number[] = []; let consecutiveFailures = 0; let cooldownUntil = 0;`
  - Seluruh variabel adalah variabel lokal memori modul Node.js.
  - `dashboard/src/lib/waha/humanizer.ts:127-156`: `checkRateLimits` memeriksa `sentTimestamps` tanpa membedakan apakah pesan ditujukan untuk owner atau pelanggan publik.
- **Konsekuensi:** Jika pengiriman ke nomor pelanggan gagal berturut-turut hingga circuit breaker trip (30 menit), owner juga tidak bisa menerima alarm atau laporan to-do. Restart container mereset seluruh hitungan pembatasan.

---

### A-12: Apa perilaku `INBOUND_COOLDOWN` untuk pelanggan: pesan dibuang atau ditunda?
- **Status:** TERBUKTI (PESAN DIBUANG / SILENT DISCARD)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/inbound/accept/route.ts:254, 265`: `INBOUND_COOLDOWN` berlaku di blok owner.
  - `dashboard/src/app/api/internal/inbound/accept/route.ts:373`: Untuk pelanggan, penolakan mengembalikan `RATE_LIMITED`.
  - Keduanya mengembalikan `accept: false`.
  - `n8n-engine/workflows/botseri-inbound-agent.json`: Node `Accept Sukses?` mencabangkan `false` ke node `Selesai Tanpa Balasan`.
- **Konsekuensi:** Pesan yang terbentur cooldown atau rate limit dibuang seketika tanpa antrean penundaan.

---

### A-13: Ada berapa implementasi `getPrimaryOwner` dan apa spesifikasi masing-masing? Apakah ada unique index parsial `is_primary`?
- **Status:** TERBUKTI (2 IMPLEMENTASI BERBEDA, TANPA UNIQUE INDEX)
- **Bukti Kode:**
  1. `dashboard/src/app/api/internal/customer/handle/route.ts:116`:
     - Tidak memfilter `is_owner: true`.
     - Mengubah data database (`prisma.authorizedNumber.update`) untuk menandai `is_primary = true` jika belum ada.
  2. `dashboard/src/lib/scheduler/queries.ts:28`:
     - Memfilter `where: { is_owner: true, is_primary: true }`.
     - Read-only tanpa mutasi.
  3. Skema & Migrasi (`dashboard/prisma/migrations/20261027140000_add_is_primary_to_authorized_numbers/migration.sql:2`):
     - Kolom `is_primary` bertipe boolean biasa tanpa unique index parsial (`CREATE UNIQUE INDEX ... WHERE is_primary = true`).
- **Konsekuensi:** Berpotensi terjadi lebih dari satu nomor bernilai `is_primary = true`, serta inkonsistensi penentuan nomor pemilik antara scheduler dan customer handler.

---

### A-14: Apakah `max_output_tokens` dan `temperature` dari `llm_configs` benar-benar dipakai gateway?
- **Status:** TERBUKTI (TERTIMPA OLEH PAYLOAD N8N)
- **Bukti Kode:**
  - `dashboard/src/lib/llm-gateway/openai-compatible.ts:41-42`:
    `temperature: payload.temperature ?? config.temperature ?? 0.2`
    `max_tokens: payload.max_tokens ?? config.max_output_tokens ?? 600`
  - `n8n-engine/workflows/botseri-inbound-agent.json:419-420`: Node AI Agent selalu mengirimkan payload eksplisit `"temperature": 0.2` dan `"maxTokens": 2048`.
  - `n8n-engine/workflows/botseri-scheduler.json:147`: Selalu mengirimkan `temperature: 0.4` dan `max_tokens: 1000`.
- **Konsekuensi:** Pengaturan `temperature` dan `max_output_tokens` yang diubah pemilik di tabel `llm_configs` via antarmuka web tidak pernah berdampak karena selalu diabaikan oleh nullish coalescing operator (`??`).

---

### A-15: Apakah ada pengecekan `finish_reason: "length"`?
- **Status:** TERBUKTI (TIDAK ADA PENGECEKAN)
- **Bukti Kode:**
  - `grep -Rn "finish_reason" dashboard/src/`: Hanya ada konstruksi pemetaan objek respons OpenAI di `chat/completions/route.ts:165`, `anthropic.ts:235`, dan `gemini.ts:406`.
  - Tidak ada kode yang memeriksa kondisi jika `finish_reason === "length"`.
- **Konsekuensi:** Respons LLM yang terpotong di tengah kalimat atau JSON function call yang rusak akibat kehabisan token dianggap selesai normal tanpa peringatan atau retry.

---

### A-16: Apakah kunci API Gemini dikirim lewat query URL?
- **Status:** TERBUKTI (KUNCI API DIKIRIM DALAM QUERY STRING)
- **Bukti Kode:**
  - `dashboard/src/lib/llm-gateway/gemini.ts:281`:
    `const url = `${base}/models/${cleanModel}:generateContent?key=${encodeURIComponent(cleanKey)}`;`
  - `dashboard/src/lib/llm-gateway/catalog.ts:288`:
    ``https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}``
- **Konsekuensi:** Kunci API Google Gemini terekspos pada log server web, proxy HTTP, Cloudflare Tunnel, dan histori peramban.

---

### A-17: Apakah fallback AI untuk formulir pesanan punya akses tool? Data apa yang dikirim ke provider?
- **Status:** TIDAK TERBUKTI (AMAN, TANPA AKSES TOOL)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/customer/handle/route.ts:68-74`:
    ```typescript
    const res = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });
    ```
  - Properti `tools` dan `tool_choice` tidak disertakan.
  - Data yang dikirim hanya teks formulir pelanggan yang dibungkus dalam tag pelindung `<pesan_pelanggan>...</pesan_pelanggan>`.
- **Konsekuensi:** Fallback ekstraksi pesanan kebal terhadap eksfiltrasi data atau eksekusi fungsi tak berizin via tool poisoning.

---

### A-18: Apakah `.git` ada? Apakah `.env`, `backups/` berada dalam folder yang disinkronkan Google Drive?
- **Status:** TERBUKTI (TIDAK ADA .GIT, BERKAS SENSITIF BERADA DI GOOGLE DRIVE)
- **Bukti Perintah:**
  - `git rev-parse --is-inside-work-tree`: `fatal: not a git repository (or any of the parent directories): .git`
  - `pwd`: `/Users/michaelarhdyn/Library/CloudStorage/GoogleDrive-23.michaelaristio@gmail.com/My Drive/Project Michael/Botseri`
  - Direktori `backups/` memuat 4 file database dump (`botseri-*.dump`) dan 3 file arsip waha (`waha-*.tar.gz`).
- **Konsekuensi:** Seluruh riwayat kode tidak terlacak versi secara lokal, dan berkas kredensial `.env` serta dump database pelanggan otomatis terunggah ke penyimpanan cloud pihak ketiga.

---

### A-19: Apakah `tools/update-order` mendukung `DELETE` hard dan `order_id: "ALL"` tanpa konfirmasi?
- **Status:** TERBUKTI (DELETE HARD PERMANEN TANPA KONFIRMASI)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/tools/update-order/route.ts:176-179`:
    ```typescript
    if (action === "DELETE") {
      await prisma.order.delete({
        where: { id: order.id },
      });
      ...
    }
    ```
  - Menghapus baris fisik dari PostgreSQL (`prisma.order.delete`) tanpa soft-delete (`deleted_at`), dan tanpa verifikasi konfirmasi ganda.
- **Konsekuensi:** Perintah suara atau chat typo berisiko menghapus data pesanan secara permanen dan tidak dapat dipulihkan.

---

### A-20: Apakah data `special_notes`/`request_khusus` dikembalikan mentah ke LLM oleh `get-orders`?
- **Status:** TERBUKTI (DATA MENTAH TANPA SANITASI INJECTION)
- **Bukti Kode:**
  - `dashboard/src/app/api/internal/tools/get-orders/route.ts:35-37, 93`:
    Regex `notes.match(/Request Khusus:\s*(.+)/i)` mengekstrak string mentah lalu memasukkannya ke properti `special_notes`.
  - Objek tersebut dikembalikan ke LLM Agent utama yang memegang akses tool calling tanpa sanitasi karakter atau pembungkusan defensif.
- **Konsekuensi:** Kerentanan Indirect Prompt Injection jika pelanggan WhatsApp menyelipkan instruksi manipulatif ke dalam formulir pesanan.

---

## 3. Tabel Rekapitulasi Audit

| ID | Topik Temuan | Status Audit | Keterangan Singkat |
|---|---|---|---|
| A-01 | `customer_contact` vs `chat_id` | **Terbukti** | Format kontak tidak seragam (E.164, `@c.us`, string bebas). |
| A-02 | TTL & Alert pada Mute Bot Pelanggan | **Terbukti** | Mute pesanan aktif tidak memiliki batas waktu (TTL) & tanpa alert ke owner. |
| A-03 | Validasi Siklus, Singleton, & Port `PUT /api/pipeline` | **Terbukti** | Server menerima graf siklik dan multi-trigger tanpa validasi. |
| A-04 | Batas Kedalaman Traversal Rantai Kustom | **Parsial** | Deteksi siklus ada via `Set`, namun batas kedalaman maksimal (`MAX_DEPTH`) nihil. |
| A-05 | Stale Pointer Router Terhapus di Sesi | **Terbukti** | Fallback router berjalan, namun ID usang tetap tersimpan di metadata sesi. |
| A-06 | Fragmentasi & Duplikasi Parser Waktu | **Terbukti** | Terdapat dua jalur terpisah antara route handler dan library to-do. |
| A-07 | Anomali Alarm Seketika Kasus A (`due_at < 60 min`) | **Terbukti** | Pengurangan 60 menit menghasilkan waktu lampau yang langsung lolos klaim scheduler. |
| A-08 | Salah Label `TASK_ALARM` di n8n Scheduler | **Terbukti** | Hardcoded `WORK_HOURS_REMINDER` pada node Kirim WhatsApp Alarm. |
| A-09 | Ambang STALE 30 Menit & Retensi Event Tick | **Terbukti** | Ambang batas 30 menit terlalu longgar untuk detak 1 menit; retensi 48 jam. |
| A-10 | Ketiadaan Lock Tick & Idempotensi Klaim | **Terbukti** | Tidak ada PG advisory lock; tick paralel dapat berjalan bersamaan. |
| A-11 | Rate Limiter & Circuit Breaker In-Memory Global | **Terbukti** | State hilang saat restart dan berbagi limit antara owner dan pelanggan. |
| A-12 | Pembuangan Pesan Cooldown Tanpa Antrean | **Terbukti** | Pesan yang terbentur cooldown/rate limit dibuang seketika (*silent drop*). |
| A-13 | Duplikasi `getPrimaryOwner` & Nihil Unique Index | **Terbukti** | 2 implementasi berbeda; kolom `is_primary` tanpa unique index parsial. |
| A-14 | Ignored Config `temperature` & `max_output_tokens` | **Terbukti** | Selalu tertimpa oleh nilai default yang dikirim oleh node n8n. |
| A-15 | Ketiadaan Pengecekan `finish_reason: "length"` | **Terbukti** | Pemotongan output token tidak pernah dideteksi oleh gateway. |
| A-16 | Kunci API Gemini Terekspos di Query URL | **Terbukti** | Query string `?key=...` digunakan pada `callGemini` dan `fetchGeminiModels`. |
| A-17 | Fallback AI Formulir Pesanan Punya Akses Tool | **Tidak Terbukti** | Aman: request murni ekstraksi JSON tanpa tool schema. |
| A-18 | Ketiadaan `.git` & Berkas Sensitif di Cloud Sync | **Terbukti** | Repo belum terinisialisasi git; `.env` dan `backups/` berada di Google Drive. |
| A-19 | Hard Delete Pesanan Tanpa Konfirmasi | **Terbukti** | Aksi `DELETE` langsung menghapus fisik baris database tanpa soft-delete. |
| A-20 | Raw Special Notes Rentan Prompt Injection | **Terbukti** | Teks catatan pelanggan dikembalikan mentah ke LLM tanpa sanitasi. |

---

## 4. Evaluasi Urutan Prioritas Rencana Kerja

Berdasarkan hasil audit di atas:
- **Temuan yang Gugur:** A-17 (Fallback formulir pesanan) dinyatakan **gugur** karena kode aktual telah membuktikan pemanggilan AI murni tanpa tools. Pekerjaan penguncian tools pada fallback di S05 disederhanakan menjadi penegasan invariant.
- **Rekomendasi Urutan Eksekusi:** Peta dependensi di Bagian 0.4 tetap sangat relevan dan WAJIB dipertahankan:
  1. **S02 (P0 - Segera):** Inisialisasi `.git`, amankan `.env` dan `backups/` dari Google Drive sync, dan buat gitignore serta secret-checker.
  2. **S03 (P1 - Fondasi):** Perbaiki enum `trigger_type`, atasi duplikasi `getPrimaryOwner`, buat partial unique index `is_primary`.
  3. **S04 (P0):** Sanitasi prompt injection `special_notes` (A-20), soft delete pesanan (A-19).
  4. **S05 (P0):** Tangani TTL mute bot dan normalisasi format kontak `orders.customer_contact` (A-01, A-02).
  5. **S06 (P0):** Validasi graf siklik, singleton trigger, dan batas kedalaman rantai (A-03, A-04, A-05).
  6. **S07 s.d. S15:** Dilanjutkan sesuai urutan dependensi.

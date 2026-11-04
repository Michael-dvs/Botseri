# Step 07: Laporan Eksekusi n8n Proactive Scheduler

> Tanggal: 27 Oktober 2026
> Status: Implementasi dan verifikasi lokal selesai. Verifikasi container dan E2E `〔PERLU VERIFIKASI MANUAL〕` karena Docker daemon tidak tersedia.
> Roadmap: tetap `[ ]`.

## 1. Ringkasan Eksekusi dan Kepatuhan Arsitektur

Step 07 menambahkan statistik harian murni, slot reminder, query tugas aktif, pembacaan Calendar, retry Google, mesin `tick`, dua route scheduler, dan workflow n8n 15 menit. Claim job memakai satu statement atomik. Snapshot `daily_stats` dan rollover berada dalam satu transaksi. n8n hanya memanggil Internal API, memilih teks LLM atau fallback, mengirim lewat guard WAHA, lalu melaporkan hasil. Fallback, prompt scheduler, dan Code node workflow menolak karakter em dash. Suite lokal bertambah dari 95 menjadi 128 tes dan build Next.js berhasil. Aktivasi workflow, pengiriman WhatsApp, serta bukti SQL belum dapat diuji tanpa Docker daemon.

| Invarian | Status | Bukti |
|---|---|---|
| `INV-01` | Sesuai secara statis | `n8n-engine/workflows/botseri-scheduler.json` tidak memiliki node Postgres. `grep -RIn "DATABASE_URL" n8n-engine` tidak menghasilkan keluaran. |
| `INV-02` | Sesuai secara statis | Workflow hanya merujuk kredensial `Botseri Internal API`; tidak ada token atau API key literal. |
| `INV-03` | Sesuai | `dashboard/src/lib/stats/index.ts`, `dashboard/src/lib/scheduler/tick.ts`, dan `dashboard/src/lib/scheduler/slots.ts` menghitung tier, waktu, kuota, serta rollover sebelum data diberikan ke LLM. |
| `INV-04` | Sesuai | `claimJob()` di `dashboard/src/lib/scheduler/tick.ts` memakai satu `INSERT ... ON CONFLICT ... WHERE status = 'FAILED' AND attempts < 3`. |
| `INV-05` | Sesuai secara statis | Tanggal lokal memakai helper `dashboard/src/lib/time/index.ts`. Hasil grep pola terlarang `new Date().getHours` dan `toISOString().slice(0, 10)` pada file Step 07 kosong. Pemakaian `new Date()` yang tersisa hanya memperoleh instan UTC lalu diteruskan ke helper zona waktu. |
| `INV-06` | Sesuai | Workflow hanya memuat trigger, HTTP, IF, split, pemilihan fallback, sanitasi teks, dan pelaporan. |
| `INV-10` | Sesuai | Semua paket proaktif dibuat setelah `claimJob()` mengembalikan baris. |
| `INV-11` | Sesuai | Seluruh fallback dan instruksi pengguna menggunakan Bahasa Indonesia. |
| `INV-13` | Sesuai secara statis | Workflow mengirim hanya ke `/api/internal/waha/send`. Grep `WAHA_URL` dan `/api/sendText` pada file Step 07 kosong. |

## 2. Daftar File Dibuat atau Dimodifikasi

| Path | Status | Tujuan |
|---|---|---|
| `dashboard/src/lib/time/index.ts` | Ubah | Helper date-only, batas hari lokal, hari libur, dan konversi waktu lokal. |
| `dashboard/src/lib/stats/index.ts` | Baru | Statistik harian dan tier dengan validasi input eksplisit. |
| `dashboard/src/lib/scheduler/slots.ts` | Baru | Slot reminder deterministik dan pemilihan slot aktif. |
| `dashboard/src/lib/scheduler/queries.ts` | Baru | Query berparameter ke `v_active_todos` dan pemetaan data prompt minimal. |
| `dashboard/src/lib/scheduler/tick.ts` | Baru | Housekeeping, claim, brief, reminder, EOD, snapshot, rollover, dan fallback. |
| `dashboard/src/lib/google/calendar.ts` | Ubah | Daftar agenda hari lokal dengan timeout 20 detik. |
| `dashboard/src/lib/google/sync.ts` | Ubah | Retry pending sync, backoff murni, dan isolasi error per todo. |
| `dashboard/src/app/api/internal/scheduler/tick/route.ts` | Baru | Endpoint tick terautentikasi dan event `TICK_OK` atau `TICK_FAILED`. |
| `dashboard/src/app/api/internal/scheduler/jobs/[jobId]/result/route.ts` | Baru | Pelaporan hasil idempoten dan pencatatan kegagalan. |
| `dashboard/src/app/api/internal/waha/send/route.ts` | Ubah | Idempotency key persisten untuk mencegah kirim ulang job setelah laporan hasil gagal. |
| `dashboard/tests/unit/waha-send-route.test.ts` | Ubah | Verifikasi deduplikasi job scheduler berdasarkan idempotency key. |
| `dashboard/tests/unit/stats.test.ts` | Baru | Batas tier, presisi, dan input tidak valid. |
| `dashboard/tests/unit/scheduler-slots.test.ts` | Baru | Slot STRICT, SANTAI, batas 24, jam invalid, dan overlap. |
| `dashboard/tests/unit/scheduler-core.test.ts` | Baru | Jendela waktu, hari kerja, hari libur, backoff, dan fallback. |
| `n8n-engine/workflows/botseri-scheduler.json` | Baru | Workflow scheduler 15 menit tanpa akses database langsung. |
| `docs/reports/step-07-execution-report.md` | Baru | Laporan bukti dan batas verifikasi Step 07. |

Tidak ada migrasi baru. `daily_stats.local_date` sudah menjadi primary key dan unique claim sudah tersedia pada migrasi awal.

## 3. Hasil Verifikasi

### 3.1 Audit Fase 0

Skema aktual diverifikasi dari `dashboard/prisma/schema.prisma` dan `dashboard/prisma/migrations/20261020100000_init/migration.sql`.

| Objek | Hasil audit |
|---|---|
| `daily_execution_logs` | `id uuid`, `local_date date`, enum `job_type`, `seq integer`, enum `status`, `attempts integer`, `claimed_at timestamptz`, `sent_at timestamptz null`, `error text null`; unique `(local_date, job_type, seq)`. |
| `daily_stats` | `local_date date` adalah primary key; count integer; `completion_rate numeric(5,2)`; enum `tier`; `rolled_over_count`; `snapshot_at`. |
| `todos` | Memiliki `planned_date`, `due_at`, `rollover_count`, `google_sync_attempts`, `google_sync_status`, dan `updated_at`. Tidak memiliki `last_attempt_at`. |
| `v_active_todos` | Tersedia, memuat todo `PENDING` dan `IN_PROGRESS`. |
| Enum | `JobStatus`: `CLAIMED`, `SENT`, `FAILED`, `SKIPPED`; `JobType`: tiga job scheduler; `MessageDirection`: `INBOUND`, `OUTBOUND`. |
| `BotSettings` | Nama field sesuai prompt: `work_hours_start`, `work_hours_end`, `working_days`, `behavior_mode`, interval dan kuota reminder, `early_brief_time`, `brief_window_minutes`, `eod_window_minutes`. |
| n8n | `entrypoint.sh` menghitung hash, mengimpor workflow, lalu menjalankan `update:workflow --all --active=true`. |

Baseline sebelum perubahan:

```text
Test Files  14 passed (14)
Tests       95 passed (95)
Duration    2.69s
```

### 3.2 Tes Spesifik

Perintah:

```text
npm test -- tests/unit/stats.test.ts tests/unit/scheduler-slots.test.ts
```

Hasil akhir:

```text
Test Files  2 passed (2)
Tests       22 passed (22)
Duration    1.68s
```

Tes murni tambahan:

```text
Test Files  3 passed (3)
Tests       32 passed (32)
Duration    2.32s
```

### 3.3 Suite Penuh, Typecheck, Lint, dan Build

```text
Test Files  17 passed (17)
Tests       128 passed (128)
Duration    4.46s
```

```text
npx tsc --noEmit
Command executed successfully.
```

```text
npm run lint
No ESLint warnings or errors
```

`npm run build` berhasil dan mencantumkan route berikut:

```text
/api/internal/scheduler/jobs/[jobId]/result
/api/internal/scheduler/tick
```

`docker compose config --quiet` berhasil tanpa keluaran.

### 3.4 Workflow dan Docker

Validasi JSON lokal:

```text
botseriScheduler01
Botseri Scheduler
true
n8n-nodes-base.scheduleTrigger
n8n-nodes-base.httpRequest
n8n-nodes-base.if
n8n-nodes-base.splitOut
n8n-nodes-base.httpRequest
n8n-nodes-base.code
n8n-nodes-base.httpRequest
n8n-nodes-base.code
n8n-nodes-base.httpRequest
n8n-nodes-base.noOp
```

Build container pertama terblokir sandbox metadata Buildx. Setelah izin tulis terbatas diberikan, hasilnya:

```text
failed to connect to the docker API at unix:///Users/michaelarhdyn/.docker/run/docker.sock
check if the path is correct and if the daemon is running
```

`open -a Docker` menghasilkan:

```text
Unable to find application named 'Docker'
```

Karena itu, import n8n, aktivasi workflow, `docker compose ps`, dan pemeriksaan environment container berstatus `〔PERLU VERIFIKASI MANUAL〕`.

### 3.5 Skenario E2E

| Skenario | Hasil | Bukti |
|---|---|---|
| Tick manual n8n | `〔PERLU VERIFIKASI MANUAL〕` | Docker daemon tidak tersedia. |
| Morning Brief dan SQL log | `〔PERLU VERIFIKASI MANUAL〕` | Container dan layanan WhatsApp tidak dapat dijalankan. |
| LLM fallback | `〔PERLU VERIFIKASI MANUAL〕` | Fallback teruji unit, tetapi pengiriman nyata belum diuji. |
| EOD dan rollover | `〔PERLU VERIFIKASI MANUAL〕` | Logika murni teruji; bukti SQL transaksi memerlukan database berjalan. |
| Idempotensi tick dan rollover | `〔PERLU VERIFIKASI MANUAL〕` | Claim dan transaksi diperiksa statis; bukti SQL berulang belum tersedia. |
| WAHA tidak `WORKING` | `〔PERLU VERIFIKASI MANUAL〕` | Memerlukan container WAHA. |
| Klaim basi | `〔PERLU VERIFIKASI MANUAL〕` | Implementasi dan event tersedia; bukti DB belum tersedia. |
| Calendar gagal tetapi brief lanjut | `〔PERLU VERIFIKASI MANUAL〕` | `try/catch` dan event tersedia; kegagalan jaringan nyata belum disimulasikan. |
| Hari libur atau nonkerja | Teruji unit untuk helper | Pengujian tick dengan DB berstatus `〔PERLU VERIFIKASI MANUAL〕`. |
| Pembersihan data uji | Tidak diperlukan | Tidak ada data DB yang dibuat atau diubah karena Docker tidak berjalan. Bukti kueri hitungan berstatus `〔PERLU VERIFIKASI MANUAL〕`. |

Roadmap tidak diubah karena seluruh verifikasi Definition of Done belum selesai.

## 4. Penyimpangan, Keputusan Teknis, dan Catatan Stabilitas

1. Path yang diminta sebagai `ARCHITECTURE.md` tidak ada di root. Dokumen aktual berada di `docs/ARCHITECTURE.md`; dokumen aktual tersebut dipakai.
2. Prompt meminta slot STRICT mulai tepat pada jam masuk dengan indeks 0. `docs/ARCHITECTURE.md` bagian 10.7 dan spesifikasi Step 07 menetapkan slot pertama pada `work_hours_start + interval` dengan indeks 1. Sumber berperingkat lebih tinggi dipakai.
3. Prompt menyebut `last_attempt_at`, tetapi skema aktual tidak memilikinya. Spesifikasi Step 07 memakai `updated_at` sebagai waktu percobaan terakhir. Implementasi mengikuti spesifikasi Step dan skema aktual.
4. Input statistik wajib berupa bilangan bulat terbatas. `done < 0`, `done > target`, pecahan, dan `NaN` melempar error. `target <= 0` dengan `done = 0` menghasilkan `NO_TASKS`.
5. Jam kerja STRICT invalid atau kurang dari 30 menit menghasilkan array kosong. Slot overlap memilih slot terbaru yang sudah dimulai.
6. Arsitektur menetapkan `due_at` rollover yang sudah lewat ke jam mulai kerja pada hari kerja berikutnya. Aturan ini dipakai, bukan permintaan tingkat lebih rendah untuk mempertahankan jam lama.
7. Timeout Calendar 20 detik, LLM workflow 60 detik, WAHA 30 detik, dan laporan hasil 15 detik.
8. `message_log` sudah ditulis oleh `/api/internal/waha/send`. Workflow mengirim `job_id` sebagai idempotency key dan endpoint menyimpannya pada `in_reply_to`, sehingga retry setelah kegagalan laporan tidak mengirim ulang pesan yang sudah tercatat. Route hasil hanya membuat baris bila tidak menemukan pesan identik sejak waktu claim.
9. Status Google `NEEDS_REAUTH` mempertahankan todo pada antrean `PENDING`; percobaan sinkronisasi direset ke 0 setelah sinkronisasi sukses.
10. `daily_stats.completion_rate` bertipe `numeric(5,2)`, sehingga database menyimpan dua desimal. Tier tetap dihitung dari nilai mentah sebelum penyimpanan.
11. Risiko tersisa: perilaku import node `Split Out`, bentuk error HTTP n8n, aktivasi workflow, transaksi rollover pada PostgreSQL nyata, WAHA nyata, Google nyata, dan pemulihan retry belum memiliki bukti runtime karena Docker daemon tidak tersedia. Retry Google berjalan serial sesuai batas 20 dan masih bergantung pada timeout klien Google untuk operasi tulis.

## 5. Self-Verification

| Pemeriksaan | Hasil |
|---|---|
| Tidak ada `DATABASE_URL` di n8n atau node Postgres | Sesuai secara statis; grep kosong. Pemeriksaan env container `〔PERLU VERIFIKASI MANUAL〕`. |
| Tidak ada hitung statistik di LLM atau n8n | Sesuai secara statis. |
| Waktu lokal melalui `lib/time` | Sesuai secara statis. |
| Tidak ada direct WAHA pada Step 07 | Sesuai; grep kosong. |
| Tidak ada karakter em dash pada fallback, route, workflow, dan tes Step 07 | Sesuai; grep kosong. |
| Tidak ada `TODO`, `FIXME`, atau komentar pemotong | Sesuai; grep kosong. |
| SQL berparameter | Sesuai; tidak ada `$queryRawUnsafe` atau `$executeRawUnsafe`. |
| Token dan nomor utuh tidak dicatat oleh scheduler | Sesuai berdasarkan inspeksi kode. |
| Claim atomik dan rollover plus snapshot satu transaksi | Sesuai berdasarkan inspeksi kode. |
| Data uji bersih dan settings pulih | Tidak ada mutasi data. Bukti SQL `〔PERLU VERIFIKASI MANUAL〕`. |

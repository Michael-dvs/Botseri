# Step 04 — Laporan Eksekusi Dashboard: Live Board, Orders, Priority Stack, dan Prompt Editor

> **Tanggal:** 20 Oktober 2026
> **Status:** Selesai
> **Rujukan:** [`step-04-dashboard-ui-todo-and-priority-stack.md`](../steps/step-04-dashboard-ui-todo-and-priority-stack.md), `ARCHITECTURE.md` §4, §5, §6, §8, `antislop.md`, `AGENTS.md`

---

## 1. Ringkasan Eksekusi & Kepatuhan Arsitektur

Step 04 membangun seluruh antarmuka operasional harian untuk pemilik usaha (UMKM florist/dekorasi) yang mencakup:
1. **Layout Aplikasi & Sesi**: Route group `(app)` terproteksi sesi JWT admin, validasi status setup, navigasi konsisten ke 9 halaman, dan tombol keluar.
2. **Ringkasan Operasional**: Dashboard hari ini yang menghitung rasio penyelesaian tugas aktif (tanpa tugas dibatalkan), status LLM aktif, status Google OAuth, dan 3 Fokus Utama dari database view `v_active_todos`.
3. **Live Board To-Do & CRUD**: Pembuatan tugas cepat dengan penentuan otomatis `planned_date` berdasarkan zona waktu usaha (`Asia/Jakarta`), pembaruan status (`DONE`, `CANCELLED`, buka kembali), sinkronisasi `completed_at`, dan filter status.
4. **Live Board Orders & CRUD**: Pengelolaan pesanan pelanggan lengkap (kontak, acara, kirim, alamat, nominal, DP, status pembayaran `UNPAID` / `DP_PAID` / `PAID`, catatan) dengan pengubah status pembayaran langsung.
5. **Drag-and-Drop Priority Stack**: Pengurutan kartu prioritas taktil berbasis `@dnd-kit` dengan sensor pointer dan keyboard, transaksi 2 fase bebas tabrakan `UNIQUE(rank)`, sinkronisasi otomatis kolom denormalisasi `todos.priority_rank`, proteksi hapus `HTTP 409` bila masih dipakai tugas aktif, dan kompilasi ulang otomatis prompt sistem.
6. **Prompt Editor & Live Preview**: Editor mode `STACK` vs `CUSTOM`, validasi placeholder asing `HTTP 400`, serta pratinjau rendering runtime per trigger (`CHAT_MASUK`, `MORNING_BRIEF`, `WORK_HOURS_REMINDER`, `END_OF_DAY_EVAL`) menggunakan data tugas aktif riil tanpa sisa placeholder runtime.

### Kepatuhan `AGENTS.md` dan `antislop.md`

- **Design Read**: Dideklarasikan untuk dashboard operasional pemilik usaha UMKM florist/dekorasi dengan bahasa visual *editorial utilitarian*, dial **ENERGY 1 / RHYTHM 2 / MOTION 1**.
- **Larangan Em Dash (R-02)**: Seluruh string UI buatan agen bebas karakter em dash (`—`), digantikan dengan pemisah titik tengah (`·`), kolon (`:`), atau tanda kurung.
- **Responsivitas Mobile (R-03)**: Seluruh tabel operasional To-Do dan Pesanan menggunakan sistem responsive CSS grid (`board-grid` dan `order-grid`) yang secara mulus bertransformasi menjadi kartu data terlabel vertikal di layar ponsel tanpa *horizontal overflow* dan dengan ukuran target sentuh minimal 44px.
- **Aksesibilitas Keyboard & Kontras (R-25, R-32)**: Drag-and-drop dilengkapi `KeyboardSensor` dan `sortableKeyboardCoordinates` (dapat digerakkan dengan `Space` dan tombol panah). Seluruh teks memenuhi rasio kontras WCAG AA (warna tinta `#1c1917` di atas kertas `#f4f0e6` dan permukaan `#fffdf8`, dengan aksen terakota `#9a3412`).
- **Kelengkapan State UI (R-27)**: Tersedia state loading (`loading.tsx`), penanganan error (`error.tsx`), empty state di setiap papan, dan status disabled/busy pada tombol aksi form.
- **Navigasi Jujur (R-24)**: Tidak ada tautan navbar yang mengarah ke endpoint hantu (404); rute `/settings`, `/integrations`, `/analytics`, dan `/logs` dibuat dengan komponen `ComingSoon` yang secara transparan menyatakan status tahap berikutnya tanpa tombol fiktif.
- **Disiplin Invarian**:
  - `INV-01`: Semua data bersumber dari PostgreSQL melalui server components dan API dashboard.
  - `INV-03`: Seluruh persentase, urutan, dan tier dihitung di TypeScript/SQL, bukan oleh LLM.
  - `INV-05`: Seluruh konversi waktu lokal menggunakan helper `lib/time` (`localDateString`, `formatLocalDateTime`, `localDateTimeInputToUtc`).
  - `INV-09`: Setiap mutasi di-parse secara ketat menggunakan skema `zod`.

---

## 2. Daftar File yang Dibuat / Dimodifikasi

| File | Status | Peran & Tanggung Jawab |
|---|---|---|
| `dashboard/package.json` | Dimodifikasi | Menambahkan dependensi `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `dashboard/package-lock.json` | Dimodifikasi | Lockfile dependensi drag-and-drop |
| `dashboard/src/app/globals.css` | Dimodifikasi | Menetapkan token warna utilitarian (paper, ink, accent terakota), layout responsive board grid, target sentuh minimal 44px, dan styling print-like |
| `dashboard/src/app/layout.tsx` | Dimodifikasi | Mengatur metadata aplikasi dan bahasa dokumen (`id`) |
| `dashboard/src/lib/time/index.ts` | Dimodifikasi | Menambahkan `formatLocalDateTime`, `formatLocalDate`, dan `localDateTimeInputToUtc` dengan locale `id` |
| `dashboard/src/lib/prompt/compiler.ts` | Dimodifikasi | Menghapus karakter em dash pada prompt stack generator dan memperluas tipe `compileAndStore` agar dapat berjalan di dalam transaksi Prisma |
| `dashboard/src/components/LogoutButton.tsx` | Baru | Tombol keluar berbasis sesi dengan pemanggilan `POST /api/auth/logout` |
| `dashboard/src/components/AppNav.tsx` | Baru | Navigasi utama dengan penanda visual rute aktif (`aria-current="page"`) |
| `dashboard/src/components/ComingSoon.tsx` | Baru | Komponen penampung transparan untuk halaman rute yang berada di step berikutnya |
| `dashboard/src/app/(app)/layout.tsx` | Baru | Layout terproteksi sesi JWT admin dan status setup dengan header navigasi |
| `dashboard/src/app/(app)/loading.tsx` | Baru | Indikator pemuatan rute grup aplikasi |
| `dashboard/src/app/(app)/error.tsx` | Baru | Error boundary aplikasi dengan tombol coba lagi dan tautan kembali |
| `dashboard/src/app/(app)/dashboard/page.tsx` | Baru | Halaman ringkasan hari ini, progres penyelesaian, status integrasi, dan 3 Fokus Utama |
| `dashboard/src/app/dashboard/page.tsx` | Dihapus | Menghapus file placeholder lama Step 03 untuk mencegah konflik rute Next.js |
| `dashboard/src/app/(app)/todos/page.tsx` | Baru | Server component pemuat data to-do, priority levels, dan tanggal operasional |
| `dashboard/src/app/(app)/todos/TodoBoard.tsx` | Baru | Client component form pembuatan to-do cepat, filter status, pengubah status, dan hapus |
| `dashboard/src/app/api/todos/route.ts` | Baru | API `GET` (daftar to-do) dan `POST` (buat to-do dengan penentuan `planned_date` lokal) |
| `dashboard/src/app/api/todos/[id]/route.ts` | Baru | API `PATCH` (update status/field to-do, auto-fill `completed_at`) dan `DELETE` (hapus to-do) |
| `dashboard/src/app/(app)/orders/page.tsx` | Baru | Server component pemuat data pesanan pelanggan |
| `dashboard/src/app/(app)/orders/OrderBoard.tsx` | Baru | Client component form pencatatan pesanan dan papan daftar dengan pengubah status bayar |
| `dashboard/src/app/api/orders/route.ts` | Baru | API `GET` (daftar pesanan) dan `POST` (buat pesanan baru) |
| `dashboard/src/app/api/orders/[id]/route.ts` | Baru | API `PATCH` (update pesanan/status pembayaran) dan `DELETE` (hapus pesanan) |
| `dashboard/src/app/(app)/priority-stack/page.tsx` | Baru | Server component pemuat data urutan tingkat prioritas |
| `dashboard/src/app/(app)/priority-stack/StackEditor.tsx` | Baru | Client component editor drag-and-drop kartu prioritas dengan `@dnd-kit` |
| `dashboard/src/app/api/priority-levels/route.ts` | Baru | API `GET` (daftar tingkat prioritas) dan `POST` (tambah tingkat + auto recompile) |
| `dashboard/src/app/api/priority-levels/[id]/route.ts` | Baru | API `PATCH` (edit label/aturan) dan `DELETE` (proteksi 409 + pemindahan to-do) |
| `dashboard/src/app/api/priority-levels/reorder/route.ts` | Baru | API `PUT` pengurutan 2 fase, sinkronisasi `todos.priority_rank`, dan kompilasi prompt |
| `dashboard/src/app/(app)/prompt/page.tsx` | Baru | Server component pemuat status prompt dan versi aktif |
| `dashboard/src/app/(app)/prompt/PromptEditor.tsx` | Baru | Client component editor prompt mode STACK/CUSTOM dan live trigger preview |
| `dashboard/src/app/api/prompt/route.ts` | Baru | API `GET` (detail prompt) dan `PUT` (simpan template + validasi placeholder) |
| `dashboard/src/app/api/prompt/preview/route.ts` | Baru | API `POST` render pratinjau per trigger dengan sampel konteks nyata |
| `dashboard/src/app/(app)/settings/page.tsx` | Baru | Halaman tujuan ComingSoon untuk pengaturan (Step 05) |
| `dashboard/src/app/(app)/integrations/page.tsx` | Baru | Halaman tujuan ComingSoon untuk integrasi WAHA & Google (Step 05) |
| `dashboard/src/app/(app)/analytics/page.tsx` | Baru | Halaman tujuan ComingSoon untuk analitik penggunaan (Step 08) |
| `dashboard/src/app/(app)/logs/page.tsx` | Baru | Halaman tujuan ComingSoon untuk audit log (Step 08) |
| `dashboard/src/app/login/page.tsx` | Dimodifikasi | Penyesuaian visual form login agar selaras dengan token desain utilitarian |
| `dashboard/src/app/setup/page.tsx` | Dimodifikasi | Penyesuaian visual form setup bootstrap agar selaras dengan token desain utilitarian |
| `docs/steps/00-MASTER-ROADMAP.md` | Dimodifikasi | Memperbarui status checklist dan tabel progress Step 04 menjadi `[x]` |

---

## 3. Log Hasil Verifikasi (Definition of Done)

### 3.1 Unit Test, Type Check, dan Production Build

1. **Unit Test (`npm test`)**:
   ```text
   RUN v2.1.9 /dashboard
   ✓ tests/unit/crypto.test.ts (3 tests)
   ✓ tests/unit/prompt.test.ts (6 tests)
   ✓ tests/unit/time.test.ts (5 tests)
   Test Files  3 passed (3)
   Tests       14 passed (14)
   ```
2. **Type Check (`npx tsc --noEmit`)**:
   Lulus 100% tanpa error TypeScript.
3. **Production Build (`npm run build`)**:
   Berhasil mengompilasi 30 rute halaman dan API. Seluruh route handler API database ditandai `export const dynamic = "force-dynamic"` untuk mencegah kegagalan prerender statis saat fase build.
4. **Docker Container Deployment**:
   Image `botseri-dashboard` berhasil di-build ulang (`build_exit=0`) dan container `botseri-dashboard` berhasil direstart dan berstatus `Up (healthy)` pada port `127.0.0.1:3000`.

---

### 3.2 Hasil Pengujian 9 Skenario Definition of Done

Semua skenario diuji secara fungsional menggunakan HTTP request nyata dengan header autentikasi sesi JWT `botseri_session` dan header proteksi CSRF `Origin: http://127.0.0.1:3000`:

#### Skenario 1 — Dashboard Overview & 3 Fokus Utama
- Panggilan: `GET http://127.0.0.1:3000/dashboard`
- Hasil: `HTTP 200`
- Verifikasi Konten: Menampilkan nama usaha "Kembang Berseri", username sesi aktif "Berseri", bagian "Ringkasan operasional", persentase penyelesaian, dan blok "3 Fokus Utama".

#### Skenario 2 & 3 — To-Do CRUD, Timezone Planned Date, dan Completed At
- Panggilan Create: `POST /api/todos` dengan payload:
  `{"title":"Antar buket Bu Ani","priority_rank":1,"due_at":"2026-10-21T10:00:00+07:00","has_specific_time":true}`
- Hasil Create: `HTTP 200`, ID `437e44f5-08e3-4c2d-b90a-fded0bae4608`.
- Verifikasi Database PostgreSQL:
  ```text
  title              | priority_rank | planned_date | due_at                 | status
  Antar buket Bu Ani | 1             | 2026-10-21   | 2026-10-21 03:00:00+00 | PENDING
  ```
  `planned_date` tepat sama dengan tanggal lokal tenggat di zona waktu `Asia/Jakarta` (`2026-10-21`).
- Panggilan Update Status: `PATCH /api/todos/437e44f5-08e3-4c2d-b90a-fded0bae4608` dengan `{"status":"DONE"}`.
- Hasil Update: `HTTP 200`.
- Verifikasi Database PostgreSQL:
  ```text
  status | completed_at
  DONE   | 2026-10-20 15:50:31.094+00
  ```
  `completed_at` terisi timestamp UTC saat tugas diselesaikan.

#### Skenario 4 & 5 — Priority Stack Reorder 2-Fase & Edit Label
- Panggilan Reorder: `PUT /api/priority-levels/reorder` dengan urutan terbalik `[Rutin, Cashflow, Penting, Kritis]`.
- Hasil Reorder: `HTTP 200`, `warnings: []`.
- Verifikasi Database PostgreSQL:
  - Fase 1 (rank negatif sementara) dan Fase 2 (rank positif 1..N) selesai tanpa melanggar `UNIQUE(rank)`.
  - Urutan baru di database: Rutin (rank 1), Cashflow (rank 2), Penting (rank 3), Kritis (rank 4).
  - Kolom denormalisasi `todos.priority_rank` untuk "Antar buket Bu Ani" otomatis tersinkronisasi dari rank 1 menjadi rank 4 sesuai level Kritis.
  - Nilai `bot_settings.compiled_prompt_version` naik dari versi 2 menjadi versi 3.
- Panggilan Edit Label: `PATCH /api/priority-levels/4723bba8-c751-4a45-a767-495d2869b615` dengan `{"label":"Super Kritis"}`.
- Hasil Edit: `HTTP 200`.
- Verifikasi Database PostgreSQL:
  - `priority_levels.label` berubah menjadi "Super Kritis".
  - `bot_settings.compiled_prompt` terkompilasi ulang dan memuat teks "Super Kritis".
  - `bot_settings.compiled_prompt_version` naik menjadi versi 4.

#### Skenario 6 — Proteksi Penghapusan Priority Level (HTTP 409 & Move To Rank)
- Panggilan Hapus Tanpa Move: `DELETE /api/priority-levels/4723bba8-c751-4a45-a767-495d2869b615` dengan `{}`.
- Hasil: `HTTP 409 Conflict`, payload `{"ok":false,"error":"pindahkan to-do ke tingkat lain terlebih dahulu","todo_count":1}`.
- Panggilan Hapus Dengan Move: `DELETE /api/priority-levels/4723bba8-c751-4a45-a767-495d2869b615` dengan `{"move_to_rank":1}` (dipindahkan ke Rutin).
- Hasil: `HTTP 200 OK`.
- Verifikasi Database PostgreSQL:
  - Level berhasil dihapus dari tabel `priority_levels`.
  - Tugas "Antar buket Bu Ani" berpindah ke level Rutin dengan `priority_rank = 1`.
  - Prompt sistem terkompilasi ulang dan versi prompt naik menjadi versi 5.

#### Skenario 7 & 8 — Validasi Placeholder Ilegal & Live Trigger Preview
- Panggilan Validasi: `PUT /api/prompt` dengan `{"prompt_mode":"CUSTOM","custom_prompt_template":"Halo {{brand_name}} {{foo}}"}`.
- Hasil Validasi: `HTTP 400 Bad Request`, payload `{"ok":false,"error":"placeholder tidak dikenal: foo"}`.
- Panggilan Preview: `POST /api/prompt/preview` dengan `{"trigger_type":"MORNING_BRIEF"}`.
- Hasil Preview: `HTTP 200 OK`.
- Verifikasi Output Pratinjau:
  - Memuat blok `INSTRUKSI MODE: MORNING BRIEF`: `true`.
  - Blok trigger lain terisolasi/terbuang (`CHAT MASUK`: `false`, `PENGINGAT JAM KERJA`: `false`, `EVALUASI AKHIR HARI`: `false`).
  - Sisa placeholder runtime yang belum terisi (`{{...}}`): `false` (semua placeholder terisi konteks sampel nyata dari database).

#### Skenario 9 — Orders CRUD
- Panggilan Create: `POST /api/orders` dengan data pesanan Pak Budi (total 1.500.000, DP 500.000, `payment_status: UNPAID`).
- Hasil Create: `HTTP 200`, ID `9cfdfd48-9331-4df1-a3b9-6b4eb46452e0`.
- Panggilan Update DP: `PATCH /api/orders/9cfdfd48-9331-4df1-a3b9-6b4eb46452e0` dengan `{"payment_status":"DP_PAID"}` -> `HTTP 200`, `payment_status = DP_PAID`.
- Panggilan Update Lunas: `PATCH /api/orders/9cfdfd48-9331-4df1-a3b9-6b4eb46452e0` dengan `{"payment_status":"PAID"}` -> `HTTP 200`, `payment_status = PAID`.
- Panggilan Hapus: `DELETE /api/orders/9cfdfd48-9331-4df1-a3b9-6b4eb46452e0` -> `HTTP 200`.
- Verifikasi Database PostgreSQL: Baris pesanan terhapus sepenuhnya (`count = 0`).

---

### 3.3 Pembersihan State Pasca Uji Coba

Setelah seluruh skenario pengujian diverifikasi:
1. Data to-do dan pesanan uji coba dibersihkan (`DELETE FROM todos; DELETE FROM orders;`).
2. Empat tingkat prioritas standar dikembalikan utuh dengan urutan peringkat 1..4 (Kritis: 1, Penting dan mudah rusak: 2, Cashflow: 3, Rutin: 4).
3. Prompt sistem dikompilasi ulang ke mode `STACK`, menghasilkan `compiled_prompt_version = 6` yang bersih dan sinkron dengan keempat tingkat prioritas standar tersebut.

---

## 4. Penyimpangan, Keputusan Teknis, & Risiko

1. **`export const dynamic = "force-dynamic"` pada Route Handlers**:
   Next.js 14 App Router secara default mencoba mengompilasi rute `GET` tanpa argumen dinamis sebagai rute statis pada waktu build. Karena waktu build image Docker berjalan tanpa koneksi database aktif (`DATABASE_URL`), seluruh route handler API yang menyentuh database ditandai eksplisit `export const dynamic = "force-dynamic"` agar dievaluasi saat runtime.
2. **Kompilasi Prompt di Dalam Transaksi Database**:
   Fungsi `compileAndStore` disesuaikan agar menerima `Pick<PrismaClient, "priorityLevel" | "botSettings">`. Hal ini memungkinkan kompilasi ulang prompt dan pembaruan `bot_settings` dijalankan di dalam transaksi atomik yang sama dengan reorder 2 fase, penambahan level, maupun penghapusan level, sehingga mencegah terjadinya inkonsistensi versi prompt bila salah satu operasi gagal.
3. **Penyelarasan Tanggal Input Form**:
   Input form browser menggunakan tipe `datetime-local` yang menghasilkan string waktu lokal peramban. Agar mematuhi `INV-05`, helper `localDateTimeInputToUtc` mengonversi waktu tersebut menjadi objek Date UTC berbasis zona waktu operasional usaha (`Asia/Jakarta`) sebelum dikirimkan ke server.
4. **Navigasi Rute Lanjutan (ComingSoon)**:
   Untuk memenuhi spesifikasi 9 link navbar tanpa melanggar aturan anti-slop `R-24` (larangan tautan navigasi ke halaman 404/fiktif), dibuat 4 halaman tujuan server component transparan (`/settings`, `/integrations`, `/analytics`, `/logs`) yang menginformasikan tahapan rute tersebut tanpa menyajikan kontrol palsu.
5. **Risiko**:
   Setiap perubahan pada Priority Stack memicu kompilasi ulang prompt sistem secara sinkron di dalam transaksi database. Untuk jumlah tingkat prioritas normal UMKM (3 sampai 7 tingkat), latensi ini tidak terasa (< 20ms). Namun, jika jumlah tingkat prioritas bertambah signifikan di masa depan, proses kompilasi ini disarankan dipindahkan ke background task atau *deferred debounce*.

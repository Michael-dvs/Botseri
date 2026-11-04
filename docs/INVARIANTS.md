# Invarian Arsitektur Botseri

> **Status Dokumen:** Kanonik (Sumber Kebenaran Mutlak Invarian Sistem)  
> **Rujukan Arsitektur:** `docs/ARCHITECTURE.md` §2.2, `docs/steps/00-MASTER-ROADMAP.md`  
> **Kepatuhan:** Wajib dipatuhi oleh seluruh kode, workflow n8n, skrip, dan agen AI coding (G-01, antislop R-02).

Dokumen ini mendefinisikan 16 invarian arsitektur (`INV-01` s.d. `INV-16`) yang menjadi batasan keras sistem Botseri. Tidak ada fitur, refactoring, atau perubahan kode yang boleh melanggar invarian ini.

---

## Daftar Invarian Sistem

### INV-01 : PostgreSQL adalah Satu-Satunya Sumber Kebenaran (SSOT)
PostgreSQL adalah satu-satunya sumber kebenaran data aplikasi. Hanya container `botseri-dashboard` yang terhubung langsung ke PostgreSQL. Container lain (`botseri-n8n`, `botseri-waha`, dan Cloudflare Tunnel) dilarang keras memiliki variabel lingkungan `DATABASE_URL`, driver database, atau koneksi langsung ke PostgreSQL. Seluruh akses data n8n wajib melalui Internal API dashboard (`/api/internal/*`).

### INV-02 : Perlindungan Rahasia Tingkat Nol (Zero Plain Secrets)
Kredensial rahasia (kunci API LLM, token OAuth Google, client secret, encryption key) tidak boleh berada di n8n, di berkas JSON workflow, di log, atau di respons API publik. Kunci API dan token pihak ketiga disimpan terenkripsi menggunakan AES-256-GCM berawalan `v1:` dengan Additional Authenticated Data (AAD) unik di PostgreSQL, dan hanya didekripsi saat pemanggilan keluar oleh dashboard.

### INV-03 : Otak Deterministik, Mulut Generatif
Model Bahasa Besar (LLM) dilarang keras menghitung matematika, angka statistik, persentase, tanggal relatif, atau urutan prioritas kerja. Seluruh kalkulasi, agregasi SQL, penentuan tier evaluasi, dan penyusunan urutan to-do dihitung secara deterministik oleh kode TypeScript/SQL dan diserahkan ke LLM sebagai data mentah siap pakai.

### INV-04 : Idempotensi Job Terjadwal via Klaim Atomik
Setiap job terjadwal (Morning Brief, Work Hours Reminder, End of Day Eval, Task Alarm) bersifat idempoten melalui mekanisme klaim atomik satu kali di tabel `daily_execution_logs` (`INSERT ... ON CONFLICT ... WHERE status = 'FAILED' AND attempts < 3`). Pemanggilan ganda pada tick yang sama tidak akan mengeksekusi atau mengirim pesan lebih dari satu kali.

### INV-05 : Zona Waktu Berseri dan Standar UTC
Semua timestamp di database disimpan dengan tipe `timestamptz` (UTC). Seluruh konversi ke tanggal dan waktu lokal wajib melewati modul helper `dashboard/src/lib/time` dengan mengacu pada zona waktu operasional usaha dari `bot_settings.timezone` (default: `Asia/Jakarta`). Dilarang memanggil `new Date().getHours()` atau manipulasi waktu lokal mentah di komponen backend/frontend.

### INV-06 : Workflow n8n Tanpa Aturan Bisnis
Workflow n8n bertindak murni sebagai orkestrator alur kerja, pemanggil LLM Gateway, dan pengirim pesan. n8n dilarang memuat aturan logika bisnis, seperti ambang evaluasi performa, rumus perhitungan prioritas, definisi slot jadwal, atau parsing status pembayaran.

### INV-07 (Revisi S03) : Isolasi Pengirim dan Jalur Pelanggan Publik
Nomor WhatsApp yang tidak terdaftar di `authorized_numbers` diklasifikasikan sebagai Pelanggan. Jika pengaturan `allow_unregistered_customers = true`, pesan diproses secara eksklusif oleh jalur penanganan pelanggan (`POST /api/internal/customer/handle`) melalui state machine deterministik. Pesan pelanggan TIDAK PERNAH menjangkau agen owner, tool operasional internal, atau konteks kerja pemilik. Jika `allow_unregistered_customers = false`, pesan non-whitelist ditolak tanpa balasan (*silent drop*), kecuali pada alur pendaftaran nomor (`pairing`).

### INV-08 : Proteksi Total Rute Internal dari Internet
Seluruh endpoint di bawah `/api/internal/*` dilindungi dengan pertahanan berlapis dan dilarang keras dapat diakses dari internet. Request yang membawa header Cloudflare (`cf-connecting-ip` atau `cf-ray`) seketika ditolak dengan HTTP 404 (Not Found) berbadan kosong oleh middleware aplikasi, dan aturan ingress Cloudflare Tunnel memutus akses path tersebut sebelum mencapai server.

### INV-09 : Validasi Skema Ketat pada Batas Input Tool
Input dari LLM ke tool AI operasional dianggap sebagai data tidak tepercaya. Setiap endpoint tool wajib memvalidasi body request secara ketat menggunakan skema Zod dan menjamin idempotensi eksekusi.

### INV-10 : Integritas Pesan Proaktif
Semua pesan WhatsApp proaktif (Morning Brief, Pengingat Jam Kerja, Evaluasi Harian) hanya dikirim setelah job berhasil diklaim secara sah dari catatan `daily_execution_logs`. Workflow dilarang mengirimkan pesan proaktif mandiri di luar jadwal yang dikelola oleh scheduler tick.

### INV-11 : Bahasa Resmi Operasional
Seluruh teks balasan kepada pengguna (WhatsApp), antarmuka web dashboard, pesan commit, dan dokumentasi resmi wajib menggunakan Bahasa Indonesia yang komunikatif, profesional, dan bebas dari karakter em dash (`R-02 antislop.md`).

### INV-12 : Migrasi Database Maju (Forward-Only)
Perubahan skema database PostgreSQL hanya diizinkan melalui migrasi Prisma maju (*forward-only*). Dilarang melakukan perubahan DDL manual di basis data produksi atau menjalankan perintah destruktif seperti `prisma migrate reset` atau `DROP TABLE`.

### INV-13 (Revisi S03) : Penjaga Outbound WAHA & Sumber Enum Tunggal
Seluruh pengiriman pesan keluar WhatsApp dilarang menembak driver WAHA secara langsung dan wajib melewati endpoint `POST /api/internal/waha/send`. Jenis pemicu pesan keluar (*trigger_type*) wajib merujuk secara tunggal ke konstanta `OUTBOUND_TRIGGERS` di `dashboard/src/lib/waha/triggers.ts`. Setiap penambahan jenis trigger baru wajib didaftarkan di berkas tersebut dan lulus uji kontrak otomatis (`workflow-contract.test.ts` dan `validate-workflows.sh`).

### INV-14 (Baru S03/S04) : Pemisahan Data Pelanggan Tidak Tepercaya (Untrusted Customer Data)
Teks bebas yang berasal dari pelanggan (seperti formulir pesanan, request khusus, dan pesan chat) adalah data tidak tepercaya. Data ini dilarang keras diperlakukan sebagai instruksi bagi model bahasa dan dilarang dieksekusi sebagai perintah. Pada respons tool internal, teks pelanggan wajib dipisahkan ke dalam field `customer_text` dengan penanda `untrusted: true` dan disanitasi dari upaya prompt injection.

### INV-15 (Baru S03/S04) : Konfirmasi Dua Langkah Deterministik untuk Aksi Kritis
Setiap aksi destruktif (seperti penghapusan pesanan `DELETE` atau pembatalan `CANCEL`) serta aksi perubahan status massal (`ALL` atau `SEMUA`) wajib melalui konfirmasi dua langkah deterministik di sisi server sebelum dieksekusi. LLM dilarang mengeksekusi aksi kritis secara langsung dalam satu kali pemanggilan tool. Server menyimpan tiket konfirmasi berbatas waktu 5 menit di tabel `pending_confirmations`, dan eksekusi dilakukan secara deterministik saat owner membalas pesan persetujuan tanpa memanggil LLM kembali.

### INV-16 (Baru S03/S06) : Validasi Server pada Konfigurasi Graf Alur Kerja
Konfigurasi graf alur kerja visual (`PipelineGraph`) yang disimpan melalui `PUT /api/pipeline` wajib lolos validasi integritas di sisi server: tidak memuat siklus tanpa henti (*acyclic*), mematuhi aturan simpul masuk tunggal (*singleton `TRIGGER_INBOUND`*), dan seluruh kabel koneksi (*edges*) terhubung pada port input/output yang valid.

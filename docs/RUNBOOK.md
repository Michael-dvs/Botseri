# RUNBOOK Operasional Botseri

Panduan operasional, pemeliharaan, penanganan insiden, dan prosedur darurat untuk sistem Botseri di lingkungan produksi home-server Windows 10 WSL2 atau Linux.

---

## 1. Operasi Harian dan Pemantauan

### 1.1 Memeriksa Status Container
Jalankan perintah berikut dari direktori root proyek:

```bash
docker compose ps
```

Seluruh empat container inti (`botseri-db`, `botseri-dashboard`, `botseri-waha`, `botseri-n8n`) harus berada dalam status `running` atau `healthy`. Container `botseri-tunnel` hanya berjalan bila profil `tunnel` diaktifkan.

### 1.2 Membaca Log Layanan
Gunakan perintah berikut untuk memantau log per layanan secara langsung:

```bash
# Dashboard (Next.js, internal API, dan sinkronisasi Google)
docker compose logs -f botseri-dashboard

# Mesin orkestrasi n8n
docker compose logs -f botseri-n8n

# WhatsApp HTTP API (WAHA)
docker compose logs -f botseri-waha

# Database PostgreSQL
docker compose logs -f botseri-db
```

### 1.3 Membaca Halaman Observabilitas `/status`
Akses halaman `http://localhost:3000/status` (atau melalui domain panel owner). Halaman ini menyajikan pemeriksaan real-time tanpa cache (`force-dynamic`):

| Indikator | Nilai Normal | Arti Nilai Non-Normal | Tindakan |
|---|---|---|---|
| **Database** | Terhubung (OK) | Tidak Terhubung (GAGAL) | Periksa `docker compose ps botseri-db` dan ruang disk host. |
| **WAHA** | WORKING | SCAN_QR_CODE / FAILED / UNREACHABLE | Buka menu Integrasi untuk scan QR atau restart container WAHA. |
| **Google** | CONNECTED | NEEDS_REAUTH / DISCONNECTED | Otorisasi ulang akun Google di menu Integrasi. |
| **LLM Aktif** | Provider dan Model tampil | Belum dikonfigurasi | Tambahkan dan aktifkan konfigurasi model di menu Integrasi. |
| **Detak Scheduler** | SEGAR (umur < 30 menit) | STALE (umur > 30 menit) / NEVER | Banner amber muncul. Periksa apakah container n8n berjalan dan periksa log tick. |
| **Sinkronisasi Google** | LANCAR (0 tertunda) | N TERTUNDA / MACET | Bila ada tugas dengan percobaan >= 8, intervensi manual diperlukan. |

#### Banner Amber Detak Scheduler
Jika detak scheduler tidak tercatat selama lebih dari 30 menit, banner peringatan amber akan muncul di bagian atas halaman `/status`. Mengingat scheduler berjalan tiap 15 menit, kondisi ini menandakan sedikitnya dua siklus detak terlewat. Segera periksa status container `botseri-n8n`.

---

## 2. Pengelolaan WhatsApp (WAHA)

### 2.1 Arti Status Sesi
- `WORKING`: Nomor WhatsApp bot terhubung aktif dan siap menerima/mengirim pesan.
- `SCAN_QR_CODE`: Sesi baru dibuat atau sesi lama terputus; memerlukan pemindaian kode QR melalui aplikasi WhatsApp di ponsel bot.
- `FAILED` / `STOPPED`: Sesi WhatsApp terhenti karena kegagalan jaringan atau logout dari ponsel.
- `UNREACHABLE`: Container `botseri-waha` tidak dapat dijangkau dari dashboard.

### 2.2 Prosedur Pemindaian Ulang QR
1. Buka browser ke menu `http://localhost:3000/integrations`.
2. Pada bagian WhatsApp Bot Engine (WAHA), klik tombol **Mulai Sesi**.
3. Pindai kode QR yang muncul menggunakan fitur Perangkat Tertaut di aplikasi WhatsApp nomor bot.
4. Tunggu hingga status berubah menjadi `WORKING`.

### 2.3 Proteksi Volume Sesi
Data sesi login WhatsApp disimpan pada volume persisten `botseri_wahadata` di path container `/app/.sessions`.

> **PERINGATAN KERAS:** Jangan pernah menjalankan `docker compose down -v` di lingkungan produksi. Flag `-v` akan menghapus seluruh volume Docker, termasuk sesi WhatsApp, sehingga bot harus dipindai ulang dan seluruh data database terhapus.

---

## 3. Integrasi Google OAuth

### 3.1 Status `NEEDS_REAUTH`
Status ini terjadi ketika Google menolak refresh token, biasanya karena:
- Izin akses dicabut oleh pengguna dari Google Account Security.
- Aplikasi Google Cloud Console masih dalam status **Testing** (belum dipublikasikan/diverifikasi). Pada mode Testing, refresh token Google kedaluwarsa secara otomatis setiap 7 hari.
- Kata sandi akun Google diubah.

### 3.2 Prosedur Otorisasi Ulang
1. Buka menu `http://localhost:3000/integrations`.
2. Klik tombol **Hubungkan Ulang Google**.
3. Selesaikan alur persetujuan OAuth di layar Google.
4. Setelah dialihkan kembali ke panel, pastikan status berubah menjadi `CONNECTED`.

---

## 4. Scheduler dan Sinkronisasi Google

### 4.1 Log Eksekusi Job (`daily_execution_logs`)
Setiap pengiriman proaktif (Morning Brief, Work Hours Reminder, End of Day Evaluation) dicatat dalam tabel `daily_execution_logs`.

Status job:
- `CLAIMED`: Job telah dikunci oleh scheduler dan sedang diproses.
- `SENT`: Pesan WhatsApp berhasil dikirim ke antrean WAHA.
- `FAILED`: Pengiriman gagal. Scheduler mencoba ulang hingga maksimal 3 kali. Setelah 3 kali gagal, status job tetap `FAILED` dan tidak dicoba lagi hari itu.
- `SKIPPED`: Job sengaja dilewati karena kondisi bisnis (misalnya bukan hari kerja, hari libur nasional, atau tidak ada tugas aktif).

### 4.2 Retry Sinkronisasi Google
Dashboard secara otomatis mencoba ulang sinkronisasi to-do yang berstatus `PENDING` atau `FAILED` setiap siklus tick (15 menit):
- Mekanisme: Backoff eksponensial (1m, 2m, 4m, 8m, 16m, 32m, hingga maksimal jeda 60m).
- Batas percobaan: Maksimal 8 kali per to-do.
- Tugas yang mencapai 8 kali percobaan gagal akan ditandai pada halaman `/status` sebagai **MACET** dan membutuhkan pengecekan kuota Google API atau koneksi akun.

---

## 5. Backup dan Pemulihan Bencana (Disaster Recovery)

### 5.1 Skrip Backup Otomatis
Jalankan skrip backup kapan saja secara manual:

```bash
./scripts/backup.sh
```

Skrip ini melakukan:
1. Dump database PostgreSQL dengan format kompresi biner (`pg_dump -Fc`) ke file sementara, lalu memindahkannya ke `backups/botseri-YYYYMMDD-HHMMSS.dump` setelah validasi `pg_restore --list`.
2. Backup arsip file sesi WAHA dari volume `botseri_wahadata` ke `backups/waha-YYYYMMDD-HHMMSS.tar.gz`.
3. Rotasi retensi: secara otomatis mempertahankan 7 salinan dump database dan 7 salinan arsip WAHA terbaru.
4. Memberikan izin berkas ketat (`chmod 600` untuk berkas backup, `chmod 700` untuk folder `backups/`).

### 5.2 Peringatan Kritis: Kunci Enkripsi (`.env`)
Dump database berisi data rahasia yang terenkripsi menggunakan AES-256-GCM (kunci API LLM, token OAuth Google, rahasia klien).

> **PENTING:** Tanpa nilai `ENCRYPTION_KEY` yang tersimpan di file `.env`, data hasil restore database tidak dapat didekripsi dan tidak dapat digunakan.
> File `.env` **TIDAK** disertakan dalam backup otomatis agar rahasia tidak tersimpan polos. Pemilik sistem **WAJIB** menyimpan salinan file `.env` di brankas password terpisah (misalnya Bitwarden, 1Password, atau brankas offline terenkripsi).

### 5.3 Prosedur Pemulihan (Restore)
Untuk memulihkan database dari file dump:

```bash
./scripts/restore.sh backups/botseri-YYYYMMDD-HHMMSS.dump
```

Alur kerja skrip restore:
1. Memvalidasi bahwa file dump ada dan dapat dibaca oleh `pg_restore`.
2. Meminta konfirmasi teks interaktif (ketik `restore`) untuk mencegah eksekusi tidak sengaja. Untuk eksekusi otomatis atau drill, gunakan flag `--yes`.
3. Membuat **dump pengaman otomatis** (`backups/pre-restore-YYYYMMDD-HHMMSS.dump`) dari kondisi database saat ini sebelum menimpa. Jika dump pengaman gagal, proses restore langsung dibatalkan.
4. Menghentikan sementara container `botseri-dashboard` dan `botseri-n8n`.
5. Menjalankan `pg_restore --clean --if-exists --no-owner`.
6. Menyalakan kembali container dan menunggu status sehat.

### 5.4 Jadwal Drill Rutin
Lakukan drill restore minimal satu kali setiap kuartal (3 bulan) untuk memastikan integritas file backup dan kesiapan operasional:
1. Catat jumlah baris tabel to-do dan konfigurasi.
2. Jalankan `./scripts/backup.sh`.
3. Tambahkan satu to-do penanda uji di dashboard.
4. Jalankan `./scripts/restore.sh --yes <dump-terbaru>`.
5. Pastikan to-do penanda uji hilang, data kembali ke kondisi sebelum backup, dan kredensial terenkripsi tetap dapat dibaca di halaman `/status`.

---

## 6. Prosedur Rotasi Kunci Enkripsi

Jika kunci enkripsi (`ENCRYPTION_KEY`) perlu dirotasi (misalnya karena pergantian pengelola atau audit keamanan):

1. Buat kunci enkripsi 32-byte acak baru:
   ```bash
   openssl rand -base64 32
   ```
2. Buka file `.env`, ubah isinya:
   - Pindahkan nilai `ENCRYPTION_KEY` lama ke variabel `ENCRYPTION_KEY_PREVIOUS`.
   - Masukkan kunci acak baru ke variabel `ENCRYPTION_KEY`.
3. Jalankan skrip rotasi enkripsi:
   ```bash
   docker compose exec -T botseri-dashboard npx tsx scripts/rotate-encryption.ts
   ```
   Atau jika dijalankan dari lingkungan pengembangan host lokal:
   ```bash
   cd dashboard && npx tsx scripts/rotate-encryption.ts
   ```
4. Restart layanan dashboard dan n8n:
   ```bash
   docker compose restart botseri-dashboard botseri-n8n
   ```
5. Verifikasi di browser: buka `/status`, pastikan konfigurasi LLM dan status Google terbaca normal.
6. Hapus variabel `ENCRYPTION_KEY_PREVIOUS` dari file `.env`.

---

## 7. Retensi dan Pembersihan Data

Untuk mencegah pembengkakan ukuran database di penyimpanan lokal host, lakukan pembersihan berkala untuk tabel log historis.

> **Aturan:** Selalu jalankan `./scripts/backup.sh` sebelum menjalankan query penghapusan data. Lakukan di dalam transaksi SQL eksplisit.

### 7.1 Pembersihan `message_log` (> 90 hari)
```sql
-- 1. Hitung jumlah baris yang akan dihapus
SELECT count(*) FROM message_log WHERE created_at < now() - interval '90 days';

-- 2. Jalankan penghapusan di dalam transaksi
BEGIN;
DELETE FROM message_log WHERE created_at < now() - interval '90 days';
-- Periksa jumlah baris yang terhapus, pastikan sesuai dengan hitungan di langkah 1
COMMIT;
```

### 7.2 Pembersihan `system_events` (> 180 hari)
```sql
-- 1. Hitung jumlah baris yang akan dihapus
SELECT count(*) FROM system_events WHERE ts < now() - interval '180 days';

-- 2. Jalankan penghapusan di dalam transaksi
BEGIN;
DELETE FROM system_events WHERE ts < now() - interval '180 days';
COMMIT;
```

---

## 8. Proteksi Cloudflare Tunnel dan Keamanan Jaringan

### 8.1 Aturan Ingress Tunnel
Dashboard Botseri diekspos melalui Cloudflare Tunnel untuk akses browser admin di luar rumah. Namun, rute internal (`/api/internal/*`) hanya boleh diakses oleh container lokal (`botseri-n8n`).

Konfigurasi ingress pada dashboard Cloudflare Zero Trust atau file konfigurasi tunnel **WAJIB** memblokir rute internal:

```yaml
ingress:
  # Blokir rute internal dari publik
  - hostname: panel.domainanda.com
    path: /api/internal/.*
    service: http_status:404
  # Rute normal diteruskan ke dashboard
  - hostname: panel.domainanda.com
    service: http://botseri-dashboard:3000
  - service: http_status:404
```

### 8.2 Pertahanan Berlapis (Defense-in-Depth)
Sistem memiliki dua lapis pertahanan untuk mematuhi invarian `INV-08`:
1. **Lapis 1 (Aplikasi):** Middleware Next.js (`dashboard/src/middleware.ts`) secara otomatis menolak dan mengembalikan HTTP 404 jika ada request ke `/api/internal/*` yang memuat header Cloudflare (`cf-connecting-ip` atau `cf-ray`), meskipun membawa token sah.
2. **Lapis 2 (Jaringan):** Aturan ingress Cloudflare Tunnel memutus request sebelum mencapai container dashboard.

Uji pertahanan lapis 1 secara lokal:
```bash
curl -i -H "cf-connecting-ip: 1.2.3.4" http://127.0.0.1:3000/api/internal/health
# Harus mengembalikan HTTP/1.1 404 Not Found
```

Pengujian akses melalui domain publik Cloudflare berstatus `〔PERLU VERIFIKASI MANUAL〕` bila domain belum didelegasikan secara aktif.

---

## 9. Tabel Troubleshooting Cepat

| Gejala | Kemungkinan Penyebab | Tindakan Perbaikan |
|---|---|---|
| Banner amber detak scheduler di `/status` | Container `botseri-n8n` mati atau jadwal cron n8n macet | Cek log n8n (`docker compose logs botseri-n8n`), restart n8n dengan `docker compose restart botseri-n8n`. |
| Status WAHA `SCAN_QR_CODE` | Sesi WhatsApp terputus atau ponsel bot logout | Buka `/integrations`, klik Mulai Sesi, lalu scan kode QR baru. |
| Status WAHA `FAILED` / `STOPPED` | Mesin browser WAHA crash | Jalankan `docker compose restart botseri-waha`, lalu periksa kembali status di `/integrations`. |
| Status Google `NEEDS_REAUTH` | Token kedaluwarsa (terutama pada app mode Testing) | Klik Hubungkan Ulang di menu `/integrations` dan selesaikan login Google. |
| Job scheduler berstatus `FAILED` 3 kali berturut-turut | Timeout panggilan LLM Gateway atau WAHA tidak merespons | Cek log dashboard dan WAHA; pastikan nomor tujuan terdaftar di WhatsApp. |
| Sinkronisasi Google macet (percobaan >= 8) | Error validasi kalender atau kuota API Google habis | Buka `/status` dan `/logs` untuk membaca pesan error; pastikan Calendar ID dan Tasklist ID valid. |
| Error HTTP 503 Service Unavailable pada dashboard | Container database PostgreSQL belum sehat atau gagal start | Periksa log `docker compose logs botseri-db` dan status koneksi port 5432. |
| Token setup tidak dapat dipakai / login gagal | Akun admin sudah dibuat atau cookie sesi kedaluwarsa | Jika lupa password admin, reset database dari backup atau buat user baru via Prisma CLI. |

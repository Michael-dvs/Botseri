# Checklist Penutupan Operasional Step 07 (Milestone M4 & M5)

> Dokumen ini disusun sebagai panduan verifikasi manual lapangan untuk dieksekusi langsung oleh pemilik proyek (Owner) sebelum menandai Step 07 dan Milestone M4/M5 sebagai selesai di `00-MASTER-ROADMAP.md`.
> Seluruh kotak centang di bawah ini sengaja dibiarkan kosong `[ ]` dan ditandai `〔PERLU VERIFIKASI MANUAL〕`.

---

## 1. Verifikasi Detak Manual Scheduler n8n
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Trigger Manual Workflow Scheduler n8n:**
  - Buka antarmuka n8n atau jalankan eksekusi manual workflow scheduler.
  - Periksa apakah webhook memanggil endpoint `POST /api/internal/scheduler/tick` dan menerima HTTP 200 dengan payload `{"now_local": "...", "jobs": [...]}`.
  - Pastikan event `TICK_OK` tercatat pada tabel `system_events`.

## 2. Pengujian Morning Brief Terjadwal Nyata
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Pengiriman Morning Brief ke WhatsApp Owner:**
  - Pastikan waktu lokal mencapai `early_brief_time` (default 06:00 atau jam yang dikonfigurasi).
  - Verifikasi pesan Morning Brief masuk ke chat WhatsApp owner dengan format:
    - Pantun pembuka 4 baris bertema usaha florist/dekorasi.
    - Bagian "3 Fokus Utama Pagi Ini".
    - Bagian "Daftar Tugas Selanjutnya".
  - Verifikasi baris tercatat di `daily_execution_logs` dengan `job_type = 'MORNING_BRIEF'` dan `status = 'SENT'`.

## 3. Verifikasi Rollover Tugas End-of-Day (EOD)
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Evaluasi Akhir Hari & Rollover Tugas:**
  - Buat to-do uji dengan `planned_date = current_date` yang belum diselesaikan (`PENDING`).
  - Tunggu waktu EOD tiba atau picu tick pada jendela EOD.
  - Jalankan kueri SQL pembuktian di database:
    ```sql
    SELECT id, title, planned_date, rollover_count, status
    FROM todos
    WHERE status = 'PENDING'
    ORDER BY updated_at DESC
    LIMIT 5;
    ```
  - Pastikan `planned_date` telah bergeser ke hari kerja aktif berikutnya dan `rollover_count` bertambah 1.
  - Verifikasi ringkasan evaluasi harian tercatat di `daily_stats`.

## 4. Simulasi Penanganan Saat WAHA Tidak WORKING
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Deteksi & Degradasi Anggun saat WAHA Offline:**
  - Hentikan container WAHA sementara: `docker compose stop botseri-waha`.
  - Jalankan tick scheduler: periksa halaman `/status`. Status WAHA harus berubah menjadi `UNREACHABLE` atau `STOPPED`.
  - Scheduler tidak boleh crash; job yang gagal mengirim pesan WhatsApp harus ditandai `FAILED` secara anggun tanpa menghentikan siklus tick lainnya.
  - Nyalakan kembali container WAHA: `docker compose start botseri-waha` dan pastikan status kembali pulih (`WORKING`).

## 5. Verifikasi Pemulihan Klaim Basi Scheduler
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Auto-Recovery Stale Job Claims:**
  - Simulasikan job macet dengan mengubah status job di database:
    ```sql
    UPDATE daily_execution_logs
    SET status = 'CLAIMED', claimed_at = now() - interval '10 minutes'
    WHERE local_date = current_date;
    ```
  - Jalankan siklus `tick()` berikutnya.
  - Verifikasi bahwa scheduler memulihkan job yang macet (`RECOVERED_STALE_JOB`) dan mencoba eksekusi ulang hingga batas maksimal 3 kali.

## 6. Simulasi Kegagalan Integrasi Google Calendar / Tasks
- [ ] `〔PERLU VERIFIKASI MANUAL〕` **Ketahanan Eksekusi saat Google OAuth Terputus:**
  - Simulasikan token OAuth tidak valid atau putuskan koneksi internet ke Google API.
  - Buat tugas baru via chat WhatsApp atau dashboard.
  - Tugas lokal WAJIB tetap tersimpan di database dengan `google_sync_status = 'PENDING'` atau `'FAILED'`.
  - Verifikasi scheduler mencoba ulang sinkronisasi otomatis setiap 5 menit dengan backoff eksponensial tanpa memblokir tugas operasional harian.

---

> **Langkah Selanjutnya Pasca-Verifikasi:**
> Setelah seluruh 6 butir di atas terbukti lulus di lingkungan pengujian nyata pemilik proyek, pemilik proyek dapat mencentang checklist di atas dan membuka kunci Step 07 pada berkas `docs/steps/00-MASTER-ROADMAP.md`.

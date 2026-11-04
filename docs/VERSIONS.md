# VERSIONS.md — Versi Ter-Pin & Resolusi Tag `[VERIFY]`

> **Status:** Kanonik · **Arsitektur Rujukan:** `ARCHITECTURE.md` §4, §9, §13, §21, §22
> **Aturan:** Versi `latest` DILARANG KERAS untuk rilis produksi (INV-12, §22.3). Semua komponen eksternal di-pin secara eksplisit.

---

## 1. Pin Versi Gambar Docker

| Layanan | Docker Image | Versi Ter-Pin | Sumber & Catatan Rilis |
|---|---|---|---|
| `botseri-db` | `postgres:16-alpine` | `16-alpine` | PostgreSQL 16 LTS Alpine Linux |
| `botseri-dashboard` | Base image: `node:20-alpine` | `20-alpine` (Node LTS) | Next.js 14+ (App Router), Prisma v5+ |
| `botseri-n8n` | `n8nio/n8n` | `1.64.1` | Rilis stabil n8n 1.x (Node 20 based) |
| `botseri-waha` | `devlikeapro/waha` | `latest-2026.9.2` (amd64) | WAHA Core Community Edition; tag rilis eksplisit (bukan floating `latest`), image hanya `linux/amd64` |
| `botseri-tunnel` | `cloudflare/cloudflared` | `2024.10.1` | Official Cloudflare Tunnel binary |

---

## 2. Lingkungan Host & Infrastruktur

- **Sistem Operasi Host:** Windows 10 Pro / Enterprise dengan **WSL2** (Kernel Linux 5.15+ / 6.x).
- **Filesystem Persistent Volumes:** Wajib di partisi Linux WSL2 murni (`ext4`, contoh: `/home/<user>/...`), **DILARANG** di-mount dari partisi Windows (`/mnt/c/`) demi integritas I/O PostgreSQL SQLite n8n.
- **Docker Engine:** Docker Desktop WSL2 backend atau Docker Engine langsung di dalam distro WSL2 (dengan `systemd = true` di `/etc/wsl.conf`).

---

## 3. Matriks Pelacakan Tag `[VERIFY]`

| Bagian | Item yang Diverifikasi | Hasil Verifikasi Teknis | Status |
|---|---|---|---|
| **§4.3 / §9.1** | `N8N_DISABLE_UI: "true"` | Parameter ini valid pada n8n 1.x untuk menonaktifkan endpoint frontend `/` dan `/workflow/*`. Webhook `/webhook/*` dan internal API tetap beroperasi normal. | `[VERIFIED]` |
| **§9.1** | Sintaks CLI n8n untuk Impor Workflow | `n8n import:workflow --separate --input=/workflows/` valid pada 1.64.1. Setiap berkas `*.json` MUST berisi **satu objek workflow**, bukan array; array menyebabkan `Cannot read properties of undefined (reading 'forEach')`. | `[VERIFIED]` |
| **§9.1** | Sintaks CLI n8n untuk Aktivasi | `n8n update:workflow --all --active=true` berjalan pada 1.64.1; workflow terimpor muncul di `n8n list:workflow --active=true`. | `[VERIFIED]` |
| **§9.1** | Sintaks CLI n8n untuk Kredensial | `n8n import:credentials --input=<file>.json` menerima array kredensial dan berhasil mengimpor `httpHeaderAuth` pada 1.64.1. | `[VERIFIED]` |
| **§4.3 / §13.1** | Variabel Environment WAHA | `WAHA_API_KEY`, `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS=message`, `WHATSAPP_START_SESSION=default`, `WAHA_DASHBOARD_ENABLED=false`, `WHATSAPP_SWAGGER_ENABLED=false` diuji pada `latest-2026.9.2`: API tanpa key → `401`, dengan key → `200`; dashboard/swagger → `404`; webhook terdaftar ke n8n. | `[VERIFIED]` |
| **§13.5** | Format Identitas Pengirim WhatsApp | Format pesan pribadi pengirim reguler adalah `<nomor>@c.us`. Format `@lid` dapat muncul pada multi-device; mekanisme pairing berbasis kode unik `PAIR-XXXXXX` menjamin `chat_id` yang tersimpan adalah format pengirim aktual. | `[VERIFIED]` |
| **§13.3** | Dukungan Audio Voice Note | Download media audio via endpoint `/api/files/...` memerlukan autentikasi API Key WAHA. Pada versi komunitas tanpa downloader media instan, penanganan fallback "belum didukung" aktif (§8.3). | `[VERIFIED]` |

---

## 4. Keputusan Sementara atas Pertanyaan Terbuka (`[OPEN]`)

Sesuai dengan `ARCHITECTURE.md` Bagian 21.2:

| ID | Pertanyaan Terbuka | Keputusan Default v1 (Kanonik) |
|---|---|---|
| **OQ-01** | Eskalasi prioritas otomatis saat tenggat mendekat (Rank 2 menjadi Rank 1) | **DITIADAKAN.** Prioritas tetap sesuai penetapan awal atau diubah manual oleh pengguna. |
| **OQ-02** | Batas kuota biaya LLM harian | **PENCATATAN SAJA.** Log token dan estimasi biaya dicatat di `llm_usage_logs` tanpa pemutusan otomatis. |
| **OQ-03** | Retensi data tabel `message_log` | **90 HARI.** Pembersihan otomatis dijalankan berkala atau saat cleanup data. |
| **OQ-04** | Job proaktif pada hari libur / non-kerja | **DILEWATI.** Morning Brief, Reminder, dan EOD Eval tidak dikirim pada hari non-kerja; pesan chat masuk tetap dilayani. |
| **OQ-05** | Engine WAHA yang dipakai | Default: Engine ringan berbasis web session standar. |
| **OQ-06** | Nama Tool Kanonik | Menggunakan `tool_create_todo_and_order` (menggantikan nama lama `save_todo_and_sync_google`). |

# Botseri

Asisten operasional cerdas untuk pemilik usaha kecil berbasis WhatsApp dengan arsitektur headless n8n, Next.js dashboard, dan PostgreSQL.

---

## 1. Tentang Botseri

Botseri membantu pemilik usaha mengelola pesanan, tugas operasional, dan jadwal harian secara otomatis melalui WhatsApp. Pemilik cukup mengirim pesan teks atau catatan suara (voice note). Sistem memproses bahasa alami menjadi to-do terstruktur berprioritas, menyinkronkannya ke Google Calendar dan Google Tasks, serta mengirimkan ringkasan pagi, pengingat jam kerja, dan evaluasi harian secara proaktif.

### Prinsip Utama
- **Zero-Touch Headless n8n:** n8n berfungsi murni sebagai mesin eksekusi orkestrasi di latar belakang tanpa akses langsung ke database atau secret.
- **PostgreSQL sebagai Sumber Kebenaran Tunggal (SSOT):** Seluruh state, konfigurasi, Priority Stack, dan data transaksi hanya dikelola oleh dashboard Next.js melalui Prisma ORM.
- **Otak Deterministik, Mulut Generatif:** Kode menentukan apa yang terjadi dan kapan (jadwal, kuota, tier evaluasi). LLM hanya bertugas memahami bahasa alami dan menyusun pesan balasan santun.

---

## 2. Arsitektur Sistem

Sistem berjalan dalam jaringan Docker internal (`botseri-net`) yang terdiri dari empat container inti dan satu container tunnel opsional:

```
[ WhatsApp Owner ] <---> [ botseri-waha (WhatsApp HTTP API :3000) ]
                                 |
                                 v (webhook pesan masuk)
                         [ botseri-n8n (Orkestrator Headless :5678) ]
                                 |
                                 v (HTTP Internal API + Bearer Token)
[ Browser Admin  ] ----> [ botseri-dashboard (Next.js App Router :3000) ]
                                 |
                                 +---> [ botseri-db (PostgreSQL 16 :5432) ]
                                 +---> [ Google Calendar & Tasks API ]
                                 +---> [ Provider LLM Gateway ]
```

| Container | Fungsi | Keterangan |
|---|---|---|
| `botseri-db` | Penyimpanan data aplikasi | PostgreSQL 16 Alpine, volume persisten `botseri_pgdata` |
| `botseri-dashboard` | Logika bisnis, UI admin, LLM Gateway, Google Sync | Next.js 14 App Router, Prisma ORM, port 3000 |
| `botseri-waha` | Sesi WhatsApp dan penanganan pesan | WAHA NOWEB engine, volume persisten `botseri_wahadata` |
| `botseri-n8n` | Mesin workflow pesan masuk dan scheduler 15 menit | n8n Headless, workflow JSON statis |
| `botseri-tunnel` | Ekspos aman panel admin ke internet via Cloudflare | Cloudflared tunnel (profil opsional) |

---

## 3. Prasyarat Sistem

- **Sistem Operasi:** Windows 10/11 dengan WSL2 (Ubuntu 22.04/24.04 LTS direkomendasikan) atau server Linux standar.
- **Docker Engine & Docker Compose:** Docker Engine v24+ dan Compose v2+.
- **Node.js (Opsional untuk pengembangan lokal):** Node.js 20 LTS.
- **Alat Pendukung:** `bash`, `curl`, `jq`, `openssl`.

---

## 4. Panduan Instalasi dan Menjalankan

### Langkah 1: Klon Repositori
```bash
git clone <url-repositori-anda>
cd botseri
```

### Langkah 2: Buat Berkas Konfigurasi Lingkungan (`.env`)
Gunakan generator rahasia otomatis yang sudah disediakan:

```bash
bash scripts/gen-secrets.sh > .env
```

Periksa berkas `.env` dan sesuaikan variabel opsional bila diperlukan (seperti zona waktu `TZ_DEFAULT` atau domain publik `PUBLIC_BASE_URL`).

### Langkah 3: Build dan Jalankan Container
```bash
docker compose build
docker compose up -d
```

Pastikan seluruh layanan aktif dan sehat:
```bash
docker compose ps
```

### Lokasi Repositori yang Disarankan
Repositori produksi **dilarang keras** diletakkan di dalam folder sinkronisasi cloud seperti Google Drive, OneDrive, iCloud, atau Dropbox karena:
1. **Kebocoran Rahasia:** Klien cloud otomatis mengunggah berkas `.env` (yang memuat `ENCRYPTION_KEY`) dan direktori `backups/` ke penyimpanan cloud pihak ketiga.
2. **Kerusakan Indeks Git & Lock File:** Sinkronisasi file cloud dapat mengunci berkas indeks `.git`, merusak basis data internal Git, atau menimbulkan konflik sinkronisasi pada file database sementara.

Panduan Penataan Lokasi:
- Pindahkan repositori ke direktori lokal murni (misal: `/home/<user>/projects/botseri` di Linux/WSL2 atau `C:\projects\botseri` di Windows).
- Jika terpaksa berada di komputer dengan klien cloud aktif, kecualikan berkas `.env`, direktori `backups/`, `.git/`, dan `node_modules/` dari sinkronisasi otomatis.
- Aktifkan pemindai rahasia pre-commit otomatis dengan perintah:
  ```bash
  git config core.hooksPath .githooks
  ```
---

## 5. Alur Pengaturan Awal (First-Time Setup)

1. **Akses Panel Setup:** Buka browser dan arahkan ke `http://localhost:3000/setup`.
2. **Buat Akun Administrator:** Masukkan username dan password aman untuk akun pemilik toko.
3. **Konfigurasi Bisnis:** Masukkan nama usaha, jam operasional, dan hari kerja di menu **Pengaturan**.
4. **Hubungkan WhatsApp (WAHA):** Buka menu **Integrasi**, klik **Mulai Sesi**, lalu pindai kode QR yang muncul dengan nomor WhatsApp bot operasional Anda.
5. **Konfigurasi Model Bahasa (LLM):** Di menu **Integrasi**, masukkan kredensial API key untuk provider pilihan (Gemini, OpenAI, Anthropic, Groq, atau OpenRouter). Kunci disimpan dengan enkripsi AES-256-GCM.
6. **Hubungkan Google Workspace (Opsional):** Di menu **Integrasi**, hubungkan Google Calendar dan Google Tasks untuk sinkronisasi otomatis agenda.

---

## 6. Skrip Operasional dan Pemeliharaan

Seluruh skrip berada di folder `scripts/` dan dapat dijalankan langsung:

| Skrip | Deskripsi | Penggunaan |
|---|---|---|
| `scripts/backup.sh` | Backup database PostgreSQL (`.dump`) dan arsip sesi WAHA (`.tar.gz`) dengan retensi 7 salinan | `./scripts/backup.sh` |
| `scripts/restore.sh` | Pemulihan database dengan pembuatan dump pengaman otomatis (`pre-restore-*`) | `./scripts/restore.sh [--yes] <path-dump>` |
| `scripts/smoke.sh` | Uji asap non-destruktif untuk memvalidasi kesehatan rute internal, auth, dan invarian | `./scripts/smoke.sh` |
| `scripts/validate-workflows.sh` | Validasi kepatuhan workflow n8n terhadap invarian INV-01 dan INV-02 | `./scripts/validate-workflows.sh` |
| `scripts/gen-secrets.sh` | Generator rahasia kriptografi untuk inisialisasi `.env` | `bash scripts/gen-secrets.sh > .env` |

---

## 7. Rujukan Dokumentasi

- [`AGENTS.md`](./AGENTS.md): Prinsip rekayasa, standar kualitas kode, dan aturan Zero-Slop.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): Dokumen arsitektur kanonik, batas kepercayaan, dan invarian sistem.
- [`docs/RUNBOOK.md`](./docs/RUNBOOK.md): Panduan operasional harian, disaster recovery, rotasi kunci, dan penanganan insiden.
- [`docs/steps/00-MASTER-ROADMAP.md`](./docs/steps/00-MASTER-ROADMAP.md): Peta jalan implementasi proyek dari Step 01 hingga Step 08.

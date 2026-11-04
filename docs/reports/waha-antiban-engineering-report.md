# Laporan Rekayasa Sistem: WAHA Anti-Ban Guard & Invarian INV-13

> **Tanggal:** 21 Oktober 2026
> **Penulis:** Principal Systems Architect & Senior Backend Reliability Engineer
> **Status:** Selesai & Terverifikasi 100%
> **Rujukan Invarian:** `INV-13` (Zero Direct WAHA Outbound & Mandatory Humanized Rate-Limiting), `INV-01`, `INV-07`, `INV-08`, `INV-09`

---

## 1. Latar Belakang & Pernyataan Masalah

Penggunaan otomasi WhatsApp tidak resmi (seperti WAHA) rentan terkena pembatasan atau pemblokiran akun (*"Your account is restricted right now. Recent activity on your account may be a sign of spam, automated or bulk messaging"*) apabila:
1. Pesan dibalas secara instan ($0\text{ ms}$) tanpa jeda baca dan jeda ketik manusiawi.
2. Bot mengirim beberapa pesan bertubi-tubi dalam waktu sangat singkat (*burst messages*).
3. Terjadi *infinite loop* (bot membalas pesan dirinya sendiri atau looping pesan di grup).
4. Bot mengirim pesan ke sembarang nomor asing atau broadcast.

Untuk melindungi nomor WhatsApp operasional UMKM secara permanen di tingkat arsitektur, ditetapkan **Invarian Baru: `INV-13 — Zero Direct WAHA Outbound & Mandatory Humanized Rate-Limiting`**.

---

## 2. Arsitektur Invarian INV-13

```
+-----------------------------------------------------------------------------------+
|                                     INV-13                                        |
|                                                                                   |
|  [ botseri-n8n ] (Step 06 Inbound & Step 07 Scheduler)                            |
|        |                                                                          |
|        | (DILARANG KERAS menembak WAHA secara langsung!)                         |
|        v                                                                          |
|  POST /api/internal/waha/send (Header: Bearer INTERNAL_API_TOKEN)                 |
|        |                                                                          |
|        +---> 1. Verifikasi Nomor: Hanya ke authorized_numbers (Kecuali Pairing)   |
|        +---> 2. Anti-Double Send: Deduplikasi isi identik dalam 45 detik          |
|        +---> 3. Single-Flight Serial Queue (Antrean Eksekusi Mutex)               |
|        +---> 4. Sliding-Window Rate Limiter (Maks 4 msg/60s & 25 msg/60m)         |
|        +---> 5. Circuit Breaker (Auto-cooldown 30 menit jika 3x gagal/terindikasi)|
|        +---> 6. Human Presence Simulation:                                        |
|        |        a. Jeda baca pesan (800 - 1.800 ms) -> sendSeen() (Centang Biru) |
|        |        b. Munculkan status ketik -> startTyping()                        |
|        |        c. Durasi ketik terhitung: clamp(len * 35-60ms, 1.500, 7.500 ms)  |
|        |        d. Hentikan status ketik -> stopTyping()                          |
|        |        e. Jeda acak (200 - 400 ms)                                       |
|        v                                                                          |
|  POST /api/sendText (Low-Level Driver ke botseri-waha:3000)                       |
|        |                                                                          |
|        v                                                                          |
|  Catat ke message_log (OUTBOUND, SENT)                                            |
+-----------------------------------------------------------------------------------+
```

---

## 3. Rincian Implementasi Modul

### 3.1 Primitif Kehadiran Manusia (`dashboard/src/lib/waha/client.ts`)
- `sendSeen(chatId, messageId)`: Mengirim sinyal centang biru (`POST /api/sendSeen`). Kegagalan ditangkap secara aman agar tidak memutus eksekusi.
- `startTyping(chatId)`: Memunculkan status *"sedang mengetik..."* di WhatsApp penerima (`POST /api/startTyping`).
- `stopTyping(chatId)`: Menghentikan status ketik (`POST /api/stopTyping`).
- `sendTextDirect(chatId, text, replyTo)`: Driver level rendah yang menembak `POST /api/sendText`. Hanya dipanggil oleh `humanizer.ts`.

### 3.2 Mesin Anti-Ban & Antrean Serial (`dashboard/src/lib/waha/humanizer.ts`)
- **Single-Flight Serial Queue**: Menggunakan antrean *Promise chaining* di memori sehingga tidak ada dua pengiriman pesan yang dieksekusi bersamaan.
- **Minimum Inter-Message Spacing**: Menghitung jeda sejak pesan terakhir (`lastSentAt`). Jika waktu berlalu $< 6.000\text{ ms}$, sistem otomatis menahan eksekusi (`sleep`) hingga $6.000\text{ ms} + \text{random}(0, 2.500)\text{ ms}$ terpenuhi.
- **Sliding-Window Rate Limiter**:
  - Jendela 1 Menit: Maksimal 4 pesan.
  - Jendela 1 Jam: Maksimal 25 pesan.
  - Pelanggaran ditolak dengan `HTTP 429` dan dicatat ke `system_events` (`code: 'WAHA_RATE_LIMIT_BLOCKED'`).
- **Validasi Penerima Ketat**:
  - Dilarang keras mengirim pesan ke grup (`@g.us`), newsletter (`@newsletter`), atau broadcast (`status@broadcast`).
  - Dilarang mengirim ke nomor yang belum terdaftar di `authorized_numbers` (kecuali pesan konfirmasi pairing).
- **Circuit Breaker**:
  - Mencatat kegagalan beruntun (`consecutiveFailures`). Jika $\ge 3$ kali gagal atau terdeteksi kata kunci pembatasan (*restricted, banned, spam*), sistem mengaktifkan status *Open Circuit* selama 30 menit. Seluruh panggilan berikutnya langsung ditolak dengan `HTTP 503` tanpa menembak WAHA.
- **Simulasi Ketik Manusia (`sendHumanizedMessage`)**:
  - Rumus durasi ketik: $\text{typingMs} = \text{clamp}(\text{text.length} \times (35 + \text{rand} \times 25), 1500, 7500)$. Teks pendek mendapat jeda minimal $1,5\text{ detik}$, dan teks panjang dibatasi maksimal $7,5\text{ detik}$.
- **Fast-Test Bypass**: Variabel `WAHA_FAST_TEST=1` atau opsi `skipDelay: true` melewati jeda waktu tanpa mematikan logika rate-limiter, circuit breaker, antrean, dan validasi penerima.

### 3.3 Endpoint Pengiriman Terpusat (`dashboard/src/app/api/internal/waha/send/route.ts`)
- Menerima `chat_id` / `phone_e164`, `body`, `trigger_type`, dan referensi pesan masuk.
- **Deduplikasi Outbound 45 Detik**: Memeriksa `message_log` apakah ada pesan `OUTBOUND` dengan isi teks identik ke nomor yang sama dalam 45 detik terakhir. Jika ditemukan, pesan diskip secara aman (`skipped: true, reason: 'DUPLICATE_OUTBOUND_SUPPRESSED'`).
- Meneruskan pesan ke `sendHumanizedMessage()`, lalu mencatat ke `message_log`.

### 3.4 Pertahanan Loop Pesan Masuk (`dashboard/src/app/api/internal/inbound/accept/route.ts`)
- **Self-Message Reject**: Menolak pesan masuk jika `from_me === true` atau `fromMe === true` (`reason: 'FROM_ME_IGNORED'`).
- **Non-Personal Chat Reject**: Menolak pesan dari grup (`@g.us`), channel (`@newsletter`), dan broadcast (`reason: 'NON_PERSONAL_CHAT_IGNORED'`).
- **Inbound Rapid-Fire Cooldown**: Menolak pesan masuk jika pesan sebelumnya dari nomor yang sama baru diterima $< 2\text{ detik}$ yang lalu, atau jika dalam 1 menit sudah ada $\ge 6$ pesan masuk dari nomor tersebut (`reason: 'INBOUND_COOLDOWN'`).

### 3.5 Aturan Single-Bubble pada Prompt (`dashboard/src/lib/prompt/templates/base.id.md`)
Menambahkan aturan normatif pada `# PAGAR PENGAMAN`:
> *"6. Gabungkan seluruh jawaban dalam SATU pesan WhatsApp yang terstruktur dan ringkas (maksimal 1.200 karakter). Dilarang memecah respons menjadi beberapa pesan terpisah."*

### 3.6 Indikator Dashboard UI (`dashboard/src/app/(app)/integrations/IntegrationsPanel.tsx`)
Menampilkan badge status aktif di kartu WhatsApp:
- `Anti-Ban Guard (INV-13): Aktif`

---

## 4. Log Hasil Verifikasi & Uji Otomatis

### 4.1 Unit Test Suite (`npm test`)
```text
✓ tests/unit/crypto.test.ts (3 tests)
✓ tests/unit/google-targets.test.ts (5 tests)
✓ tests/unit/pairing.test.ts (2 tests)
✓ tests/unit/waha-humanizer.test.ts (7 tests)
  - clamps short text to minimum 1,500ms
  - clamps long text to maximum 7,500ms
  - calculates realistic human typing duration
  - rejects non-personal chats (groups, broadcasts)
  - rejects unauthorized recipients unless isPairing
  - allows up to 4 messages within 1 minute, blocks 5th with 429
  - trips circuit breaker after 3 failures, blocks 4th with 503
✓ tests/unit/waha-send-route.test.ts (3 tests)
  - returns 401 if unauthorized
  - sends message and creates message_log record
  - suppresses duplicate outbound message within 45s
✓ tests/unit/prompt.test.ts (6 tests)
✓ tests/unit/time.test.ts (5 tests)

Test Files  7 passed (7)
Tests       31 passed (31)
```

### 4.2 Type Check & Production Build
- `npx tsc --noEmit`: Lulus 100% tanpa error TypeScript.
- `npm run build`: Berhasil mengompilasi seluruh rute aplikasi Next.js 14.2.
- `docker compose build botseri-dashboard && docker compose up -d`: Kontainer dashboard berhasil direfresh dan berstatus `Up (healthy)`.

### 4.3 Pengujian Endpoint Live Terhadap Serangan Loop & Burst
1. **Pesan Masuk dari Diri Sendiri (`from_me: true`)**:
   `POST /api/internal/inbound/accept` mengembalikan:
   `{"accept":false,"reason":"FROM_ME_IGNORED"}`
2. **Pesan Masuk dari Grup (`@g.us`)**:
   `POST /api/internal/inbound/accept` mengembalikan:
   `{"accept":false,"reason":"NON_PERSONAL_CHAT_IGNORED"}`
3. **Pesan Masuk Beruntun (< 2 detik)**:
   Pesan pertama diterima (`reason: "OK"`). Pesan kedua dalam 100ms langsung ditolak (`reason: "INBOUND_COOLDOWN"`).
4. **Deduplikasi Pesan Keluar Identik (< 45 detik)**:
   `POST /api/internal/waha/send` mengembalikan:
   `{"ok":true,"skipped":true,"reason":"DUPLICATE_OUTBOUND_SUPPRESSED"}` tanpa menembak driver WAHA.

---

## 5. Sinkronisasi Roadmap & Dokumen Lanjutan

1. **`docs/steps/00-MASTER-ROADMAP.md`**:
   Menambahkan `INV-13` ke dalam daftar Prinsip yang Mengikat Seluruh Step.
2. **`docs/steps/step-06-n8n-headless-engine-and-inbound-agent.md`**:
   Node n8n `Kirim Penolakan` dan `Kirim Balasan WA` diperbarui agar memanggil `POST http://botseri-dashboard:3000/api/internal/waha/send` dengan kredensial internal `botseriInternal`.
3. **`docs/steps/step-07-n8n-proactive-scheduler.md`**:
   Node n8n `Kirim Pesan WA` diperbarui agar memanggil `POST http://botseri-dashboard:3000/api/internal/waha/send`.

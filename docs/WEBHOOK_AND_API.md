# WEBHOOK_AND_API.md — Kontrak API & Integrasi Botseri

> **Status:** Kanonik · **Arsitektur Rujukan:** `ARCHITECTURE.md` §7, §8, §13, §14 · **Protokol:** HTTP/JSON
> **Keamanan Internal:** Header `Authorization: Bearer ${INTERNAL_API_TOKEN}` (Constant-Time String Comparison, INV-08)

---

## 1. Konvensi & Prinsip API

1. **Jalur Akses Internal:** Seluruh rute `/api/internal/*` hanya dapat dipanggil dari jaringan Docker `botseri-net` (oleh container `botseri-n8n`). Akses dari internet melalui Cloudflare Tunnel langsung ditolak (HTTP 404).
2. **Penanganan Error Domain vs Protokol:**
   - **Kesalahan Autentikasi / Cacat Format:** Mengembalikan status **HTTP 401** atau **HTTP 400**.
   - **Kesalahan Domain / Bisnis pada Tool:** Mengembalikan status **HTTP 200** dengan payload standar:
     ```json
     {
       "ok": false,
       "error": {
         "code": "AMBIGUOUS | NOT_FOUND | INVALID_RANK | FAILED",
         "message": "Deskripsi kesalahan dalam Bahasa Indonesia",
         "candidates": []
       }
     }
     ```
     Hal ini disyaratkan agar LLM pada AI Agent dapat membaca kegagalan dan meminta klarifikasi ke pengguna.
   - **Respons Berhasil:** Selalu diawali dengan field `"ok": true`.
3. **Format Waktu:** Menggunakan standar ISO 8601 dengan offset zona waktu lokal (contoh: `2026-10-19T16:20:00+07:00`).

---

## 2. Webhook Masuk WAHA (`POST /webhook/wa-incoming`)

Dikirimkan oleh `botseri-waha` ke `botseri-n8n:5678`.

### Payload Masuk
```json
{
  "event": "message",
  "session": "default",
  "payload": {
    "id": "false_6281234567890@c.us_3EB0ABC12345",
    "timestamp": 1792000000,
    "from": "6281234567890@c.us",
    "fromMe": false,
    "body": "besok jam 10 antar buket mawar ke Bu Ani Pondok Indah",
    "hasMedia": false,
    "media": null
  }
}
```

### Aturan Filter pada n8n
- Lanjut hanya jika:
  - `event == "message"`
  - `payload.fromMe == false`
  - `payload.from` tidak berakhiran `@g.us` (grup diabaikan)
  - `payload.from` bukan `status@broadcast`

---

## 3. Internal API (`/api/internal/*`)

### 3.1 `GET /api/internal/health`
Pengecekan kesiapan sistem sebelum n8n menjalankan provisioning workflow.
- **Header:** Tidak wajib autentikasi (pemeriksaan internal docker).
- **Respons (200 OK):**
  ```json
  {
    "status": "ok",
    "db": true,
    "version": "1.0.0"
  }
  ```

---

### 3.2 `POST /api/internal/inbound/accept`
Validasi nomor pengirim, penanganan alur pairing, deduplikasi pesan masuk, dan klasifikasi role pengirim (Owner vs Customer).
- **Header:** `Authorization: Bearer ${INTERNAL_API_TOKEN}`
- **Request Body:**
  ```json
  {
    "wa_message_id": "false_6281234567890@c.us_3EB0ABC12345",
    "chat_id": "6281234567890@c.us",
    "from": "6281234567890@c.us",
    "from_me": false,
    "body": "besok jam 10 antar buket mawar",
    "has_media": false,
    "media_type": null,
    "received_at": "2026-10-19T16:20:00+07:00"
  }
  ```
- **Respons (200 OK):**
  ```json
  {
    "accept": true,
    "role": "OWNER | CUSTOMER",
    "reason": "OK",
    "message_id": "b3e0c7a1-8d4e-4f2a-9e1b-3c4d5e6f7a8b",
    "customer_phone": "+6281234567890",
    "intent": "SUBMIT_ORDER | null",
    "chat_id": "6281234567890@c.us",
    "reply_to_chat_id": "6281234567890@c.us",
    "reply_text": null
  }
  ```
- **Status `reason` (jika `accept: false`):**
  - `OWNER_MANUAL_MESSAGE`: Pesan manual yang diketik owner di chat pelanggan via HP (bukan format pesanan).
  - `INVALID_PHONE`: Nomor telepon tidak valid format E.164.
  - `GROUP_IGNORED`: Pesan berasal dari grup WhatsApp (`@g.us`).
  - `DUPLICATE`: Pesan dengan `wa_message_id` yang sama sudah pernah diproses.
  - `RATE_LIMITED`: Melebihi batas kuota pesan inbound (> 20 pesan/menit per nomor).
  - `INBOUND_COOLDOWN`: Rapid-fire cooldown untuk nomor owner (< 2s atau ≥ 6/menit).
  - `SETUP_INCOMPLETE` / `BOT_DISABLED`: Bot belum selesai disetup atau sedang dimatikan.
  - `UNSUPPORTED_MEDIA`: Media non-audio dari owner.
  - `INVALID_PAIRING_CODE`: Kode pairing tidak valid atau kedaluwarsa.

---

### 3.2b `POST /api/internal/customer/handle`
Handler state machine percakapan inbound pelanggan, pengalihan pause ke owner, dan ekstraksi pesanan otomatis.
- **Header:** `Authorization: Bearer ${INTERNAL_API_TOKEN}`
- **Request Body:**
  ```json
  {
    "customer_phone": "+6281234567890",
    "message_text": "halo mau pesan buket",
    "message_id": "false_6281234567890@c.us_3EB0ABC12345",
    "from_me": false,
    "intent": null
  }
  ```
- **Respons (200 OK):**
  ```json
  {
    "ok": true,
    "state_before": "AWAITING_CHOICE",
    "state_after": "AWAITING_ORDER",
    "replies": [
      {
        "to": "+6281234567890",
        "text": "Baik Kak! Silakan lengkapi formulir pesanan di bawah ini..."
      }
    ]
  }
  ```

### 3.3 `POST /api/internal/inbound/{message_id}/transcript`
Menyimpan teks transkripsi dari voice note.
- **Request Body:**
  ```json
  {
    "transcript": "besok tolong ingatkan kirim bunga jam dua siang"
  }
  ```
- **Respons (200 OK):**
  ```json
  { "ok": true }
  ```

---

### 3.4 `GET /api/internal/context/chat?message_id={id}`
Mengambil system prompt hasil render runtime dan memori riwayat chat untuk AI Agent.
- **Respons (200 OK):**
  ```json
  {
    "system_prompt": "Kamu adalah Botseri...\n[Konteks Runtime: Asia/Jakarta, Waktu: ...]",
    "history": [
      { "role": "user", "content": "Halo Botseri" },
      { "role": "assistant", "content": "Halo! Ada pesanan atau tugas yang ingin dicatat?" }
    ]
  }
  ```

---

### 3.5 Tool: `POST /api/internal/tools/create-todo-and-order`
Didaftarkan di LLM sebagai `tool_create_todo_and_order`.
- **Request Body:**
  ```json
  {
    "source_message_id": "b3e0c7a1-8d4e-4f2a-9e1b-3c4d5e6f7a8b",
    "order": {
      "customer_name": "Bu Ani",
      "customer_contact": "081299998888",
      "description": "Buket Mawar Merah 20 Tangkai",
      "event_date": "2026-10-20T10:00:00+07:00",
      "delivery_date": "2026-10-20T10:00:00+07:00",
      "delivery_address": "Pondok Indah Blok B2",
      "total_amount": 350000,
      "dp_amount": 100000,
      "payment_status": "DP_PAID"
    },
    "todos": [
      {
        "title": "Beli mawar merah segar di pasar Rawabelong",
        "description": "20 tangkai kualitas grade A",
        "category": "Belanja",
        "priority_rank": 2,
        "due_at": "2026-10-19T20:00:00+07:00",
        "has_specific_time": true
      },
      {
        "title": "Antar buket pesanan Bu Ani",
        "description": "Pondok Indah Blok B2",
        "category": "Pengiriman",
        "priority_rank": 1,
        "due_at": "2026-10-20T10:00:00+07:00",
        "has_specific_time": true
      }
    ]
  }
  ```
- **Respons (200 OK):**
  ```json
  {
    "ok": true,
    "order_id": "9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "todos": [
      {
        "id": "e1f2a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b",
        "title": "Antar buket pesanan Bu Ani",
        "priority_rank": 1,
        "priority_label": "Kritis / Sameday",
        "due_at": "2026-10-20T10:00:00+07:00",
        "planned_date": "2026-10-20",
        "google_sync_status": "SYNCED",
        "deduplicated": false
      }
    ],
    "warnings": []
  }
  ```

---

### 3.6 Tool: `POST /api/internal/tools/get-prioritized-todos`
Didaftarkan di LLM sebagai `tool_get_prioritized_todos`.
- **Request Body:**
  ```json
  {
    "scope": "TODAY",
    "limit": 30
  }
  ```
  *(Scope yang didukung: `TODAY`, `ALL_ACTIVE`, `OVERDUE`)*
- **Respons (200 OK):**
  ```json
  {
    "ok": true,
    "focus": [
      {
        "id": "...",
        "title": "Antar buket Bu Ani",
        "priority_rank": 1,
        "priority_label": "Kritis",
        "due_at": "2026-10-20T10:00:00+07:00"
      }
    ],
    "rest": [],
    "upcoming": [],
    "counts": {
      "focus": 1,
      "rest": 0,
      "upcoming": 2,
      "total_active": 3
    }
  }
  ```

---

### 3.7 Tool: `POST /api/internal/tools/update-todo-status`
Didaftarkan di LLM sebagai `tool_update_todo_status`.
- **Request Body:**
  ```json
  {
    "todo_id": null,
    "match_text": "antar buket bu ani",
    "status": "DONE"
  }
  ```
- **Respons Sukses (200 OK):**
  ```json
  {
    "ok": true,
    "todo": {
      "id": "e1f2a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b",
      "title": "Antar buket pesanan Bu Ani",
      "status": "DONE",
      "completed_at": "2026-10-20T11:15:00+07:00"
    }
  }
  ```
- **Respons Ambigu (200 OK):**
  ```json
  {
    "ok": false,
    "error": {
      "code": "AMBIGUOUS",
      "message": "Ditemukan lebih dari 1 tugas serupa. Tolong tanyakan konfirmasi ke pengguna.",
      "candidates": [
        { "id": "uuid-1", "title": "Antar buket Bu Ani Pondok Indah" },
        { "id": "uuid-2", "title": "Antar buket Bu Ani Kelapa Gading" }
      ]
    }
  }
  ```

---

### 3.8 Tool: `POST /api/internal/tools/update-todo`
Mengubah detail to-do dan memperbarui sinkronisasi Google.
- **Request Body:**
  ```json
  {
    "todo_id": "e1f2a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b",
    "title": "Antar buket Bu Ani (Revisi Jam 11)",
    "due_at": "2026-10-20T11:00:00+07:00",
    "has_specific_time": true,
    "priority_rank": 1
  }
  ```
- **Respons (200 OK):**
  ```json
  { "ok": true, "todo": { "id": "...", "title": "..." } }
  ```

---

### 3.9 `POST /api/internal/outbound/log`
Mencatat pesan WhatsApp yang telah berhasil dikirim oleh n8n.
- **Request Body:**
  ```json
  {
    "chat_id": "6281234567890@c.us",
    "body": "Tugas Anda telah berhasil dicatat! 🔥",
    "in_reply_to": "b3e0c7a1-8d4e-4f2a-9e1b-3c4d5e6f7a8b"
  }
  ```
- **Respons (200 OK):**
  ```json
  { "ok": true }
  ```

---

### 3.10 `POST /api/internal/scheduler/tick`
Dipicu oleh n8n setiap 15 menit (`*/15 * * * *`).
- **Respons (200 OK):**
  ```json
  {
    "now_local": "2026-10-19T06:00:03+07:00",
    "jobs": [
      {
        "job_id": "c1d2e3f4-a5b6-7c8d-9e0f-1a2b3c4d5e6f",
        "job_type": "MORNING_BRIEF",
        "seq": 0,
        "chat_id": "6281234567890@c.us",
        "messages": [
          { "role": "system", "content": "Kamu adalah Botseri..." },
          { "role": "user", "content": "Susun Morning Brief berdasarkan data berikut: {...}" }
        ],
        "fallback_text": "Selamat pagi! 🔥 3 Fokus Utama Pagi Ini:\n1. Antar buket Bu Ani\n..."
      }
    ]
  }
  ```

---

### 3.11 `POST /api/internal/scheduler/jobs/{job_id}/result`
Melaporkan status pengiriman job proaktif oleh n8n.
- **Request Body:**
  ```json
  {
    "status": "SENT",
    "error": null,
    "body": "Selamat pagi! 🔥 3 Fokus Utama Pagi Ini:\n..."
  }
  ```
  *(Status: `SENT` atau `FAILED`. `body` opsional, dipakai untuk mencatat isi pesan proaktif ke `message_log` sesuai §11.3; klien lama yang hanya mengirim `status` dan `error` tetap valid.)*

---

## 4. LLM Gateway (`/api/internal/llm/v1/*`)

Dashboard bertindak sebagai proxy kompatibel format OpenAI untuk n8n:

### 4.1 `POST /api/internal/llm/v1/chat/completions`
- n8n mengirim parameter model konvensi `botseri-default`. Dashboard memetakan ke provider aktif di tabel `llm_configs` (OpenAI, Gemini, dll).
- Kunci API LLM didekripsi saat runtime dan dicatat ke `llm_usage_logs` tanpa mengekspos kunci ke n8n.

### 4.2 `POST /api/internal/llm/v1/audio/transcriptions`
- Multipart form request (`file`, `model`).
- Diteruskan ke STT provider (Whisper / Gemini Flash Audio) dan mengembalikan teks.

---

## 5. API Eksternal WAHA yang Dipanggil n8n

| Endpoint WAHA | Metode | Payload | Tujuan |
|---|---|---|---|
| `http://botseri-waha:3000/api/sendText` | POST | `{"session": "default", "chatId": "...", "text": "..."}` | Kirim balasan WhatsApp |
| `http://botseri-waha:3000/api/files/...` | GET | Header `X-Api-Key: ${WAHA_API_KEY}` | Unduh voice note untuk STT |

# Step 03 — Laporan Eksekusi Auth, Prompt Compiler, dan Core API

> **Tanggal:** 20 Oktober 2026
> **Status:** Selesai
> **Rujukan:** [`step-03-prompt-compiler-and-core-api.md`](../steps/step-03-prompt-compiler-and-core-api.md), `ARCHITECTURE.md` §4, §6, §7, §8, §22

---

## 1. Ringkasan

Step 03 selesai. Dashboard kini memiliki setup first-run, login admin Argon2id + sesi JWT, middleware CSRF/sesi, Prompt Compiler empat lapisan, Internal API untuk inbound/context/outbound, dan LLM Gateway kompatibel OpenAI beserta pencatatan usage.

Setelah verifikasi, data uji dibersihkan dan `bot_settings.setup_completed` dikembalikan ke `false`. Setup token aktif tetap tersedia di log container dan dapat dipakai untuk bootstrap berikutnya.

| Komponen | Status |
|---|---|
| `botseri-dashboard` | `healthy` |
| `botseri-db` | `healthy` |
| `botseri-n8n` | `Up` |
| `botseri-waha` | `Up` |

---

## 2. Perubahan Utama

| Area | Perubahan |
|---|---|
| Time | `src/lib/time/index.ts`: format lokal, ISO weekday, hari kerja, `nextWorkingDay`, jendela waktu, konversi local↔UTC |
| Logger | `src/lib/logger.ts`: JSON terstruktur ke stdout tanpa isi pesan/rahasia |
| Prompt | Template kanonik `base.id.md`, `compiler.ts` (alias, validasi placeholder, versioning, Priority Stack), `render.ts` (trigger + runtime context) |
| Auth | `password.ts` (Argon2id), `session.ts` (JWT HS256, cookie), `setup-token.ts`, `rate-limit.ts`, `internal/auth.ts` |
| Middleware | `src/middleware.ts`: sesi, CSRF origin, `/api/internal/*` menolak header Cloudflare, bypass health/internal |
| Setup | `POST /api/setup`: token first-run, validasi, admin, kompilasi prompt, cookie sesi dalam satu transaksi |
| UI minimum | `/setup`, `/login`, `/dashboard`; root mengarahkan sesuai status setup/sesi |
| Internal API | `inbound/accept`, `inbound/{id}/transcript`, `context/chat`, `outbound/log` |
| LLM Gateway | `src/lib/llm-gateway/`: router, adapter OpenAI-compatible, adapter native Anthropic, usage/cost logging |
| Docker | Entrypoint mencetak `SETUP_TOKEN` saat startup jika env kosong; template prompt dan tracing ikut image |
| Dokumentasi | Roadmap Step 03 ditandai selesai |

---

## 3. Verifikasi

### 3.1 Unit test dan build

```text
$ npm test
Test Files  3 passed (3)
Tests       14 passed (14)

$ npx tsc --noEmit
(no output)

$ npm run build
✓ Compiled successfully
ƒ Middleware  30.1 kB
```

### 3.2 Health dan middleware

```text
GET /api/internal/health                              -> 200
{"status":"ok","db":true,"migration":"20261020100000_init"}

GET /api/internal/health + cf-connecting-ip           -> 404
GET /login + cf-connecting-ip                         -> 200
GET /dashboard tanpa sesi                             -> 307 /login
GET /api/internal/context/chat tanpa bearer           -> 401
POST /api/auth/logout dengan origin asing             -> 403
```

Cloudflare guard hanya berlaku pada `/api/internal/*`, sehingga dashboard yang diakses melalui tunnel tetap dapat dibuka.

### 3.3 Setup, login, dan sesi

```text
POST /api/setup                                       -> 200
{"ok":true,"setup_completed":true,"compiled_prompt_version":2}

GET /dashboard dengan cookie setup                     -> 200
POST /api/auth/login (benar)                          -> 200
GET /dashboard dengan cookie login                     -> 200
POST /api/auth/login (salah)                          -> 401
POST /api/setup kedua kali                             -> 409
```

Cookie sesi tidak memiliki atribut `Secure` pada request HTTP lokal, sehingga alur browser `http://127.0.0.1:3000` berfungsi. Kode akan menandai cookie `Secure` bila request membawa `x-forwarded-proto: https` atau URL HTTPS.

### 3.4 Prompt dan database

```text
setup_completed | compiled_prompt_version | prompt berisi brand
t               | 2                       | t
```

Prompt hasil kompilasi berisi Priority Stack dari database, trigger `CHAT_MASUK`, dan tidak menyisakan placeholder runtime.

### 3.5 Internal API dan LLM gateway

Dengan config LLM uji sementara:

```text
POST /api/internal/inbound/accept                     -> 200 accept=true
POST inbound dengan wa_message_id sama                -> 200 DUPLICATE
POST /api/internal/inbound/{id}/transcript            -> 200
GET  /api/internal/context/chat?message_id={id}       -> 200
     prompt_chars=2469, history=1, trigger=true, leftover=false
POST /api/internal/outbound/log                       -> 200
POST inbound media image                              -> 200 UNSUPPORTED_MEDIA
POST /api/internal/llm/v1/chat/completions stream:true -> 400
```

Config LLM, nomor uji, pesan, admin, dan event uji dihapus setelah verifikasi. Tidak ada panggilan jaringan ke provider LLM sungguhan.

### 3.6 Keadaan akhir

```text
setup_completed | compiled_prompt_version
f               | 1

admin_users=0, llm_configs=0, message_log=0
dashboard ERROR logs=0
```

---

## 4. Penyimpangan dan Keputusan

1. **Middleware ditempatkan di `src/middleware.ts`.** Build awal dengan `dashboard/middleware.ts` tidak mendaftarkan middleware karena proyek memakai direktori `src/`; build akhir menampilkan `ƒ Middleware 30.1 kB`.
2. **`outputFileTracingIncludes` berada di `experimental`.** Next.js 14.2 menolak key top-level. Docker juga menyalin `src/lib/prompt/templates` secara eksplisit agar route setup dan context tetap menemukan template di image standalone.
3. **Setup token dicetak oleh entrypoint.** Agar token tersedia di log sejak startup (bukan baru saat request setup pertama), `docker-entrypoint.sh` membuat dan mengekspor token jika `SETUP_TOKEN` kosong. Helper TypeScript tetap menyediakan fallback untuk `npm run dev`.
4. **Cookie `Secure` ditentukan dari request.** `isSecureRequest()` memakai `x-forwarded-proto` atau protokol URL. Ini menghindari redirect loop saat dashboard diuji lewat HTTP lokal, sementara akses tunnel HTTPS tetap mendapat cookie `Secure`.
5. **`SystemEvent` memakai `code` dan `message`.** Skema aktual Step 02 tidak memiliki kolom `event`; helper audit dan route setup disesuaikan.
6. **Gateway berada di `src/lib/llm-gateway/`.** Mengikuti struktur kanonik step dan memisahkan adapter provider dari route.
7. **Tidak ada panggilan provider nyata.** Tidak tersedia API key pada verifikasi; adapter, validasi `stream`, dan jalur usage diuji secara lokal/compile. STT dengan file audio nyata belum diuji end-to-end.

---

## 5. Risiko dan Tindak Lanjut

- **Setup token ada di log.** Ini disyaratkan untuk first-run. Untuk produksi, isi `SETUP_TOKEN` di `.env` agar token tidak dibuat ulang dan tidak tercetak saat startup.
- **Kompatibilitas provider LLM** (`OPENAI`, `OPENROUTER`, `GEMINI`, `CUSTOM_OPENAI_COMPAT`, `ANTHROPIC`) dan STT masih perlu diuji dengan kredensial nyata serta dicatat di `docs/VERSIONS.md` bila ada perubahan versi/endpoint.
- **Anthropic adapter** menangani teks dan `tool_use`; belum menangani streaming, vision, atau blok `thinking`.
- **Context chat membutuhkan LLM aktif.** Setelah setup, endpoint ini mengembalikan 404 sampai LLM Manager Step 05 menambahkan config.
- **Sesi JWT tidak dapat dicabut server-side.** Logout menghapus cookie; token tetap valid sampai kedaluwarsa (7 hari). Pertimbangkan tabel sesi/denylist jika dibutuhkan.
- **Rate limit in-memory** hanya berlaku per proses; tidak cocok untuk multi-replica tanpa Redis.
- **Normalisasi pairing code** menggunakan uppercase sebelum hash. Generator pairing di Step 05 harus memakai normalisasi yang sama.

---

## 6. Langkah Berikutnya

Step 03 tidak melanjutkan Step 04. Pekerjaan berikutnya adalah Step 04 (live board to-do, orders, Priority Stack) atau Step 05 (settings, LLM manager, WAHA QR, Google OAuth), yang keduanya bergantung pada Step 03.

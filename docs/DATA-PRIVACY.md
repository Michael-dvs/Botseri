# Kebijakan dan Inventaris Privasi Data Pelanggan Botseri

Dokumen ini merinci inventaris pemrosesan Data Pribadi (Personally Identifiable Information / PII), tujuan penyimpanan, batasan retensi, serta mekanisme hak subjek data pada sistem Botseri.

---

## 1. Inventaris Data Pribadi (PII)

Berikut adalah rincian data pribadi yang dikumpulkan dan diproses oleh sistem Botseri:

| Tabel Basis Data | Kolom Berisi PII | Tujuan Penyimpanan | Masa Retensi | Siapa yang Dapat Mengakses |
|---|---|---|---|---|
| `orders` | `customer_name`, `customer_contact`, `customer_chat_id`, `delivery_address`, `special_notes` | Pemrosesan pengiriman, konfirmasi pesanan, dan pencatatan operasional florist | 365 hari pasca selesai atau dibatalkan (dapat dikonfigurasi via `customer_data_retention_days`) | Admin dan Owner melalui Dashboard |
| `customer_sessions` | `phone_e164`, `customer_name`, `metadata` (draft pesan, nama sementara) | Menjaga status percakapan interaktif bot WhatsApp dan draft formulir pemesanan | 90 hari sejak aktivitas terakhir (dibersihkan jika tidak memiliki pesanan aktif) | Sistem internal bot dan Admin |
| `message_log` | `chat_id`, `body` (isi pesan chat WhatsApp) | Audit jejak pesan, pencegahan duplikasi, dan evaluasi anti-spam | 90 hari kalender | Admin melalui Dashboard dan log sistem |
| `authorized_numbers` | `phone_e164`, `chat_id`, `label` | Autentikasi dan otorisasi pemilik/staf toko untuk akses To-Do dan kontrol bot | Permanen selama nomor terdaftar aktif | Pemilik Utama (Owner) |

---

## 2. Kebijakan Retensi dan Anonimisasi Otomatis

Sistem Botseri menyediakan mekanisme pembersihan dan anonimisasi data berkala melalui skrip `scripts/retention.ts`:

1. **Log Pesan (`message_log`):**
   - Baris pesan yang berusia lebih dari 90 hari dihapus secara berkala.
2. **Sesi Pelanggan (`customer_sessions`):**
   - Sesi yang tidak memiliki interaksi selama lebih dari 90 hari dan tidak terikat pada pesanan aktif dibersihkan dari basis data.
3. **Anonimisasi Pesanan Lama (`orders`):**
   - Pesanan berstatus `COMPLETED` atau `CANCELLED` yang usianya melebihi masa retensi (default 365 hari) otomatis di-anonimkan:
     - `customer_name` diubah menjadi `'Pelanggan Teranonimasi'`.
     - `customer_contact` diubah menjadi `'080000000000'`.
     - `customer_chat_id` diatur menjadi `NULL`.
     - `delivery_address` diubah menjadi `'Alamat Dihapus'`.
     - `special_notes` diatur menjadi `NULL`.
   - **Integritas Agregat Bisnis:** Nilai keuangan (`total_amount`, `dp_amount`), tanggal pesanan (`event_date`, `created_at`), dan status pesanan tetap dipertahankan utuh untuk kebutuhan pembukuan dan laporan omzet usaha.
4. **Pembersihan Kotak Sampah:**
   - Pesanan yang berstatus soft-delete (`deleted_at`) lebih dari 30 hari dibersihkan secara permanen dari basis data.

---

## 3. Hak Subjek Data (Right to be Forgotten)

Pelanggan berhak meminta penghapusan seluruh data pribadi mereka. Petugas operasional dapat menjalankan skrip penghapusan terarah:

```bash
npx tsx scripts/purge-customer.ts <nomor_telepon_atau_chat_id>
```

Skrip ini akan secara atomik:
1. Menghapus sesi percakapan di `customer_sessions`.
2. Menghapus riwayat log pesan di `message_log`.
3. Menganonimkan seluruh identitas pribadi pelanggan pada riwayat transaksi di tabel `orders`.

---

## 4. Perlindungan Data pada Pemanggilan AI (LLM Gateway)

Untuk mencegah kebocoran data pribadi ke penyedia model bahasa pihak ketiga (OpenAI, Anthropic, Google Gemini, OpenRouter):
1. **Redaksi Otomatis:** Teks pelanggan pada alur fallback formulir pesanan secara otomatis diredaksikan melalui modul `redactForLlm` sebelum dikirim ke API upstream. Nomor telepon Indonesia dan alamat email disamarkan menjadi penanda anonim `[NOMOR_TELEPON]` dan `[EMAIL]`.
2. **Isolasi Alur:** Alur ekstraksi AI formulir pesanan murni berupa prompt teks tanpa akses tool calling dan tanpa memuat riwayat percakapan pemilik usaha.
3. **Opsi Pembatasan Model:** Pemilik sistem dapat mengaktifkan opsi `ai_form_fallback_requires_paid_model` di pengaturan sistem untuk menonaktifkan fallback AI jika model yang aktif merupakan tier publik gratis.

---

## 5. Penafian Hukum (Legal Disclaimer)

> **PEMBERITAHUAN:** Implementasi teknis pada sistem Botseri ini dirancang untuk memfasilitasi prinsip perlindungan data pribadi dan minimisasi data. Kepatuhan hukum penuh terhadap Undang-Undang Perlindungan Data Pribadi (UU PDP No. 27 Tahun 2022 di Indonesia) atau regulasi serupa tetap merupakan tanggung jawab pengelola usaha dan pemilik operasional sistem. Diperlukan peninjauan berkala terhadap standar operasional prosedur usaha, klausul persetujuan pelanggan, dan perjanjian pemrosesan data pihak ketiga (〔PERLU VERIFIKASI MANUAL〕).

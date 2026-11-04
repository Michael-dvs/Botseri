import type { RequiredField } from "./orderFormat";

export const T1_GREETING = `Halo, selamat datang di *Berseri Florist & Decor*! 🌸✨
Senang sekali Kakak menghubungi kami. Ada yang bisa kami bantu hari ini?
1️⃣ *Langsung Pesan* (Buket Bunga / Dekorasi Acara)
2️⃣ *Tanya-tanya / Konsultasi Dulu*
_(Balas dengan angka *1* atau *2* ya Kak)_`;

export const T2_ORDER_FORM = `Baik Kak! Silakan lengkapi formulir pesanan di bawah ini agar pesanan Kakak bisa langsung kami jadwalkan:

*FORMAT PESANAN BERSERI*
• Nama Pemesan:
• Jenis Pesanan (Buket / Bunga Meja / Dekor Lamaran / dll):
• Tanggal Acara / Pengiriman:
• Jam Pengiriman:
• Alamat / Lokasi:
• Request Khusus (Warna bunga / Tulisan kartu ucapan):

_Salin dan isi format di atas lalu kirim kembali ke chat ini ya Kak!_ 🌸`;

export const T3_PAUSE_NOTICE = `Siap Kak! Pertanyaan Kakak sudah kami sampaikan ke Owner Berseri.
Saat ini bot kami jeda sejenak agar *Owner kami bisa langsung membalas chat Kakak secara manual* di sini. Mohon ditunggu sebentar ya Kak! ☕🌸`;

export const T5_REMINDER = `Mohon maaf Kak, kami belum menangkap pilihannya 🙏
Balas *1* untuk langsung pesan, atau *2* untuk tanya-tanya dulu ya Kak.`;

const REQUIRED_LABELS: Record<RequiredField, string> = {
  nama_pemesan: "• Nama Pemesan",
  jenis_pesanan: "• Jenis Pesanan (Buket / Bunga Meja / Dekor Lamaran / dll)",
  tanggal_acara: "• Tanggal Acara / Pengiriman (contoh: 15 November 2026 atau 15/11/2026)",
  alamat: "• Alamat / Lokasi",
};

export function missingFieldsMessage(missing: RequiredField[]): string {
  const list = missing.map((f) => REQUIRED_LABELS[f] ?? `• ${f}`).join("\n");
  return `Terima kasih Kak! Masih ada data yang belum terisi:\n${list}\nMohon dilengkapi lalu kirim lagi ya Kak 🌸`;
}

export interface ConfirmedOrderData {
  id: string;
  customer_name: string;
  description: string;
  event_date: Date | null;
  delivery_address: string | null;
  delivery_time?: string | null;
  notes?: string | null;
}

const INDO_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function formatDateIndo(date: Date): string {
  // Use Jakarta offset (+07:00)
  const utc = date.getTime();
  const jakartaDate = new Date(utc + 7 * 60 * 60 * 1000);
  const day = jakartaDate.getUTCDate();
  const month = INDO_MONTHS[jakartaDate.getUTCMonth()];
  const year = jakartaDate.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function orderConfirmation(order: ConfirmedOrderData): string {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const dateStr = order.event_date ? formatDateIndo(order.event_date) : "-";

  const lines: string[] = [
    "Yeay, terima kasih Kak! 🌸",
    "Pesanan Kakak sudah otomatis tercatat ke dalam sistem operasional Berseri:",
    `📋 *No. Pesanan:* #ORD-${shortId}`,
    `👤 *Pemesan:* ${order.customer_name}`,
    `💐 *Layanan:* ${order.description}`,
    `📅 *Tanggal:* ${dateStr}`,
  ];

  if (order.delivery_time && order.delivery_time.trim()) {
    lines.push(`⏰ *Jam:* ${order.delivery_time.trim()}`);
  }

  lines.push(`📍 *Lokasi:* ${order.delivery_address || "-"}`);

  if (order.notes && order.notes.trim()) {
    lines.push(`📝 *Request:* ${order.notes.trim()}`);
  }

  lines.push(
    "Tim kami akan segera menyiapkan pesanan terbaik untuk Kakak. Jika ada perubahan detail, silakan kabari kami ya!"
  );

  return lines.join("\n");
}

export function ownerAlert(phone: string, lastMessage: string | null | undefined): string {
  const sanitized = (lastMessage || "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  return `🔔 *Halo Owner Berseri! Ada Pelanggan Butuh Bantuan Manual*
• *Nomor Pelanggan:* ${phone}
• *Pesan Terakhir:* "${sanitized}"
_(Bot otomatis dinonaktifkan sementara untuk nomor ini. Silakan balas chat langsung di WhatsApp. Jika pelanggan deal memesan, kirim format pesanan di chat tersebut agar bot mencatat otomatis.)_`;
}

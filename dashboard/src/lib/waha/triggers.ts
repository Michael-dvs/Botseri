/**
 * Sumber kebenaran tunggal untuk jenis pemicu pesan keluar (Outbound Trigger Types)
 * Mematuhi invarian INV-13: Semua penambahan trigger wajib terdaftar di berkas ini.
 */

export const OUTBOUND_TRIGGERS = [
  "CHAT_MASUK",
  "MORNING_BRIEF",
  "WORK_HOURS_REMINDER",
  "END_OF_DAY_EVAL",
  "PAIRING",
  "TASK_ALARM",
  "CUSTOMER_REPLY",
  "CUSTOM_REPLY",
  "NEW_ORDER_ALERT",
  "OWNER_DIGEST",
  "CONFIRMATION_REPLY",
] as const;

export type Trigger = (typeof OUTBOUND_TRIGGERS)[number];

/**
 * Tingkat prioritas antrean pesan WAHA (dipakai di S09):
 * 0 = Kritis / Waktu Nyata (Alarm tugas, Alert order baru, Digest owner)
 * 1 = Operasional Owner (Balasan chat owner, Briefing, Evaluasi, Konfirmasi deterministik)
 * 2 = Interaksi Pelanggan (Balasan menu otomatis pelanggan, Chat kustom)
 */
export const TRIGGER_PRIORITY: Record<Trigger, 0 | 1 | 2> = {
  TASK_ALARM: 0,
  NEW_ORDER_ALERT: 0,
  OWNER_DIGEST: 0,
  CHAT_MASUK: 1,
  MORNING_BRIEF: 1,
  WORK_HOURS_REMINDER: 1,
  END_OF_DAY_EVAL: 1,
  PAIRING: 0,
  CONFIRMATION_REPLY: 1,
  CUSTOMER_REPLY: 2,
  CUSTOM_REPLY: 2,
};

/**
 * Kebijakan penerima yang diizinkan untuk setiap jenis trigger:
 * OWNER_ONLY: Wajib terdaftar di authorized_numbers
 * CUSTOMER_ONLY: Wajib terdaftar di customer_sessions
 * ANY: Diizinkan untuk kedua jenis penerima atau alur pendaftaran (pairing)
 */
export const TRIGGER_RECIPIENT_POLICY: Record<
  Trigger,
  "OWNER_ONLY" | "CUSTOMER_ONLY" | "ANY"
> = {
  CHAT_MASUK: "OWNER_ONLY",
  MORNING_BRIEF: "OWNER_ONLY",
  WORK_HOURS_REMINDER: "OWNER_ONLY",
  END_OF_DAY_EVAL: "OWNER_ONLY",
  PAIRING: "ANY",
  TASK_ALARM: "OWNER_ONLY",
  CUSTOMER_REPLY: "CUSTOMER_ONLY",
  CUSTOM_REPLY: "ANY",
  NEW_ORDER_ALERT: "OWNER_ONLY",
  OWNER_DIGEST: "OWNER_ONLY",
  CONFIRMATION_REPLY: "OWNER_ONLY",
};

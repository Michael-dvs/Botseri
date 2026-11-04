import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "@/lib/customer/phone";
import { parseChoice } from "@/lib/customer/choice";
import {
  looksLikeOrderForm,
  parseDateId,
  parseOrderForm,
} from "@/lib/customer/orderFormat";
import { transition } from "@/lib/customer/stateMachine";
import {
  T1_GREETING,
  T2_ORDER_FORM,
  T3_PAUSE_NOTICE,
  T5_REMINDER,
  missingFieldsMessage,
  orderConfirmation,
  ownerAlert,
} from "@/lib/customer/templates";

describe("Customer Core - phone.ts", () => {
  it("normalizes WhatsApp JID to E.164", () => {
    expect(normalizePhoneE164("628123456789@c.us")).toBe("+628123456789");
  });

  it("normalizes 08... national prefix to +628...", () => {
    expect(normalizePhoneE164("08123456789")).toBe("+628123456789");
  });

  it("normalizes formatted phone number", () => {
    expect(normalizePhoneE164("+62 812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhoneE164("62812345678")).toBe("+62812345678");
  });

  it("returns null for invalid inputs", () => {
    expect(normalizePhoneE164("abc")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164("12345@lid")).toBeNull();
    expect(normalizePhoneE164("123-456@g.us")).toBeNull();
  });
});

describe("Customer Core - choice.ts", () => {
  it("recognizes exact numbers and keywords", () => {
    expect(parseChoice("1")).toBe("ORDER");
    expect(parseChoice("2")).toBe("ASK");
    expect(parseChoice("mau pesan kak")).toBe("ORDER");
    expect(parseChoice("mau order")).toBe("ORDER");
    expect(parseChoice("beli dong")).toBe("ORDER");
    expect(parseChoice("mau tanya dulu")).toBe("ASK");
    expect(parseChoice("konsultasi dulu ya")).toBe("ASK");
    expect(parseChoice("nanya dong")).toBe("ASK");
  });

  it("returns UNKNOWN for greetings and ambiguous choices", () => {
    expect(parseChoice("halo")).toBe("UNKNOWN");
    expect(parseChoice("1 atau 2?")).toBe("UNKNOWN");
    expect(parseChoice("mau tanya cara pesan")).toBe("UNKNOWN");
    expect(parseChoice("")).toBe("UNKNOWN");
  });
});

describe("Customer Core - orderFormat.ts", () => {
  const completeForm = `*FORMAT PESANAN BERSERI*
• Nama Pemesan: Siti Nurhaliza
• Jenis Pesanan (Buket / Bunga Meja / Dekor Lamaran / dll): Buket Mawar Merah
• Tanggal Acara / Pengiriman: 15 November 2026
• Jam Pengiriman: 10:00 WIB
• Alamat / Lokasi: Jl. Thamrin No. 5 Jakarta Pusat
• Request Khusus (Warna bunga / Tulisan kartu ucapan): Pita emas`;

  it("detects order form when 3+ labels are present", () => {
    expect(looksLikeOrderForm(completeForm)).toBe(true);
  });

  it("rejects non-order messages", () => {
    expect(looksLikeOrderForm("alamat saya di bandung")).toBe(false);
    expect(looksLikeOrderForm("halo selamat siang kak")).toBe(false);
  });

  it("parses complete order form with no missing required fields", () => {
    const { fields, missing } = parseOrderForm(completeForm);
    expect(fields.nama_pemesan).toBe("Siti Nurhaliza");
    expect(fields.jenis_pesanan).toBe("Buket Mawar Merah");
    expect(fields.tanggal_acara).toBe("15 November 2026");
    expect(fields.jam_pengiriman).toBe("10:00 WIB");
    expect(fields.alamat).toBe("Jl. Thamrin No. 5 Jakarta Pusat");
    expect(fields.request_khusus).toBe("Pita emas");
    expect(fields.parsed_date).toBeInstanceOf(Date);
    expect(missing).toEqual([]);
  });

  it("parses form without optional fields (Jam & Request) with missing=[]", () => {
    const formWithoutOptionals = `Nama Pemesan: Budi Santoso
Jenis Pesanan: Bunga Meja
Tanggal Acara: 15/11/2026
Alamat: Jl. Sudirman No. 1`;
    const { fields, missing } = parseOrderForm(formWithoutOptionals);
    expect(fields.nama_pemesan).toBe("Budi Santoso");
    expect(fields.jenis_pesanan).toBe("Bunga Meja");
    expect(fields.jam_pengiriman).toBeUndefined();
    expect(fields.request_khusus).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it("identifies missing required fields", () => {
    const formWithoutName = `Jenis Pesanan: Bunga Meja
Tanggal Acara: 15/11/2026
Alamat: Jl. Sudirman No. 1`;
    const { missing } = parseOrderForm(formWithoutName);
    expect(missing).toContain("nama_pemesan");
  });
  it("strips bot intro and footer instructions copied by user", () => {
    const copiedChat = `Baik Kak! Silakan lengkapi formulir pesanan di bawah ini agar pesanan Kakak bisa langsung kami jadwalkan:

*FORMAT PESANAN BERSERI*
• Nama Pemesan: Michael Aristyo
• Jenis Pesanan: Dekor lamaran
• Tanggal Acara / Pengiriman: 9 Desember 2026
• Jam Pengiriman: 06:00 WIB
• Alamat / Lokasi: Jakarta Selatan
• Request Khusus (Warna bunga / Tulisan kartu ucapan): Happy Weding bby

_Salin dan isi format di atas lalu kirim kembali ke chat ini ya Kak!_ 🌸`;

    const { fields, missing } = parseOrderForm(copiedChat);
    expect(missing).toEqual([]);
    expect(fields.nama_pemesan).toBe("Michael Aristyo");
    expect(fields.jenis_pesanan).toBe("Dekor lamaran");
    expect(fields.tanggal_acara).toBe("9 Desember 2026");
    expect(fields.jam_pengiriman).toBe("06:00 WIB");
    expect(fields.alamat).toBe("Jakarta Selatan");
    expect(fields.request_khusus).toBe("Happy Weding bby");
  });


  it("parses dates correctly in Jakarta timezone", () => {
    const d1 = parseDateId("15 Nov 2026");
    expect(d1).not.toBeNull();
    expect(d1?.toISOString()).toBe("2026-11-14T17:00:00.000Z"); // 00:00 Jakarta is 17:00 prev day UTC

    const d2 = parseDateId("15/11/2026");
    expect(d2).not.toBeNull();
    expect(d2?.toISOString()).toBe("2026-11-14T17:00:00.000Z");

    const d3 = parseDateId("15-11-2026");
    expect(d3).not.toBeNull();

    expect(parseDateId("minggu depan")).toBeNull();
    expect(parseDateId("31/02/2026")).toBeNull();
    expect(parseDateId("besok lusa")).toBeNull();
  });
});

describe("Customer Core - templates.ts", () => {
  it("renders order confirmation with and without optional fields", () => {
    const textWithOptionals = orderConfirmation({
      id: "9c3c5d6e-1111-2222-3333-444455556666",
      customer_name: "Rina",
      description: "Buket Wisuda",
      event_date: new Date("2026-11-15T00:00:00+07:00"),
      delivery_address: "Kampus UI Depok",
      delivery_time: "09:00 WIB",
      notes: "Pita biru navy",
    });
    expect(textWithOptionals).toContain("#ORD-9C3C5D6E");
    expect(textWithOptionals).toContain("⏰ *Jam:* 09:00 WIB");
    expect(textWithOptionals).toContain("📝 *Request:* Pita biru navy");

    const textWithoutOptionals = orderConfirmation({
      id: "9c3c5d6e-1111-2222-3333-444455556666",
      customer_name: "Rina",
      description: "Buket Wisuda",
      event_date: new Date("2026-11-15T00:00:00+07:00"),
      delivery_address: "Kampus UI Depok",
    });
    expect(textWithoutOptionals).not.toContain("⏰ *Jam:*");
    expect(textWithoutOptionals).not.toContain("📝 *Request:*");
  });

  it("sanitizes owner alert message and truncates to 300 chars", () => {
    const rawLong = "Halo \x00\x08" + "A".repeat(500);
    const alert = ownerAlert("+628123456789", rawLong);
    expect(alert).toContain("+628123456789");
    expect(alert).not.toContain("\x00");
  });
});

describe("Customer Core - stateMachine.ts (Section 8 Table)", () => {
  // Row 1: INIT / sesi baru, bukan format -> SEND_GREETING, AWAITING_CHOICE
  it("Row 1: INIT + no order form -> SEND_GREETING -> AWAITING_CHOICE", () => {
    const res = transition({
      state: "INIT",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_GREETING");
    expect(res.nextState).toBe("AWAITING_CHOICE");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 2: INIT / sesi baru, hasOrderForm -> PROCESS_ORDER
  it("Row 2: INIT + hasOrderForm -> PROCESS_ORDER", () => {
    const res = transition({
      state: "INIT",
      hasOrderForm: true,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("PROCESS_ORDER");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 3: AWAITING_CHOICE + hasOrderForm -> PROCESS_ORDER
  it("Row 3: AWAITING_CHOICE + hasOrderForm -> PROCESS_ORDER", () => {
    const res = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: true,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("PROCESS_ORDER");
  });

  // Row 4: AWAITING_CHOICE + choice ORDER -> SEND_ORDER_FORM -> AWAITING_ORDER
  it("Row 4: AWAITING_CHOICE + choice ORDER -> SEND_ORDER_FORM -> AWAITING_ORDER", () => {
    const res = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: false,
      choice: "ORDER",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_ORDER_FORM");
    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 5: AWAITING_CHOICE + choice ASK -> SEND_PAUSE_NOTICE_AND_ALERT_OWNER -> PAUSED_FOR_OWNER
  it("Row 5: AWAITING_CHOICE + choice ASK -> SEND_PAUSE_NOTICE_AND_ALERT_OWNER -> PAUSED_FOR_OWNER", () => {
    const res = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: false,
      choice: "ASK",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_PAUSE_NOTICE_AND_ALERT_OWNER");
    expect(res.nextState).toBe("PAUSED_FOR_OWNER");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 6: AWAITING_CHOICE + choice UNKNOWN + retry < 3 -> SEND_REMINDER (retry+1)
  it("Row 6: AWAITING_CHOICE + UNKNOWN + retry 0/2 -> SEND_REMINDER (retry+1)", () => {
    const res0 = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res0.action).toBe("SEND_REMINDER");
    expect(res0.nextState).toBe("AWAITING_CHOICE");
    expect(res0.nextRetryCount).toBe(1);

    const res2 = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 2,
      pausedExpired: false,
    });
    expect(res2.action).toBe("SEND_REMINDER");
    expect(res2.nextState).toBe("AWAITING_CHOICE");
    expect(res2.nextRetryCount).toBe(3);
  });

  // Row 7: AWAITING_CHOICE + choice UNKNOWN + retry >= 3 -> ASK (PAUSED_FOR_OWNER)
  it("Row 7: AWAITING_CHOICE + UNKNOWN + retry >= 3 -> PAUSED_FOR_OWNER", () => {
    const res = transition({
      state: "AWAITING_CHOICE",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 3,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_PAUSE_NOTICE_AND_ALERT_OWNER");
    expect(res.nextState).toBe("PAUSED_FOR_OWNER");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 8: AWAITING_ORDER + hasOrderForm -> PROCESS_ORDER
  it("Row 8: AWAITING_ORDER + hasOrderForm -> PROCESS_ORDER", () => {
    const res = transition({
      state: "AWAITING_ORDER",
      hasOrderForm: true,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("PROCESS_ORDER");
  });

  // Row 9: AWAITING_ORDER + choice ASK -> PAUSED_FOR_OWNER
  it("Row 9: AWAITING_ORDER + choice ASK -> PAUSED_FOR_OWNER", () => {
    const res = transition({
      state: "AWAITING_ORDER",
      hasOrderForm: false,
      choice: "ASK",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_PAUSE_NOTICE_AND_ALERT_OWNER");
    expect(res.nextState).toBe("PAUSED_FOR_OWNER");
  });

  // Row 10: AWAITING_ORDER + other + retry < 3 -> SEND_ORDER_FORM (retry+1)
  it("Row 10: AWAITING_ORDER + other + retry < 3 -> SEND_ORDER_FORM (retry+1)", () => {
    const res = transition({
      state: "AWAITING_ORDER",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 1,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_ORDER_FORM");
    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.nextRetryCount).toBe(2);
  });

  // Row 11: AWAITING_ORDER + other + retry >= 3 -> ASK (PAUSED_FOR_OWNER)
  it("Row 11: AWAITING_ORDER + other + retry >= 3 -> PAUSED_FOR_OWNER", () => {
    const res = transition({
      state: "AWAITING_ORDER",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 3,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_PAUSE_NOTICE_AND_ALERT_OWNER");
    expect(res.nextState).toBe("PAUSED_FOR_OWNER");
    expect(res.nextRetryCount).toBe(0);
  });

  // Row 12: PAUSED_FOR_OWNER (unexpired) + hasOrderForm -> PROCESS_ORDER
  it("Row 12: PAUSED_FOR_OWNER (unexpired) + hasOrderForm -> PROCESS_ORDER", () => {
    const res = transition({
      state: "PAUSED_FOR_OWNER",
      hasOrderForm: true,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("PROCESS_ORDER");
  });

  // Row 13: PAUSED_FOR_OWNER (unexpired) + not form -> STAY_SILENT
  it("Row 13: PAUSED_FOR_OWNER (unexpired) + not form -> STAY_SILENT", () => {
    const res = transition({
      state: "PAUSED_FOR_OWNER",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("STAY_SILENT");
    expect(res.nextState).toBe("PAUSED_FOR_OWNER");
  });

  // Row 14: ACTIVE (or PAUSED_FOR_OWNER with pausedExpired)
  it("Row 14: ACTIVE + hasOrderForm -> PROCESS_ORDER", () => {
    const res = transition({
      state: "ACTIVE",
      hasOrderForm: true,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("PROCESS_ORDER");
  });

  it("Row 14: ACTIVE + not form -> SEND_GREETING -> AWAITING_CHOICE", () => {
    const res = transition({
      state: "ACTIVE",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: false,
    });
    expect(res.action).toBe("SEND_GREETING");
    expect(res.nextState).toBe("AWAITING_CHOICE");
  });

  it("PAUSED_FOR_OWNER with pausedExpired=true behaves as ACTIVE", () => {
    const res = transition({
      state: "PAUSED_FOR_OWNER",
      hasOrderForm: false,
      choice: "UNKNOWN",
      retryCount: 0,
      pausedExpired: true,
    });
    expect(res.action).toBe("SEND_GREETING");
    expect(res.nextState).toBe("AWAITING_CHOICE");
  });
});

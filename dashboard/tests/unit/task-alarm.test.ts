import { describe, expect, it } from "vitest";
import {
  DAYPART_SLOTS,
  formatDueAtLocalText,
  localDateString,
  localDateTimeToUtc,
  MIN_FUTURE_MARGIN_MINUTES,
  resolveTimeExpression,
} from "../../src/lib/time";
import {
  DEFAULT_ALARM_CONFIG,
  formatTaskAlarm,
  isAlarmDue,
  sanitizeTitleForWhatsapp,
} from "../../src/lib/scheduler/queries";

describe("Deterministic Time Expression Resolver (resolveTimeExpression)", () => {
  const tz = "Asia/Jakarta";

  it("menyelesaikan daypart PAGI sebelum slot hari ini (misal 07:00)", () => {
    // 07:00 WIB hari ini -> slot PAGI hari ini adalah 08:30 WIB
    const now = localDateTimeToUtc("2026-10-27", tz, "07:00:00");
    const res = resolveTimeExpression(now, tz, { kind: "DAYPART", daypart: "PAGI" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.planned_date_string).toBe("2026-10-27");
    expect(res.is_rollover_tomorrow).toBe(false);
    expect(res.due_at_iso).toBe("2026-10-27T08:30:00+07:00");
  });

  it("bergulir ke besok 08:00 WIB jika now 08:45 WIB untuk daypart PAGI", () => {
    // 08:45 WIB hari ini -> slot 08:30 sudah lewat, bergulir ke besok 08:00 WIB
    const now = localDateTimeToUtc("2026-10-27", tz, "08:45:00");
    const res = resolveTimeExpression(now, tz, { kind: "DAYPART", daypart: "PAGI" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.planned_date_string).toBe("2026-10-28");
    expect(res.is_rollover_tomorrow).toBe(true);
    expect(res.due_at_iso).toBe("2026-10-28T08:00:00+07:00");
  });

  it("menghormati margin 1 menit sebelum slot", () => {
    // Tepat 08:29:30 WIB -> kurang dari 1 menit ke 08:30:00 WIB -> harus bergulir ke besok
    const nowAlmostAtSlot = localDateTimeToUtc("2026-10-27", tz, "08:29:30");
    const res = resolveTimeExpression(nowAlmostAtSlot, tz, { kind: "DAYPART", daypart: "PAGI" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.is_rollover_tomorrow).toBe(true);
    expect(res.due_at_iso).toBe("2026-10-28T08:00:00+07:00");
  });

  it("menyelesaikan 'besok pagi' (date_hint: TOMORROW, daypart: PAGI) menjadi besok 08:00 WIB", () => {
    const now = localDateTimeToUtc("2026-10-27", tz, "06:00:00");
    const res = resolveTimeExpression(
      now,
      tz,
      { kind: "DAYPART", daypart: "PAGI", date_hint: "TOMORROW" },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.planned_date_string).toBe("2026-10-28");
    expect(res.due_at_iso).toBe("2026-10-28T08:00:00+07:00");
    expect(res.is_rollover_tomorrow).toBe(true);
  });

  it("menyelesaikan daypart SIANG, SORE, dan MALAM secara tepat", () => {
    const nowMorning = localDateTimeToUtc("2026-10-27", tz, "09:00:00");

    const siang = resolveTimeExpression(nowMorning, tz, { kind: "DAYPART", daypart: "SIANG" });
    expect(siang.ok).toBe(true);
    if (siang.ok) expect(siang.due_at_iso).toBe("2026-10-27T12:30:00+07:00");

    const sore = resolveTimeExpression(nowMorning, tz, { kind: "DAYPART", daypart: "SORE" });
    expect(sore.ok).toBe(true);
    if (sore.ok) expect(sore.due_at_iso).toBe("2026-10-27T16:00:00+07:00");

    const malam = resolveTimeExpression(nowMorning, tz, { kind: "DAYPART", daypart: "MALAM" });
    expect(malam.ok).toBe(true);
    if (malam.ok) expect(malam.due_at_iso).toBe("2026-10-27T19:30:00+07:00");
  });

  it("menyelesaikan jam 24-jam spesifik seperti 19:35", () => {
    const now = localDateTimeToUtc("2026-10-27", tz, "12:00:00");
    const res = resolveTimeExpression(now, tz, { kind: "CLOCK", hour: 19, minute: 35 });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.due_at_iso).toBe("2026-10-27T19:35:00+07:00");
    expect(res.is_rollover_tomorrow).toBe(false);
  });

  it("menyelesaikan 'setengah 8' (half_before: true, hour: 8) menjadi 07:30", () => {
    const now = localDateTimeToUtc("2026-10-27", tz, "06:00:00");
    const res = resolveTimeExpression(now, tz, {
      kind: "CLOCK",
      hour: 8,
      half_before: true,
      period: "PAGI",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.due_at_iso).toBe("2026-10-27T07:30:00+07:00");
  });

  it("memilih kemunculan terdekat untuk jam ambigu (misal jam 8 saat pukul 10:00 WIB memilih 20:00 WIB)", () => {
    const now10Am = localDateTimeToUtc("2026-10-27", tz, "10:00:00");
    const res = resolveTimeExpression(now10Am, tz, { kind: "CLOCK", hour: 8 });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Pukul 08:00 AM sudah lewat, sehingga memilih 20:00 PM hari ini
    expect(res.due_at_iso).toBe("2026-10-27T20:00:00+07:00");
    expect(res.is_rollover_tomorrow).toBe(false);
  });

  it("mengembalikan error terstruktur jika waktu yang diminta dengan tanggal eksplisit sudah lewat", () => {
    const now15 = localDateTimeToUtc("2026-10-27", tz, "15:00:00");
    const res = resolveTimeExpression(
      now15,
      tz,
      { kind: "CLOCK", hour: 10, minute: 0, period: "PAGI" },
      "TODAY",
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("PAST_TIME_WITH_EXPLICIT_DATE");
  });
});

describe("Pure Alarm Selection Logic (isAlarmDue)", () => {
  const baseNow = new Date("2026-10-27T12:35:00.000Z"); // 19:35 WIB

  it("mengembalikan true untuk tugas PENDING yang tepat jatuh tempo", () => {
    const todo = {
      status: "PENDING",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:35:00.000Z"),
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todo, baseNow)).toBe(true);
  });

  it("mengembalikan false jika status bukan PENDING", () => {
    const todo = {
      status: "DONE",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:35:00.000Z"),
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todo, baseNow)).toBe(false);
  });

  it("mengembalikan false jika has_specific_time false atau due_at null", () => {
    const todoNoTime = {
      status: "PENDING",
      has_specific_time: false,
      due_at: new Date("2026-10-27T12:35:00.000Z"),
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoNoTime, baseNow)).toBe(false);

    const todoNullDue = {
      status: "PENDING",
      has_specific_time: true,
      due_at: null,
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoNullDue, baseNow)).toBe(false);
  });

  it("mengembalikan false jika tugas belum jatuh tempo", () => {
    const todoFuture = {
      status: "PENDING",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:36:00.000Z"), // 1 menit di depan
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoFuture, baseNow)).toBe(false);
  });

  it("mengembalikan false jika sudah reminded_at", () => {
    const todoAlreadyReminded = {
      status: "PENDING",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:35:00.000Z"),
      reminded_at: new Date("2026-10-27T12:35:01.000Z"),
      reminder_attempts: 1,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoAlreadyReminded, baseNow)).toBe(false);
  });

  it("mengembalikan false jika terlambat lebih dari 12 jam (maxLateness)", () => {
    const thirteenHoursAgo = new Date(baseNow.getTime() - 13 * 60 * 60_000);
    const todoExpired = {
      status: "PENDING",
      has_specific_time: true,
      due_at: thirteenHoursAgo,
      reminded_at: null,
      reminder_attempts: 0,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoExpired, baseNow)).toBe(false);
  });

  it("mengembalikan false jika reminder_attempts mencapai batas maksimal 5", () => {
    const todoExhausted = {
      status: "PENDING",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:30:00.000Z"),
      reminded_at: null,
      reminder_attempts: 5,
      reminder_claimed_at: null,
    };
    expect(isAlarmDue(todoExhausted, baseNow)).toBe(false);
  });

  it("mengembalikan false jika masih dalam cooldown klaim 2 menit", () => {
    const oneMinuteAgo = new Date(baseNow.getTime() - 60_000);
    const todoInCooldown = {
      status: "PENDING",
      has_specific_time: true,
      due_at: new Date("2026-10-27T12:30:00.000Z"),
      reminded_at: null,
      reminder_attempts: 1,
      reminder_claimed_at: oneMinuteAgo,
    };
    expect(isAlarmDue(todoInCooldown, baseNow)).toBe(false);

    // Setelah 2 menit 1 detik, harus boleh diklaim ulang
    const threeMinutesAgo = new Date(baseNow.getTime() - 3 * 60_000);
    const todoAfterCooldown = {
      ...todoInCooldown,
      reminder_claimed_at: threeMinutesAgo,
    };
    expect(isAlarmDue(todoAfterCooldown, baseNow)).toBe(true);
  });
});

describe("Deterministic Alarm Text Formatter (formatTaskAlarm)", () => {
  const tz = "Asia/Jakarta";

  it("menghasilkan teks pengingat mendekati deadline jika ada due_at dan remind_at", () => {
    const dueAt = new Date("2026-10-27T12:35:00.000Z"); // 19:35 WIB
    const remindAt = new Date("2026-10-27T11:35:00.000Z"); // 18:35 WIB
    const now = new Date("2026-10-27T11:35:00.000Z"); // 18:35 WIB

    const text = formatTaskAlarm({
      title: "Tugas PPPL",
      dueAt,
      remindAt,
      now,
      timezone: tz,
    });

    expect(text).toBe("🔔 Pengingat: Tugas *Tugas PPPL* mendekati batas waktu (Tenggat: 19:35 WIB · 60 menit lagi). Semangat tuntaskan ya!");
    expect(text).not.toContain("—");
  });

  it("menghasilkan teks pengingat waktu mulai jika hanya ada remind_at", () => {
    const remindAt = new Date("2026-10-29T02:25:00.000Z"); // 09:25 WIB
    const now = new Date("2026-10-29T02:25:00.000Z");

    const text = formatTaskAlarm({
      title: "tugas RPL2",
      remindAt,
      now,
      timezone: tz,
    });

    expect(text).toBe("🔔 Pengingat: Waktunya *tugas RPL2* sekarang (09:25 WIB). Semangat!");
    expect(text).not.toContain("—");
  });

  it("menetralkan karakter format WhatsApp dari judul buatan pengguna", () => {
    const clean = sanitizeTitleForWhatsapp("*Judul* _dengan_ ~format~ `kode`");
    expect(clean).toBe("Judul dengan format kode");
  });
});

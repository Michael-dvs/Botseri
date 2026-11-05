import { describe, expect, it } from "vitest";
import type { BotSettings } from "@prisma/client";
import { resolveDueAndReminder } from "../../src/lib/todos/create";
import { formatTaskAlarm } from "../../src/lib/scheduler/queries";
import { localTimeString } from "../../src/lib/time";

describe("Strict Separation of Deadline (due_at) vs Reminder Alarm (remind_at)", () => {
  const dummySettings: BotSettings = {
    id: 1,
    brand_name: "Botseri",
    business_type: "Layanan",
    owner_name: "Owner",
    timezone: "Asia/Jakarta",
    work_hours_start: "08:00",
    work_hours_end: "22:00",
    early_brief_time: "08:00",
    default_due_time: "17:00",
    working_days: [1, 2, 3, 4, 5, 6],
    behavior_mode: "STRICT",
    behavior_instruction: null,
    prompt_mode: "STACK",
    custom_prompt_template: null,
    compiled_prompt: null,
    compiled_prompt_version: 1,
    compiled_at: null,
    reminder_interval_minutes: 15,
    reminder_max_per_day: 5,
    reminder_max_rank: 4,
    brief_window_minutes: 30,
    eod_window_minutes: 30,
    google_sync_mode: "AUTO",
    bot_enabled: true,
    setup_completed: true,
    enable_orders: true,
    customer_data_retention_days: 365,
    ai_form_fallback_requires_paid_model: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  it("Kasus A: Ada due_at tanpa remind_at menghasilkan remind_at otomatis 1 jam sebelumnya", () => {
    // Deadline jam 14:00 WIB (07:00 UTC)
    const dueAtIso = "2026-10-29T14:00:00+07:00";
    const res = resolveDueAndReminder(
      {
        title: "Kirim laporan",
        priority_rank: 1,
        due_at: dueAtIso,
        has_specific_time: true,
      },
      dummySettings,
    );

    expect(res.dueAt).not.toBeNull();
    expect(res.remindAt).not.toBeNull();
    expect(res.hasSpecificTime).toBe(true);

    // due_at = 14:00 WIB
    expect(localTimeString(res.dueAt!, "Asia/Jakarta")).toBe("14:00");
    // remind_at = 13:00 WIB (1 jam sebelum deadline)
    expect(localTimeString(res.remindAt!, "Asia/Jakarta")).toBe("13:00");
    expect(res.remindAt!.getTime()).toBe(res.dueAt!.getTime() - 60 * 60 * 1000);
  });

  it("Kasus B: Ada remind_at tanpa due_at menghasilkan remind_at terisi dan due_at null", () => {
    // Permintaan 'ingatkan jam 09:25'
    const remindAtIso = "2026-10-29T09:25:00+07:00";
    const res = resolveDueAndReminder(
      {
        title: "mengerjakan tugas RPL2",
        priority_rank: 2,
        remind_at: remindAtIso,
        due_at: null,
        has_specific_time: true,
      },
      dummySettings,
    );

    expect(res.dueAt).toBeNull();
    expect(res.remindAt).not.toBeNull();
    expect(res.hasSpecificTime).toBe(true);
    expect(localTimeString(res.remindAt!, "Asia/Jakarta")).toBe("09:25");
  });

  it("Kasus C: Ada due_at dan remind_at menghasilkan keduanya tersimpan independen", () => {
    const dueAtIso = "2026-10-29T17:00:00+07:00";
    const remindAtIso = "2026-10-29T16:15:00+07:00";
    const res = resolveDueAndReminder(
      {
        title: "Meeting vendor",
        priority_rank: 1,
        due_at: dueAtIso,
        remind_at: remindAtIso,
        has_specific_time: true,
      },
      dummySettings,
    );

    expect(res.dueAt).not.toBeNull();
    expect(res.remindAt).not.toBeNull();
    expect(res.hasSpecificTime).toBe(true);
    expect(localTimeString(res.dueAt!, "Asia/Jakarta")).toBe("17:00");
    expect(localTimeString(res.remindAt!, "Asia/Jakarta")).toBe("16:15");
  });

  it("Kasus D: Tanpa jam sama sekali menghasilkan due_at null, remind_at null, has_specific_time false", () => {
    const res = resolveDueAndReminder(
      {
        title: "Beli kertas nota",
        priority_rank: 4,
        due_at: null,
        remind_at: null,
        has_specific_time: false,
      },
      dummySettings,
    );

    expect(res.dueAt).toBeNull();
    expect(res.remindAt).toBeNull();
    expect(res.hasSpecificTime).toBe(false);
  });
  it("Format teks alarm deterministik: Tugas dengan due_at dan remind_at menampilkan tenggat dan selisih menit dinamis", () => {
    const dueAt = new Date("2026-10-29T07:00:00.000Z"); // 14:00 WIB
    const remindAt = new Date("2026-10-29T06:00:00.000Z"); // 13:00 WIB
    const now = new Date("2026-10-29T06:00:00.000Z"); // 13:00 WIB
    const text = formatTaskAlarm({
      title: "Kirim laporan",
      dueAt,
      remindAt,
      now,
      timezone: "Asia/Jakarta",
    });

    expect(text).toBe(
      "🔔 Pengingat: Tugas *Kirim laporan* mendekati batas waktu (Tenggat: 14:00 WIB · 60 menit lagi). Semangat tuntaskan ya!",
    );
    expect(text).not.toContain("—");
  });

  it("Format teks alarm deterministik: Tugas dengan remind_at menampilkan waktu sekarang", () => {
    const remindAt = new Date("2026-10-29T02:25:00.000Z"); // 09:25 WIB
    const text = formatTaskAlarm({
      title: "tugas RPL2",
      remindAt,
      timezone: "Asia/Jakarta",
    });

    expect(text).toBe(
      "🔔 Pengingat: Waktunya *tugas RPL2* sekarang (09:25 WIB). Semangat!",
    );
    expect(text).not.toContain("—");
  });
});

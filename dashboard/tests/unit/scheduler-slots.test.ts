import type { BotSettings } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { activeReminderSlot, reminderSlots } from "@/lib/scheduler/slots";

const base = {
  behavior_mode: "STRICT",
  reminder_interval_minutes: 120,
  work_hours_start: "08:00",
  work_hours_end: "17:00",
} as BotSettings;

describe("reminderSlots", () => {
  it("membuat slot STRICT setelah satu interval sampai end minus 30 menit", () => {
    expect(reminderSlots(base)).toEqual([
      { index: 1, startMinutes: 600 },
      { index: 2, startMinutes: 720 },
      { index: 3, startMinutes: 840 },
      { index: 4, startMinutes: 960 },
    ]);
  });

  it("membatasi slot STRICT menjadi 24 dengan indeks berurutan", () => {
    const slots = reminderSlots({ ...base, reminder_interval_minutes: 1, work_hours_end: "23:59" });
    expect(slots).toHaveLength(24);
    expect(slots.map((slot) => slot.index)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
  });

  it("mengaktifkan slot selama 30 menit", () => {
    expect(activeReminderSlot(599, base)).toBeNull();
    expect(activeReminderSlot(600, base)?.index).toBe(1);
    expect(activeReminderSlot(629, base)?.index).toBe(1);
    expect(activeReminderSlot(630, base)).toBeNull();
  });

  it("memilih slot tumpang tindih terbaru yang sudah dimulai", () => {
    const settings = { ...base, reminder_interval_minutes: 15 };
    expect(activeReminderSlot(519, settings)?.startMinutes).toBe(510);
  });

  it.each(["SANTAI", "STRICT"] as const)("membuat satu slot tengah untuk %s dengan interval nonpositif", (mode) => {
    expect(reminderSlots({ ...base, behavior_mode: mode, reminder_interval_minutes: 0 })).toEqual([
      { index: 1, startMinutes: 750 },
    ]);
  });

  it("membuat satu slot tengah pada mode SANTAI", () => {
    expect(reminderSlots({ ...base, behavior_mode: "SANTAI" })).toEqual([
      { index: 1, startMinutes: 750 },
    ]);
  });

  it("mengembalikan kosong untuk jam STRICT tidak valid atau terlalu pendek", () => {
    expect(reminderSlots({ ...base, work_hours_end: "08:00" })).toEqual([]);
    expect(reminderSlots({ ...base, work_hours_end: "08:29" })).toEqual([]);
  });
});

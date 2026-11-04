import { describe, expect, it } from "vitest";
import { googleSyncDelayMinutes, googleSyncRetryDue } from "@/lib/google/sync";
import {
  fallbackBrief,
  fallbackEod,
  fallbackReminder,
  isMinuteInWindow,
} from "@/lib/scheduler/tick";
import type { PromptTodo } from "@/lib/scheduler/queries";
import { nextWorkingDay } from "@/lib/time";

const todo: PromptTodo = {
  id: "todo-1",
  title: "Kirim pesanan",
  status: "PENDING",
  priority_rank: 1,
  priority_label: "Penting",
  due_at: null,
  planned_date: "2026-10-27",
  hanging: false,
};

describe("keputusan scheduler murni", () => {
  it.each([
    [360, 360, 120, true],
    [479, 360, 120, true],
    [480, 360, 120, false],
    [1020, 1020, 15, true],
    [1034, 1020, 15, true],
    [1035, 1020, 15, false],
  ])("memeriksa batas jendela %i pada %i + %i", (now, start, duration, expected) => {
    expect(isMinuteInWindow(now, start, duration)).toBe(expected);
  });

  it("melewati akhir pekan dan hari libur", () => {
    const friday = new Date("2026-10-30T05:00:00Z");
    expect(nextWorkingDay(friday, "Asia/Jakarta", [1, 2, 3, 4, 5], ["2026-11-02"]))
      .toBe("2026-11-03");
  });

  it("menghitung backoff eksponensial dengan batas 60 menit", () => {
    expect(Array.from({ length: 9 }, (_, attempts) => googleSyncDelayMinutes(attempts)))
      .toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it("menentukan waktu retry dari waktu percobaan terakhir", () => {
    const last = new Date("2026-10-27T00:00:00Z");
    expect(googleSyncRetryDue(new Date("2026-10-27T00:03:59Z"), last, 2)).toBe(false);
    expect(googleSyncRetryDue(new Date("2026-10-27T00:04:00Z"), last, 2)).toBe(true);
    expect(googleSyncRetryDue(new Date(), null, 8)).toBe(true);
  });

  it("menghasilkan fallback tidak kosong tanpa em dash", () => {
    const texts = [
      fallbackBrief({ focus: [], rest: [], upcoming: [], events: [] }),
      fallbackBrief({ focus: [todo], rest: [todo], upcoming: [todo], events: [{ title: "Rapat", start: "", end: "", all_day: true }] }),
      fallbackReminder([], "17:00"),
      fallbackReminder([todo], "17:00"),
      fallbackEod({ target_count: 0, done_count: 0, pending_count: 0, completion_rate: null, tier: "NO_TASKS" }, 0, "2026-10-28"),
      fallbackEod({ target_count: 3, done_count: 1, pending_count: 2, completion_rate: 100 / 3, tier: "LOW" }, 2, "2026-10-28"),
    ];
    for (const text of texts) {
      expect(text.trim()).not.toBe("");
      expect(text).not.toContain("\u2014");
    }
  });
});

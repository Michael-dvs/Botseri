import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTaskTimes } from "@/lib/time/resolve";
import { claimDueTaskAlarms } from "@/lib/scheduler/queries";
import { tick } from "@/lib/scheduler/tick";
import { Prisma } from "@prisma/client";

const {
  prismaMock,
  recordEventMock,
} = vi.hoisted(() => ({
  prismaMock: {
    todo: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    systemEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    botSettings: {
      findUnique: vi.fn(),
    },
    authorizedNumber: {
      findFirst: vi.fn(),
    },
    holiday: {
      findMany: vi.fn(),
    },
    dailyExecutionLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    customerSession: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

describe("S07: Waktu dan Alarm Server sebagai Penentu (P1)", () => {
  const tz = "Asia/Jakarta";
  // Waktu uji: Rabu, 4 November 2026 pukul 10:00:00 WIB
  const baseNow = new Date("2026-11-04T03:00:00.000Z"); // 10:00 WIB

  beforeEach(() => {
    vi.clearAllMocks();
    recordEventMock.mockResolvedValue({});
  });

  describe("1. Uji Batas Kasus A (due_at ada, remind_at tidak ada)", () => {
    it("R = 62 menit: remind_at tepat T - 60 menit", () => {
      // due_at = now + 62 menit (11:02 WIB)
      const dueAt = new Date(baseNow.getTime() + 62 * 60_000);
      const res = resolveTaskTimes({
        due_at: dueAt,
        has_specific_time: true,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.alarm_will_fire).toBe(true);
      expect(res.remind_at).not.toBeNull();
      // remind_at harus tepat due_at - 60 menit (now + 2 menit = 10:02 WIB)
      const expectedRemind = new Date(dueAt.getTime() - 60 * 60_000);
      expect(res.remind_at?.getTime()).toBe(expectedRemind.getTime());
      expect(res.alarm_note).toContain("60 menit");
    });

    it("R = 61 menit: remind_at tepat T - 30 menit", () => {
      // due_at = now + 61 menit
      const dueAt = new Date(baseNow.getTime() + 61 * 60_000);
      const res = resolveTaskTimes({
        due_at: dueAt,
        has_specific_time: true,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.alarm_will_fire).toBe(true);
      expect(res.remind_at).not.toBeNull();
      // floor(61 / 2) = 30 menit sebelum due_at
      const expectedRemind = new Date(dueAt.getTime() - 30 * 60_000);
      expect(res.remind_at?.getTime()).toBe(expectedRemind.getTime());
      expect(res.alarm_note).toContain("30 menit");
    });

    it("R = 12 menit: remind_at tepat T - 6 menit", () => {
      // due_at = now + 12 menit
      const dueAt = new Date(baseNow.getTime() + 12 * 60_000);
      const res = resolveTaskTimes({
        due_at: dueAt,
        has_specific_time: true,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.alarm_will_fire).toBe(true);
      expect(res.remind_at).not.toBeNull();
      // floor(12 / 2) = 6 menit sebelum due_at
      const expectedRemind = new Date(dueAt.getTime() - 6 * 60_000);
      expect(res.remind_at?.getTime()).toBe(expectedRemind.getTime());
      expect(res.alarm_note).toContain("6 menit");
    });

    it("R = 11 menit: remind_at bernilai null dan alarm_will_fire = true pada waktu due_at", () => {
      // due_at = now + 11 menit
      const dueAt = new Date(baseNow.getTime() + 11 * 60_000);
      const res = resolveTaskTimes({
        due_at: dueAt,
        has_specific_time: true,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.remind_at).toBeNull();
      expect(res.alarm_will_fire).toBe(true);
      // alarm_at_local_text harus merujuk ke waktu due_at
      expect(res.alarm_at_local_text).toBe(res.due_at_local_text);
      expect(res.alarm_note).toContain("kurang dari 12 menit");
    });
  });

  describe("2. Uji Validasi Server atas Nilai dari LLM", () => {
    it("Input remind_at 10 menit di masa lalu menghasilkan error REMIND_AT_IN_PAST", () => {
      const pastRemind = new Date(baseNow.getTime() - 10 * 60_000);
      const res = resolveTaskTimes({
        remind_at: pastRemind,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("REMIND_AT_IN_PAST");
      expect(res.message).toContain("terlewat");
    });

    it("Input horizon > 366 hari ditolak dengan error HORIZON_EXCEEDED", () => {
      const farFuture = new Date(baseNow.getTime() + 400 * 24 * 3600_000);
      const res = resolveTaskTimes({
        due_at: farFuture,
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("HORIZON_EXCEEDED");
    });

    it("Selisih time_expression dan ISO > 5 menit memprioritaskan time_expression dan mencatat TIME_MISMATCH", () => {
      // time_expression: jam 14:00 (14:00 WIB = 07:00 UTC)
      // due_at ISO dari LLM: 16:00 WIB (selisih 2 jam > 5 menit)
      const res = resolveTaskTimes({
        time_expression: { kind: "CLOCK", hour: 14, minute: 0, date_hint: "TODAY" },
        due_at: "2026-11-04T16:00:00+07:00",
        now: baseNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Harus memakai 14:00 WIB
      expect(res.due_at_iso).toContain("14:00:00+07:00");
      expect(recordEventMock).toHaveBeenCalledWith(
        "WARN",
        "time_resolver",
        "TIME_MISMATCH",
        expect.objectContaining({
          reason: "EXPRESSION_ISO_DISCREPANCY",
        })
      );
    });

    it("Batas tengah malam: 'besok pagi' yang diucapkan pukul 00:30 WIB mengarah ke tanggal kalender yang benar", () => {
      // Pukul 00:30 WIB pada 5 November 2026 (17:30 UTC pada 4 November 2026)
      const midnightNow = new Date("2026-11-04T17:30:00.000Z");
      const res = resolveTaskTimes({
        time_expression: { kind: "DAYPART", daypart: "PAGI", date_hint: "TOMORROW" },
        now: midnightNow,
        tz,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Besok dari 5 November 2026 adalah 6 November 2026
      expect(res.planned_date_string).toBe("2026-11-06");
      expect(res.due_at_iso).toContain("2026-11-06");
    });
  });

  describe("3. Uji Alarm Kedaluwarsa & Klaim Basi", () => {
    it("Alarm yang tertunda lebih dari 12 jam diberi reminder_expired_at dan dicatat di system_events", async () => {
      // Mock raw query scheduler: mendeteksi to-do tertunda > 12 jam
      const expiredTodo = {
        id: "todo-expired-1",
        title: "Kirim invoice bunga",
        remind_at: new Date(baseNow.getTime() - 13 * 3600_000), // 13 jam lalu
      };

      prismaMock.todo.findMany.mockResolvedValueOnce([expiredTodo]);
      prismaMock.todo.updateMany.mockResolvedValueOnce({ count: 1 });

      // Jalankan pemeriksaan alarm kedaluwarsa
      const { processExpiredAlarms } = await import("@/lib/scheduler/queries");
      const expiredCount = await processExpiredAlarms(baseNow);

      expect(expiredCount).toBe(1);
      expect(prismaMock.todo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["todo-expired-1"] },
          }),
          data: expect.objectContaining({
            reminder_expired_at: baseNow,
          }),
        })
      );
      expect(recordEventMock).toHaveBeenCalledWith(
        "WARN",
        "SCHEDULER",
        "ALARM_EXPIRED",
        expect.objectContaining({
          todo_id: "todo-expired-1",
        })
      );
    });

    it("Klaim alarm yang menggantung > 5 menit berhasil dipulihkan", async () => {
      prismaMock.todo.updateMany.mockResolvedValueOnce({ count: 2 });

      const { recoverStaleTaskClaims } = await import("@/lib/scheduler/queries");
      const recovered = await recoverStaleTaskClaims(baseNow);

      expect(recovered).toBe(2);
      expect(prismaMock.todo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            reminder_claimed_at: expect.objectContaining({
              lt: expect.any(Date),
            }),
            reminded_at: null,
          }),
          data: {
            reminder_claimed_at: null,
          },
        })
      );
    });

    it("Idempotensi Tick: pemanggilan tick dua kali pada jendela yang sama hanya memicu tepat satu pengiriman alarm", async () => {
      prismaMock.botSettings.findUnique.mockResolvedValue({
        id: 1,
        bot_enabled: true,
        setup_completed: true,
        timezone: "Asia/Jakarta",
        working_days: [1, 2, 3, 4, 5],
        early_brief_time: "07:00",
        brief_window_minutes: 60,
        work_hours_start: "08:00",
        work_hours_end: "17:00",
        reminder_max_per_day: 3,
        reminder_max_rank: 5,
      });

      prismaMock.authorizedNumber.findFirst.mockResolvedValue({
        id: "owner-1",
        phone_e164: "+628123456789",
        chat_id: "628123456789@c.us",
        is_primary: true,
      });

      prismaMock.holiday.findMany.mockResolvedValue([]);
      prismaMock.customerSession.findMany.mockResolvedValue([]);

      // Panggilan pertama mengklaim 1 alarm
      const alarmRow = {
        id: "todo-alarm-1",
        title: "Beli pita merah",
        due_at: new Date(baseNow.getTime() + 10 * 60_000),
        remind_at: baseNow,
        reminder_attempts: 1,
      };

      prismaMock.$queryRaw.mockResolvedValueOnce([alarmRow]); // Panggilan pertama claim 1 alarm
      prismaMock.$queryRaw.mockResolvedValueOnce([]); // Panggilan kedua claim 0 alarm (sudah diklaim / skip locked)

      const tick1 = await tick(baseNow);
      expect(tick1.jobs.filter((j) => j.job_type === "TASK_ALARM").length).toBe(1);

      const tick2 = await tick(baseNow);
      expect(tick2.jobs.filter((j) => j.job_type === "TASK_ALARM").length).toBe(0);
    });
  });
});

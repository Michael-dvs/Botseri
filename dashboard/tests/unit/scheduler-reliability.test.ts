import { beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "@/lib/scheduler/tick";
import { getSchedulerStaleMinutes, tickHealth } from "@/lib/analytics/helpers";

const {
  prismaMock,
  recordEventMock,
} = vi.hoisted(() => ({
  prismaMock: {
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
    todo: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    customerSession: {
      findMany: vi.fn(),
    },
    systemEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    schedulerLock: {
      upsert: vi.fn(),
      update: vi.fn(),
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

describe("S08: Reliabilitas Scheduler dan Observabilitas (P1)", () => {
  const baseNow = new Date("2026-11-04T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SCHEDULER_STALE_MINUTES;
    delete process.env.HEARTBEAT_URL;
    recordEventMock.mockResolvedValue({});

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
    prismaMock.dailyExecutionLog.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.todo.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.systemEvent.findMany.mockResolvedValue([]);
    prismaMock.systemEvent.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe("1. Uji Kunci Atomik (TICK_OVERLAP)", () => {
    it("Simulasi 2 pemanggilan tick() paralel: panggilan kedua mengembalikan skipped: TICK_OVERLAP", async () => {
      // Panggilan pertama berhasil klaim lock
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { name: "tick", locked_until: new Date(baseNow.getTime() + 55_000), holder: "tick-1" },
      ]);
      // Panggilan kedua gagal klaim lock (0 baris kembali karena locked_until >= now)
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      // Panggilan pertama
      const res1Promise = tick(baseNow, "tick-1");
      // Panggilan kedua dijalankan secara paralel
      const res2Promise = tick(baseNow, "tick-2");

      const [res1, res2] = await Promise.all([res1Promise, res2Promise]);

      expect(res1.skipped).toBeUndefined();
      expect(res2.skipped).toBe("TICK_OVERLAP");
      expect(res2.jobs).toEqual([]);
      expect(recordEventMock).toHaveBeenCalledWith(
        "INFO",
        "SCHEDULER",
        "TICK_OVERLAP",
        expect.any(Object)
      );
    });

    it("Pemulihan kunci basi: baris scheduler_locks dengan locked_until lampau berhasil diambil alih", async () => {
      // Kunci sebelumnya basi (locked_until 10 detik di masa lalu), kueri atomik mengembalikan baris yang berhasil diupdate
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { name: "tick", locked_until: new Date(baseNow.getTime() + 55_000), holder: "tick-recovery" },
      ]);

      const res = await tick(baseNow, "tick-recovery");
      expect(res.skipped).toBeUndefined();
    });
  });

  describe("2. Uji Ambang STALE Dinamis", () => {
    it("Default ambang adalah 3 menit jika env tidak didefinisikan", () => {
      expect(getSchedulerStaleMinutes()).toBe(3);
    });

    it("Membaca ambang dari env SCHEDULER_STALE_MINUTES", () => {
      process.env.SCHEDULER_STALE_MINUTES = "5";
      expect(getSchedulerStaleMinutes()).toBe(5);
    });

    it("Mengembalikan STALE jika last_tick lebih tua dari ambang", () => {
      process.env.SCHEDULER_STALE_MINUTES = "3";
      const fourMinutesAgo = new Date(baseNow.getTime() - 4 * 60_000);
      const condition = tickHealth(baseNow, fourMinutesAgo, 3);
      expect(condition).toBe("STALE");

      const twoMinutesAgo = new Date(baseNow.getTime() - 2 * 60_000);
      const freshCondition = tickHealth(baseNow, twoMinutesAgo, 3);
      expect(freshCondition).toBe("OK");
    });
  });

  describe("3. Uji Dead-Man Switch (HEARTBEAT_URL)", () => {
    it("Simulasi HEARTBEAT_URL timeout atau error 500 tidak menggagalkan fungsi tick()", async () => {
      process.env.HEARTBEAT_URL = "https://healthcheck.example.com/ping/test-uuid";

      // Berhasil dapat lock
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { name: "tick", locked_until: new Date(baseNow.getTime() + 55_000), holder: "tick-hb" },
      ]);

      // Mock global fetch untuk simulasi error 500
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

      const res = await tick(baseNow, "tick-hb");
      expect(res.skipped).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://healthcheck.example.com/ping/test-uuid",
        expect.objectContaining({ method: "GET" })
      );

      fetchSpy.mockRestore();
    });
  });
});

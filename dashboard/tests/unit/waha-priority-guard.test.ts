import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendHumanizedMessage,
  __resetHumanizerState,
  calculateWindowWaitMs,
  getWahaCircuitBreakerStatus,
  initWahaGuardFromPersistence,
} from "@/lib/waha/humanizer";
import { POST as resetGuardPOST } from "@/app/api/waha/guard/reset/route";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";
import { POST as wahaSendPOST } from "@/app/api/internal/waha/send/route";

const {
  prismaMock,
  recordEventMock,
  sendTextDirectMock,
  getSessionMock,
  authMock,
} = vi.hoisted(() => ({
  prismaMock: {
    authorizedNumber: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    customerSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    messageLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    runtimeFlag: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    systemEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    pipelineConfig: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock)),
  },
  recordEventMock: vi.fn(),
  sendTextDirectMock: vi.fn(),
  getSessionMock: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/waha/client", () => ({
  sendTextDirect: (...args: unknown[]) => sendTextDirectMock(...args),
  sendSeen: vi.fn().mockResolvedValue({}),
  startTyping: vi.fn().mockResolvedValue({}),
  stopTyping: vi.fn().mockResolvedValue({}),
}));

describe("S09: WAHA Priority Queue, Rate Limit Reservation, Breaker Persistence, and Debounce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetHumanizerState();
    recordEventMock.mockResolvedValue({});
    prismaMock.messageLog.count.mockResolvedValue(0);
    prismaMock.messageLog.create.mockResolvedValue({ id: "outbound-log" });
    authMock.mockReturnValue(true);
    getSessionMock.mockResolvedValue({ sub: "user-1", username: "admin" });

    // Mock authorized numbers & customer session
    prismaMock.authorizedNumber.findUnique.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+628123456789",
      chat_id: "628123456789@c.us",
      is_primary: true,
    });
    prismaMock.customerSession.findUnique.mockResolvedValue({
      id: "cust-1",
      phone_e164: "+628987654321",
      state: "ACTIVE",
      blocked_at: null,
    });

    sendTextDirectMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "msg-wa-123" }),
      status: 200,
    });

    process.env.WAHA_FAST_TEST = "1";
    process.env.WAHA_MOCK_OUTBOUND = "0";
  });

  describe("1. Uji Antrean Berbobot Prioritas", () => {
    it("Pesan P0 mendahului antrean pesan P2", async () => {
      const sendOrder: string[] = [];
      sendTextDirectMock.mockImplementation(async (chatId: string, text: string) => {
        sendOrder.push(text);
        return {
          ok: true,
          text: async () => JSON.stringify({ id: `msg-${Date.now()}` }),
          status: 200,
        };
      });

      // Buat antrean 3 pesan P2 (CUSTOMER_REPLY)
      // Buat antrean 2 pesan P2 (CUSTOMER_REPLY)
      const p2Promises = [
        sendHumanizedMessage({
          chatId: "628987654321@c.us",
          text: "P2-1",
          trigger: "CUSTOMER_REPLY",
          skipDelay: true,
        }),
        sendHumanizedMessage({
          chatId: "628987654321@c.us",
          text: "P2-2",
          trigger: "CUSTOMER_REPLY",
          skipDelay: true,
        }),
      ];

      // Sisipkan pesan P0 (TASK_ALARM)
      const p0Promise = sendHumanizedMessage({
        chatId: "628123456789@c.us",
        text: "P0-ALARM",
        trigger: "TASK_ALARM",
        skipDelay: true,
      });

      await Promise.all([...p2Promises, p0Promise]);

      // Pesan P0 harus terkirim mendahului P2-2 yang masih mengantre
      expect(sendOrder).toEqual(["P2-1", "P0-ALARM", "P2-2"]);
    });
  });

  describe("2. Uji Reservasi Kuota P0", () => {
    it("reserves the eighth minute slot for P0 and blocks P2", async () => {
      const now = Date.now();
      const pastTimestamps = Array.from({ length: 7 }, (_, index) => now - 35_000 + index * 4_000);
      __resetHumanizerState({ sentTimestamps: pastTimestamps });

      await expect(
        sendHumanizedMessage({
          chatId: "628987654321@c.us",
          text: "P2-Block",
          trigger: "CUSTOMER_REPLY",
          skipDelay: true,
        })
      ).rejects.toMatchObject({ code: "WAHA_RATE_LIMIT_BLOCKED", status: 429 });

      const p0Res = await sendHumanizedMessage({
        chatId: "628123456789@c.us",
        text: "P0-Allowed",
        trigger: "TASK_ALARM",
        skipDelay: true,
      });
      expect(p0Res.ok).toBe(true);
    });

    it.each([
      { count: 39, allowed: true },
      { count: 40, allowed: false },
    ])("enforces the per-customer hourly boundary at $count prior messages", async ({ count, allowed }) => {
      prismaMock.authorizedNumber.findUnique.mockResolvedValue(null);
      prismaMock.authorizedNumber.findFirst.mockResolvedValue(null);
      prismaMock.messageLog.count.mockResolvedValue(count);
      const sending = sendHumanizedMessage({
        chatId: "628987654321@c.us", text: "Balasan pelanggan", trigger: "CUSTOMER_REPLY", skipDelay: true,
        bypassRateCheck: true,
      });
      if (allowed) {
        await expect(sending).resolves.toMatchObject({ ok: true });
        expect(sendTextDirectMock).toHaveBeenCalledTimes(1);
      } else {
        await expect(sending).rejects.toMatchObject({ code: "CUSTOMER_HOURLY_LIMIT_BLOCKED", status: 429 });
        expect(sendTextDirectMock).not.toHaveBeenCalled();
      }
    });

    it("allows the sixtieth P0 message in an hour and blocks the next", async () => {
      __resetHumanizerState({ sentTimestamps: Array(59).fill(Date.now() - 120_000) });
      const options = { chatId: "628123456789@c.us", text: "Alarm owner", trigger: "TASK_ALARM" as const, skipDelay: true };
      await expect(sendHumanizedMessage(options)).resolves.toMatchObject({ ok: true });
      await expect(sendHumanizedMessage(options)).rejects.toMatchObject({ code: "WAHA_RATE_LIMIT_BLOCKED", status: 429 });
      expect(sendTextDirectMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      { offsets: [], trigger: "CUSTOMER_REPLY" as const, expected: 0 },
      { offsets: Array(7).fill(-59_000), trigger: "CUSTOMER_REPLY" as const, expected: 1001 },
      { offsets: Array(7).fill(-59_000), trigger: "TASK_ALARM" as const, expected: 0 },
      { offsets: [-59_000, ...Array(8).fill(-50_000)], trigger: "TASK_ALARM" as const, expected: 10_001 },
      { offsets: Array(55).fill(-3_500_000), trigger: "CUSTOMER_REPLY" as const, expected: 100_001 },
      { offsets: Array(55).fill(-3_500_000), trigger: "TASK_ALARM" as const, expected: 0 },
      { offsets: Array(60).fill(-3_500_000), trigger: "TASK_ALARM" as const, expected: 100_001 },
      { offsets: [...Array(55).fill(-3_500_000), ...Array(7).fill(-1000)], trigger: "CUSTOMER_REPLY" as const, expected: 100_001 },
      { offsets: [-3_600_001], trigger: "CUSTOMER_REPLY" as const, expected: 0 },
    ])("calculates the next free window for $trigger: $expected ms", ({ offsets, trigger, expected }) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
        __resetHumanizerState({ sentTimestamps: offsets.map((offset) => Date.now() + offset) });
        expect(calculateWindowWaitMs(trigger)).toBe(expected);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      { ageMs: 1000, waitMs: 59_001 },
      { ageMs: 59_000, waitMs: 5000 },
    ])("delivers a 202 background reply after $waitMs ms despite renewed saturation", async ({ ageMs, waitMs }) => {
      vi.useFakeTimers();
      try {
        __resetHumanizerState({ sentTimestamps: Array(7).fill(Date.now() - ageMs) });
        const response = await wahaSendPOST(new Request("http://localhost/api/internal/waha/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-botseri-fast-test": "1" },
          body: JSON.stringify({
            chat_id: "628987654321@c.us", body: "Formulir pesanan dari antrean",
            trigger_type: "CUSTOMER_REPLY", idempotency_key: "delayed-form", bypassRateCheck: true,
          }),
        }));
        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ ok: true, queued: true });
        await vi.advanceTimersByTimeAsync(waitMs - 1);
        expect(sendTextDirectMock).not.toHaveBeenCalled();
        __resetHumanizerState({ sentTimestamps: Array(7).fill(Date.now()) });
        await vi.advanceTimersByTimeAsync(1);
        expect(sendTextDirectMock).toHaveBeenCalledTimes(1);
        expect(sendTextDirectMock).toHaveBeenCalledWith(
          "628987654321@c.us", "Formulir pesanan dari antrean", undefined,
        );
        expect(prismaMock.messageLog.create).toHaveBeenCalledWith({
          data: {
            direction: "OUTBOUND", chat_id: "628987654321@c.us",
            body: "Formulir pesanan dari antrean", in_reply_to: "scheduler:delayed-form",
          },
        });
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it("returns the customer hourly error instead of accepting an unsendable background reply", async () => {
      vi.useFakeTimers();
      try {
        __resetHumanizerState({ sentTimestamps: Array(7).fill(Date.now()) });
        prismaMock.messageLog.count.mockResolvedValue(40);
        const response = await wahaSendPOST(new Request("http://localhost/api/internal/waha/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-botseri-fast-test": "1" },
          body: JSON.stringify({ chat_id: "628987654321@c.us", body: "Pesan dibatasi", trigger_type: "CUSTOMER_REPLY" }),
        }));
        expect(response.status).toBe(429);
        expect(await response.json()).toMatchObject({ code: "CUSTOMER_HOURLY_LIMIT_BLOCKED" });
        expect(vi.getTimerCount()).toBe(0);
        expect(sendTextDirectMock).not.toHaveBeenCalled();
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });
  });

  describe("3. Uji Pembersihan Pesan Basi (TTL 120s)", () => {
    it("Pesan P2 yang tertahan di antrean > 120 detik dibatalkan dan mencatat WAHA_QUEUE_EXPIRED", async () => {
      const now = Date.now();
      // Enqueue pesan P2 dengan waktu antre 125 detik yang lalu
      const res = await sendHumanizedMessage({
        chatId: "628987654321@c.us",
        text: "P2-Expired",
        trigger: "CUSTOMER_REPLY",
        skipDelay: true,
        enqueuedAt: now - 125_000,
      });

      expect(res.ok).toBe(false);
      expect((res as any).skipped).toBe(true);
      expect(recordEventMock).toHaveBeenCalledWith(
        "WARN",
        "waha.queue",
        "WAHA_QUEUE_EXPIRED",
        expect.any(Object)
      );
    });
  });

  describe("4. Uji Debounce Pelanggan pada Formulir Pesanan", () => {
    it("Dua gelembung chat berturut-turut (< 2s) pada AWAITING_ORDER menggabungkan draft dan menekan balasan duplikat", async () => {
      prismaMock.customerSession.findUnique.mockResolvedValue({
        id: "sess-order-1",
        phone_e164: "+628987654321",
        state: "AWAITING_ORDER",
        last_message_at: new Date(), // Pesan sebelumnya barusan (< 2 detik lalu)
        metadata: {
          draft: {
            nama_pemesan: "Siti Rahma",
          },
        },
      });

      const req = new Request("http://localhost:3000/api/internal/customer/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
        body: JSON.stringify({
          customer_phone: "+628987654321",
          message_text: "Alamat di Jl Merdeka no 5 Bandung",
          message_id: "msg-followup-2",
        }),
      });

      const res = await customerHandlePOST(req);
      const data = await res.json();

      expect(data.ok).toBe(true);
      // Balasan kedua ditekan (replies kosong) agar tidak mengirim 2 formulir beruntun
      expect(data.replies).toEqual([]);
      // Draft digabungkan
      expect(prismaMock.customerSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              draft: expect.objectContaining({
                nama_pemesan: "Siti Rahma",
              }),
            }),
          }),
        })
      );
    });
  });

  describe("5. Uji Persistensi Breaker", () => {
    it("Status cooldown tersimpan ke runtime_flags dan pulih saat re-init", async () => {
      const cooldownTime = Date.now() + 15 * 60_000;
      prismaMock.runtimeFlag.findUnique.mockResolvedValueOnce({
        key: "waha_circuit_breaker",
        value_json: {
          status: "COOLDOWN",
          cooldown_until: cooldownTime,
          consecutive_failures: 3,
        },
        updated_at: new Date(),
      });

      await initWahaGuardFromPersistence();

      const breakerStatus = getWahaCircuitBreakerStatus();
      expect(breakerStatus.status).toBe("COOLDOWN");
      expect(breakerStatus.consecutive_failures).toBe(3);
    });
  });

  describe("6. Uji Endpoint Reset Guard", () => {
    it("POST /api/waha/guard/reset mereset breaker dan mencatat event WAHA_GUARD_RESET", async () => {
      const req = new Request("http://localhost:3000/api/waha/guard/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
      });

      const res = await resetGuardPOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.status).toBe("NORMAL");

      expect(recordEventMock).toHaveBeenCalledWith(
        "INFO",
        "waha.guard",
        "WAHA_GUARD_RESET",
        expect.any(Object)
      );

      const statusAfter = getWahaCircuitBreakerStatus();
      expect(statusAfter.status).toBe("NORMAL");
    });
  });

  describe("7. Uji Kompatibilitas Runtime Node.js < 22 (Ponyfill Deferred Promise)", () => {
    it("sendHumanizedMessage berhasil mengeksekusi antrean meskipun Promise.withResolvers undefined", async () => {
      const originalWithResolvers = (Promise as unknown as Record<string, unknown>).withResolvers;
      try {
        delete (Promise as unknown as Record<string, unknown>).withResolvers;
        sendTextDirectMock.mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ id: "msg-123" }),
        });
        const res = await sendHumanizedMessage({
          chatId: "628123456789@c.us",
          text: "Uji coba kompatibilitas Node 20",
          trigger: "CHAT_MASUK",
          skipDelay: true,
        });

        expect(res.ok).toBe(true);
        expect(sendTextDirectMock).toHaveBeenCalledWith("628123456789@c.us", "Uji coba kompatibilitas Node 20", undefined);
      } finally {
        if (originalWithResolvers) {
          (Promise as unknown as Record<string, unknown>).withResolvers = originalWithResolvers;
        }
      }
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendHumanizedMessage,
  __resetHumanizerState,
  getWahaCircuitBreakerStatus,
  initWahaGuardFromPersistence,
} from "@/lib/waha/humanizer";
import { POST as resetGuardPOST } from "@/app/api/waha/guard/reset/route";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";

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
    it("Kuota slot ke-4 per menit hanya diizinkan untuk P0 dan menahan P2", async () => {
      // Simulasikan 3 pesan sudah terkirim dalam 60 detik terakhir
      const now = Date.now();
      const pastTimestamps = [now - 30_000, now - 20_000, now - 10_000];
      __resetHumanizerState({ sentTimestamps: pastTimestamps });

      // Pesan P2 berikutnya (ke-4 dalam menit ini) harus ditolak/dibatasi karena slot ke-4 direservasi untuk P0
      await expect(
        sendHumanizedMessage({
          chatId: "628987654321@c.us",
          text: "P2-Block",
          trigger: "CUSTOMER_REPLY",
          skipDelay: true,
        })
      ).rejects.toThrow(/Batas pengiriman pesan tercapai|WAHA_RATE_LIMIT_BLOCKED/);

      // Namun pesan P0 tetap diizinkan terkirim pada slot ke-4
      const p0Res = await sendHumanizedMessage({
        chatId: "628123456789@c.us",
        text: "P0-Allowed",
        trigger: "TASK_ALARM",
        skipDelay: true,
      });
      expect(p0Res.ok).toBe(true);
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
});

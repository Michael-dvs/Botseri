import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inboundAcceptPOST } from "@/app/api/internal/inbound/accept/route";
import { DELETE as orderDELETE } from "@/app/api/orders/[id]/route";
import { POST as wahaSendPOST } from "@/app/api/internal/waha/send/route";
import { HumanizerError } from "@/lib/waha/humanizer";

const {
  authMock,
  orderFindFirstMock,
  orderFindUniqueMock,
  orderUpdateMock,
  customerSessionFindUniqueMock,
  customerSessionFindManyMock,
  customerSessionUpdateMock,
  authorizedNumberFindFirstMock,
  authorizedNumberFindUniqueMock,
  sendHumanizedMessageMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  orderFindFirstMock: vi.fn(),
  orderFindUniqueMock: vi.fn(),
  orderUpdateMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  customerSessionFindManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  authorizedNumberFindFirstMock: vi.fn(),
  authorizedNumberFindUniqueMock: vi.fn(),
  sendHumanizedMessageMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/waha/humanizer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/waha/humanizer")>();
  return {
    ...actual,
    sendHumanizedMessage: (...args: unknown[]) => sendHumanizedMessageMock(...args),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirstMock(...args),
      findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
      update: (...args: unknown[]) => orderUpdateMock(...args),
    },
    customerSession: {
      findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
      findMany: (...args: unknown[]) => customerSessionFindManyMock(...args),
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
    },
    authorizedNumber: {
      findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
      findUnique: (...args: unknown[]) => authorizedNumberFindUniqueMock(...args),
    },
    botSettings: {
      findUnique: vi.fn().mockResolvedValue({ setup_completed: true, bot_enabled: true }),
    },
    pipelineConfig: {
      findUnique: vi.fn().mockResolvedValue({
        id: "active-pipeline",
        config: {
          inbound_gate: {
            enabled: true,
            allow_unregistered_customers: true,
            ignore_groups: true,
            mute_bot_on_active_order: true,
          },
        },
      }),
    },
    messageLog: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "msg-log-created" }),
    },
  },
}));

describe("Verifikasi Outbound 429 Queue, Mute Bypass Keyword (MENU/BARU), & Soft-Delete Order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    authorizedNumberFindUniqueMock.mockResolvedValue(null);
  });

  describe("Bagian 1: Pembisuan Ketat Saat Pesanan Aktif (Strict Bot Muting)", () => {
    it("Pelanggan yang memiliki pesanan aktif mengirim 'halo', 'menu', atau 'bisa kirim jam 2?' SELALU ditolak (accept: false)", async () => {
      orderFindFirstMock.mockResolvedValue({
        id: "order-active-1",
        customer_name: "Budi",
        created_at: new Date(),
        status: "PENDING",
      });

      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-cust-1",
        phone_e164: "+628123456789",
        state: "PAUSED_FOR_OWNER",
        paused_at: new Date(),
        metadata: {},
      });
      customerSessionUpdateMock.mockResolvedValue({});

      // 1. Uji pesan sapaan "halo"
      const reqHalo = new Request("http://localhost:3000/api/internal/inbound/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_message_id: "msg-halo-muted",
          chat_id: "628123456789@c.us",
          from: "628123456789@c.us",
          from_me: false,
          body: "halo kak",
          received_at: new Date().toISOString(),
        }),
      });
      const resHalo = await inboundAcceptPOST(reqHalo);
      expect(resHalo.status).toBe(200);
      const dataHalo = await resHalo.json();
      expect(dataHalo.accept).toBe(false);
      expect(dataHalo.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");

      // 2. Uji pesan "MENU"
      const reqMenu = new Request("http://localhost:3000/api/internal/inbound/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_message_id: "msg-menu-muted",
          chat_id: "628123456789@c.us",
          from: "628123456789@c.us",
          from_me: false,
          body: "MENU",
          received_at: new Date().toISOString(),
        }),
      });
      const resMenu = await inboundAcceptPOST(reqMenu);
      const dataMenu = await resMenu.json();
      expect(dataMenu.accept).toBe(false);
      expect(dataMenu.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");

      // 3. Uji pesan tanya jadwal "bisa kirim jam 2?"
      const reqTanya = new Request("http://localhost:3000/api/internal/inbound/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_message_id: "msg-tanya-muted",
          chat_id: "628123456789@c.us",
          from: "628123456789@c.us",
          from_me: false,
          body: "bisa kirim jam 2?",
          received_at: new Date().toISOString(),
        }),
      });
      const resTanya = await inboundAcceptPOST(reqTanya);
      const dataTanya = await resTanya.json();
      expect(dataTanya.accept).toBe(false);
      expect(dataTanya.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");
    });

    it("Setelah pesanan selesai atau dihapus, pesan 'halo' berikutnya dari pelanggan DITERIMA (accept: true)", async () => {
      // Tidak ada pesanan aktif
      orderFindFirstMock.mockResolvedValue(null);

      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-cust-unmuted",
        phone_e164: "+628123456789",
        state: "ACTIVE",
        paused_at: null,
        metadata: {},
      });

      const req = new Request("http://localhost:3000/api/internal/inbound/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_message_id: "msg-post-order-chat",
          chat_id: "628123456789@c.us",
          from: "628123456789@c.us",
          from_me: false,
          body: "halo",
          received_at: new Date().toISOString(),
        }),
      });

      const res = await inboundAcceptPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.accept).toBe(true);
      expect(data.role).toBe("CUSTOMER");
    });
  });

  describe("Bagian 2: Soft Delete Order & Auto-Unmute Session", () => {
    it("Memanggil DELETE /api/orders/[id] mengisi deleted_at dan mengembalikan state sesi pelanggan ke unmuted", async () => {
      orderFindFirstMock.mockResolvedValue(null);
      const orderId = "c2a233e7-3803-4613-ba14-2e9154f24f5a";
      orderFindUniqueMock.mockResolvedValue({
        id: orderId,
        customer_name: "Doni",
        customer_chat_id: "628123456789@c.us",
        customer_contact: "+628123456789",
        deleted_at: null,
        status: "PENDING",
      });

      orderUpdateMock.mockResolvedValue({
        id: orderId,
        customer_chat_id: "628123456789@c.us",
        customer_contact: "+628123456789",
        status: "CANCELLED",
        deleted_at: new Date(),
      });

      customerSessionFindManyMock.mockResolvedValue([
        {
          id: "sess-doni",
          phone_e164: "+628123456789",
          state: "PAUSED_FOR_OWNER",
          metadata: { draft: null },
        },
      ]);
      customerSessionUpdateMock.mockResolvedValue({});

      const req = new Request(`http://localhost:3000/api/orders/${orderId}`, {
        method: "DELETE",
      });

      const res = await orderDELETE(req, { params: { id: orderId } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toContain("Pesanan berhasil dihapus dan sesi pelanggan telah dibuka");

      expect(orderUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: orderId },
          data: expect.objectContaining({
            status: "CANCELLED",
            deleted_at: expect.any(Date),
          }),
        })
      );

      expect(customerSessionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sess-doni" },
          data: expect.objectContaining({
            state: "ACTIVE",
            paused_at: null,
          }),
        })
      );
    });
  });

  describe("Bagian 3: Antrean Tunda Outbound 429 pada waha/send", () => {
    it("Ketika pengiriman balasan bot terkena rate limit 429, waha/send mengembalikan HTTP 202 Accepted tanpa error 429", async () => {
      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-waha-send",
        phone_e164: "+628123456789",
      });

      sendHumanizedMessageMock.mockRejectedValue(
        new HumanizerError("WAHA_RATE_LIMIT_BLOCKED", 429, "Batas pengiriman pesan tercapai")
      );

      const req = new Request("http://localhost:3000/api/internal/waha/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: "628123456789@c.us",
          phone_e164: "+628123456789",
          body: "Pesan balasan bot ke pelanggan",
          trigger_type: "CUSTOMER_REPLY",
        }),
      });

      const res = await wahaSendPOST(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.queued).toBe(true);
      expect(data.warning).toBe("OUTBOUND_RATE_LIMIT_DELAYED");
    });
  });
});

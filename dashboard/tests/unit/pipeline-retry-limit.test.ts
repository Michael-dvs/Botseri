import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPipelineStep } from "@/lib/pipeline/engine";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";
import { POST as inboundAcceptPOST } from "@/app/api/internal/inbound/accept/route";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import type { PipelineConfigData, PipelineGraph } from "@/lib/pipeline/schema";

const {
  authMock,
  customerSessionFindUniqueMock,
  customerSessionUpdateManyMock,
  customerSessionUpdateMock,
  pipelineConfigFindUniqueMock,
  authorizedNumberFindFirstMock,
  orderFindFirstMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
  authorizedNumberFindFirstMock: vi.fn(),
  orderFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customerSession: {
      findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
    },
    pipelineConfig: {
      findUnique: (...args: unknown[]) => pipelineConfigFindUniqueMock(...args),
    },
    authorizedNumber: {
      findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
    },
    order: {
      findFirst: (...args: unknown[]) => orderFindFirstMock(...args),
    },
    botSettings: {
      findUnique: vi.fn().mockResolvedValue({ setup_completed: true, bot_enabled: true }),
    },
    messageLog: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "msg-log-1" }),
    },
  },
}));

describe("Aturan 3 Kali Kesempatan (3-Strike Fallback Rule & Auto-Handover to Minri)", () => {
  const testGraph: PipelineGraph = {
    nodes: [
      { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
      { id: "node-greeting", type: "MESSAGE_MENU", position: { x: 100, y: 0 }, data: { greeting_text: "Halo Kak! Selamat datang di Berseri." } },
      {
        id: "node-router",
        type: "CONDITION_ROUTER",
        position: { x: 200, y: 0 },
        data: {
          branches: [
            { id: "branch_1", label: "Pilihan 1: Order", keywords: ["1", "pesan", "order"] },
            { id: "branch_2", label: "Pilihan 2: Tanya CS", keywords: ["2", "tanya", "cs"] },
            { id: "branch_3", label: "Pilihan 3: Katalog", keywords: ["3", "katalog", "menu"] },
          ],
        },
      },
      { id: "node-form", type: "ORDER_FORM_PROCESSOR", position: { x: 300, y: -50 }, data: { form_template_text: "*FORMAT PESANAN BERSERI*\n* Nama Pemesan:" } },
      { id: "node-handover", type: "CS_HANDOVER", position: { x: 300, y: 50 }, data: { handover_customer_text: "Siap Kak! Pertanyaan sudah kami sampaikan ke Minri." } },
      {
        id: "node-katalog",
        type: "MESSAGE_MENU",
        position: { x: 300, y: 150 },
        data: { message_text: "Berikut link katalog kami: https://berseri.id/katalog" },
      },
    ],
    edges: [
      { id: "e-trig-greet", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
      { id: "e-greet-router", source: "node-greeting", target: "node-router", sourceHandle: "out_next" },
      { id: "e-router-b1", source: "node-router", target: "node-form", sourceHandle: "branch_1" },
      { id: "e-router-b2", source: "node-router", target: "node-handover", sourceHandle: "branch_2" },
      { id: "e-router-b3", source: "node-router", target: "node-katalog", sourceHandle: "branch_3" },
    ],
  };

  const testConfig: PipelineConfigData = {
    ...FLORIST_DECOR_PRESET,
    graph: testGraph,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: "active-pipeline",
      config: testConfig,
      is_active: true,
      version: 1,
    });
    authorizedNumberFindFirstMock.mockImplementation((args?: { where?: Record<string, unknown> }) => {
      if (args?.where?.is_owner && args?.where?.is_primary) {
        return Promise.resolve({
          phone_e164: "+6289699898458",
          chat_id: "6289699898458@c.us",
          is_owner: true,
          is_primary: true,
        });
      }
      return Promise.resolve(null);
    });
    orderFindFirstMock.mockResolvedValue(null);
  });

  describe("Bagian 1: Logika Murni Engine (runPipelineStep)", () => {
    it("Kesalahan 1: input salah pertama menaikkan retryCount ke 1 dan memberi info Kesempatan 1/3", () => {
      const res = runPipelineStep(
        {
          config: testConfig,
          sessionState: "AWAITING_CHOICE",
          currentRouterId: "node-router",
          retryCount: 0,
          customerPhone: "+628123456789",
        },
        { text: "4" }
      );

      expect(res.nextState).toBe("AWAITING_CHOICE");
      expect(res.replies[0]).toContain("Kesempatan 1/3");
      const updateAction = res.actions.find((a) => a.type === "UPDATE_SESSION");
      expect(updateAction?.retryCount).toBe(1);
    });

    it("Kesalahan 2: input salah kedua menaikkan retryCount ke 2 dan memberi info Kesempatan 2/3", () => {
      const res = runPipelineStep(
        {
          config: testConfig,
          sessionState: "AWAITING_CHOICE",
          currentRouterId: "node-router",
          retryCount: 1,
          customerPhone: "+628123456789",
        },
        { text: "halo min" }
      );

      expect(res.nextState).toBe("AWAITING_CHOICE");
      expect(res.replies[0]).toContain("Kesempatan 2/3");
      const updateAction = res.actions.find((a) => a.type === "UPDATE_SESSION");
      expect(updateAction?.retryCount).toBe(2);
    });

    it("Kesalahan 3: input salah ketiga mengalihkan state ke PAUSED_FOR_OWNER dan memicu alert Minri", () => {
      const res = runPipelineStep(
        {
          config: testConfig,
          sessionState: "AWAITING_CHOICE",
          currentRouterId: "node-router",
          retryCount: 2,
          customerPhone: "+628123456789",
        },
        { text: "test spam 4" }
      );

      expect(res.nextState).toBe("PAUSED_FOR_OWNER");
      expect(res.replies).toHaveLength(2);
      expect(res.replies[0]).toContain("kami teruskan langsung ke Minri");
      expect(res.replies[1]).toContain("Pemberitahuan: Bantuan Pelanggan");
      const updateAction = res.actions.find((a) => a.type === "UPDATE_SESSION");
      expect(updateAction?.nextState).toBe("PAUSED_FOR_OWNER");
      expect(updateAction?.retryCount).toBe(0);
    });

    it("Reset: input benar pada percobaan kedua me-reset retryCount ke 0", () => {
      const res = runPipelineStep(
        {
          config: testConfig,
          sessionState: "AWAITING_CHOICE",
          currentRouterId: "node-router",
          retryCount: 1,
          customerPhone: "+628123456789",
        },
        { text: "1" }
      );

      expect(res.nextState).toBe("AWAITING_ORDER");
      const updateAction = res.actions.find((a) => a.type === "UPDATE_SESSION");
      expect(updateAction?.retryCount).toBe(0);
    });
  });

  describe("Bagian 2: Endpoint Handler Rute (customer/handle)", () => {
    it("Kesalahan 1 & 2 di rute customer/handle memperbarui metadata.retry_count dan bertahan di AWAITING_CHOICE", async () => {
      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-retry-1",
        phone_e164: "+628123456789",
        state: "AWAITING_CHOICE",
        metadata: { retry_count: 0, current_router_id: "node-router" },
      });
      customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

      const req = new Request("http://localhost:3000/api/internal/customer/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_phone: "+628123456789",
          message_text: "pilihan salah",
          message_id: "msg-err-1",
        }),
      });

      const res = await customerHandlePOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.state_after).toBe("AWAITING_CHOICE");
      expect(data.replies[0].text).toContain("Kesempatan 1/3");

      expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sess-retry-1", state: "AWAITING_CHOICE" },
          data: expect.objectContaining({
            state: "AWAITING_CHOICE",
            metadata: expect.objectContaining({ retry_count: 1 }),
          }),
        })
      );
    });

    it("Kesalahan 3 di rute customer/handle mengubah state ke PAUSED_FOR_OWNER dan mengirim 2 pesan (pelanggan + Minri)", async () => {
      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-retry-3",
        phone_e164: "+628123456789",
        state: "AWAITING_CHOICE",
        metadata: { retry_count: 2, current_router_id: "node-router" },
      });
      customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

      const req = new Request("http://localhost:3000/api/internal/customer/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_phone: "+628123456789",
          message_text: "salah lagi ketiga kali",
          message_id: "msg-err-3",
        }),
      });

      const res = await customerHandlePOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.state_after).toBe("PAUSED_FOR_OWNER");
      expect(data.replies).toHaveLength(2);
      expect(data.replies[0].text).toContain("kami teruskan langsung ke Minri");
      expect(data.replies[1].text).toContain("Pemberitahuan: Bantuan Pelanggan");
      expect(data.replies[1].trigger_type).toBe("OWNER_DIGEST");

      expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sess-retry-3", state: "AWAITING_CHOICE" },
          data: expect.objectContaining({
            state: "PAUSED_FOR_OWNER",
            paused_at: expect.any(Date),
            metadata: expect.objectContaining({ retry_count: 0 }),
          }),
        })
      );
    });

    it("Uji Reset di customer/handle: input 3 (Katalog) me-reset retry_count ke 0", async () => {
      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-retry-reset",
        phone_e164: "+628123456789",
        state: "AWAITING_CHOICE",
        metadata: { retry_count: 1, current_router_id: "node-router" },
      });
      customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

      const req = new Request("http://localhost:3000/api/internal/customer/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_phone: "+628123456789",
          message_text: "3",
          message_id: "msg-reset-1",
        }),
      });

      const res = await customerHandlePOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.state_after).toBe("AWAITING_CHOICE");
      expect(data.replies[0].text).toContain("https://berseri.id/katalog");

      expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sess-retry-reset", state: "AWAITING_CHOICE" },
          data: expect.objectContaining({
            state: "AWAITING_CHOICE",
            metadata: expect.objectContaining({ retry_count: 0 }),
          }),
        })
      );
    });
  });

  describe("Bagian 3: Perlindungan Inbound Gate (inbound/accept)", () => {
    it("menolak pesan lanjutan saat status sesi PAUSED_FOR_OWNER dengan reason SESSION_PAUSED_FOR_MANUAL_OWNER", async () => {
      customerSessionFindUniqueMock.mockResolvedValue({
        id: "sess-paused-guard",
        phone_e164: "+628123456789",
        state: "PAUSED_FOR_OWNER",
        paused_at: new Date(Date.now() - 5 * 60 * 1000), // 5 menit yang lalu
        metadata: { retry_count: 0, waiting_since: new Date().toISOString() },
      });
      customerSessionUpdateMock.mockResolvedValue({});

      const req = new Request("http://localhost:3000/api/internal/inbound/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_message_id: "msg-spam-while-paused",
          chat_id: "628123456789@c.us",
          from: "628123456789@c.us",
          from_me: false,
          body: "halo p p p",
          received_at: new Date().toISOString(),
        }),
      });

      const res = await inboundAcceptPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.accept).toBe(false);
      expect(data.reason).toBe("SESSION_PAUSED_FOR_MANUAL_OWNER");
    });
  });
});

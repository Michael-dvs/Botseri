import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeChainedCustomNodes } from "@/lib/pipeline/graph-runner";
import { projectCoreConfig } from "@/lib/pipeline/projector";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";
import type { PipelineGraph } from "@/lib/pipeline/schema";

const {
  authMock,
  customerSessionFindUniqueMock,
  customerSessionUpdateMock,
  customerSessionUpdateManyMock,
  customerSessionCreateMock,
  pipelineConfigFindUniqueMock,
  recordEventMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  customerSessionCreateMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customerSession: {
      findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
      updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
      create: (...args: unknown[]) => customerSessionCreateMock(...args),
    },
    pipelineConfig: {
      findUnique: (...args: unknown[]) => pipelineConfigFindUniqueMock(...args),
    },
    authorizedNumber: {
      findFirst: vi.fn().mockResolvedValue({ phone_e164: "+6281234567890", is_primary: true }),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      customerSession: {
        updateMany: customerSessionUpdateManyMock,
        update: customerSessionUpdateMock,
      },
    })),
  },
}));

describe("S06: Pipeline Runtime Safety (Cycle Guard, Depth Limit & Stale Pointer Recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    recordEventMock.mockResolvedValue({});
    customerSessionUpdateMock.mockResolvedValue({});
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Operasional Berseri",
      preset_key: "FLORIST_DECOR",
      version: 1,
      config_json: FLORIST_DECOR_PRESET,
    });
  });

  function makeHandleRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/internal/customer/handle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify(body),
    });
  }

  it("1. Rantai 4 node kustom beruntun terpotong tepat pada kedalaman ke-3 dan mencatat PIPELINE_CYCLE_GUARD", () => {
    const chainedGraph: PipelineGraph = {
      nodes: [
        { id: "node-router", type: "CONDITION_ROUTER", position: { x: 0, y: 0 }, data: {} },
        { id: "reply-1", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "Pesan 1" } },
        { id: "reply-2", type: "CUSTOM_WA_REPLY", position: { x: 200, y: 0 }, data: { message_template: "Pesan 2" } },
        { id: "reply-3", type: "CUSTOM_WA_REPLY", position: { x: 300, y: 0 }, data: { message_template: "Pesan 3" } },
        { id: "reply-4", type: "CUSTOM_WA_REPLY", position: { x: 400, y: 0 }, data: { message_template: "Pesan 4" } },
      ],
      edges: [
        { id: "e1", source: "node-router", target: "reply-1", sourceHandle: "branch_custom" },
        { id: "e2", source: "reply-1", target: "reply-2", sourceHandle: "out_next" },
        { id: "e3", source: "reply-2", target: "reply-3", sourceHandle: "out_next" },
        { id: "e4", source: "reply-3", target: "reply-4", sourceHandle: "out_next" },
      ],
    };

    const replies = executeChainedCustomNodes(
      "node-router",
      "branch_custom",
      chainedGraph,
      { customer_phone: "+628123456789" },
      3
    );

    // Harus terpotong tepat di kedalaman 3 (hanya 3 pesan yang dihasilkan)
    expect(replies.length).toBe(3);
    expect(replies.map((r) => r.text)).toEqual(["Pesan 1", "Pesan 2", "Pesan 3"]);
    expect(recordEventMock).toHaveBeenCalledWith(
      "WARN",
      "pipeline_runtime",
      "PIPELINE_CYCLE_GUARD",
      expect.objectContaining({
        reason: "CHAIN_DEPTH_EXCEEDED",
        max_depth: 3,
      })
    );
  });

  it("2. Runtime cycle guard memotong rantai melingkar dan mencatat PIPELINE_CYCLE_GUARD", () => {
    const cyclicRuntimeGraph: PipelineGraph = {
      nodes: [
        { id: "node-router", type: "CONDITION_ROUTER", position: { x: 0, y: 0 }, data: {} },
        { id: "reply-a", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "Pesan A" } },
        { id: "reply-b", type: "CUSTOM_WA_REPLY", position: { x: 200, y: 0 }, data: { message_template: "Pesan B" } },
      ],
      edges: [
        { id: "e1", source: "node-router", target: "reply-a", sourceHandle: "branch_custom" },
        { id: "e2", source: "reply-a", target: "reply-b", sourceHandle: "out_next" },
        { id: "e3", source: "reply-b", target: "reply-a", sourceHandle: "out_next" }, // SIKLUS: A -> B -> A
      ],
    };

    const replies = executeChainedCustomNodes(
      "node-router",
      "branch_custom",
      cyclicRuntimeGraph,
      { customer_phone: "+628123456789" },
      3
    );

    // Harus berhenti setelah mendeteksi node yang sudah dikunjungi
    expect(replies.length).toBe(2);
    expect(replies.map((r) => r.text)).toEqual(["Pesan A", "Pesan B"]);
    expect(recordEventMock).toHaveBeenCalledWith(
      "WARN",
      "pipeline_runtime",
      "PIPELINE_CYCLE_GUARD",
      expect.objectContaining({
        reason: "CYCLE_DETECTED",
        cycle_node_id: "reply-a",
      })
    );
  });

  it("3. Pointer current_router_id basi tidak membisukan bot, melainkan reset ke router akar dan mencatat PIPELINE_POINTER_STALE", async () => {
    // Sesi pelanggan memiliki current_router_id yang menunjuk ke ID yang tidak ada di graf
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-123",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      paused_at: null,
      metadata: {
        current_router_id: "deleted-custom-router-999",
      },
      last_message_at: new Date(),
    });

    const res = await customerHandlePOST(makeHandleRequest({
      customer_phone: "+628123456789",
      message_text: "1",
      message_id: "msg-1",
      from_me: false,
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // Bot tidak membisu: berhasil memproses pilihan "1" menjadi formulir pemesanan
    expect(data.state_after).toBe("AWAITING_ORDER");
    expect(data.replies.length).toBeGreaterThan(0);

    // Event PIPELINE_POINTER_STALE tercatat
    expect(recordEventMock).toHaveBeenCalledWith(
      "WARN",
      "customer_session",
      "PIPELINE_POINTER_STALE",
      expect.objectContaining({
        phone_e164: "+628123456789",
        stale_router_id: "deleted-custom-router-999",
      })
    );

    // Database diupdate untuk membersihkan pointer basi
    expect(customerSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-123" },
        data: expect.objectContaining({
          metadata: expect.not.objectContaining({
            current_router_id: "deleted-custom-router-999",
          }),
        }),
      })
    );
  });

  it("4. projectCoreConfig menurunkan 6 kontainer inti secara murni dari node visual graf", () => {
    const customGraph: PipelineGraph = {
      nodes: [
        {
          id: "node-trigger",
          type: "TRIGGER_INBOUND",
          position: { x: 0, y: 0 },
          data: {
            rate_limit_per_minute: 45,
            mute_max_hours: 72,
          },
        },
        {
          id: "node-greeting",
          type: "MESSAGE_MENU",
          position: { x: 100, y: 0 },
          data: {
            message_text: "Halo Kak! Ini sapaan kustom dari node visual.",
          },
        },
        {
          id: "custom-menu-sub",
          type: "MESSAGE_MENU",
          position: { x: 300, y: 0 },
          data: {
            message_text: "Lihat katalog lengkap di drive.google.com/test", // Sub-menu tidak boleh menimpa sapaan utama
          },
        },
      ],
      edges: [
        { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
      ],
    };

    const projected = projectCoreConfig(customGraph, FLORIST_DECOR_PRESET);

    expect(projected.inbound_gate.rate_limit_per_minute).toBe(45);
    expect(projected.inbound_gate.mute_max_hours).toBe(72);
    expect(projected.customer_greeting.greeting_text).toBe("Halo Kak! Ini sapaan kustom dari node visual.");
    // Memastikan sub-menu tidak mengontaminasi sapaan utama
    expect(projected.customer_greeting.greeting_text).not.toContain("drive.google.com");
  });
});

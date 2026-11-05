import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPipelineStep } from "@/lib/pipeline/engine";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import type { PipelineConfigData, PipelineGraph } from "@/lib/pipeline/schema";

const {
  authMock,
  customerSessionFindUniqueMock,
  customerSessionUpdateManyMock,
  pipelineConfigFindUniqueMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customerSession: {
      findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
    },
    pipelineConfig: {
      findUnique: (...args: unknown[]) => pipelineConfigFindUniqueMock(...args),
    },
  },
}));

describe("Pipeline Router Resolution, Self-Healing, & Fallback Handler", () => {
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
            { id: "branch_1", label: "Pilihan 1 · Order", keywords: ["1", "pesan", "order"] },
            { id: "branch_2", label: "Pilihan 2 · Tanya CS", keywords: ["2", "tanya", "cs"] },
            { id: "branch_3", label: "Pilihan 3 · Katalog", keywords: ["3", "katalog", "menu"] },
          ],
          // Port fallback sengaja tidak diisi agar menguji fallback default
        },
      },
      { id: "node-form", type: "ORDER_FORM_PROCESSOR", position: { x: 300, y: -50 }, data: { form_template_text: "*FORMAT PESANAN BERSERI*\n* Nama Pemesan:" } },
      { id: "node-handover", type: "CS_HANDOVER", position: { x: 300, y: 50 }, data: { handover_customer_text: "Siap Kak! Pertanyaan sudah kami sampaikan ke Owner." } },
      {
        id: "node-menu-katalog",
        type: "MESSAGE_MENU",
        position: { x: 300, y: 150 },
        data: {
          label: "Menu / Sapaan Baru",
          message_text: "Silakan cek katalog lengkap kami di https://berseri.id/katalog ya Kak!\n1. Pesan Buket\n2. Tanya Admin",
        },
      },
      {
        id: "node-router-katalog",
        type: "CONDITION_ROUTER",
        position: { x: 450, y: 150 },
        data: {
          label: "Router Katalog",
          branches: [
            { id: "branch_1", label: "Pesan Buket", keywords: ["1", "buket"] },
            { id: "branch_2", label: "Tanya CS", keywords: ["2", "tanya"] },
          ],
        },
      },
    ],
    edges: [
      { id: "e-trig", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
      { id: "e-greet", source: "node-greeting", target: "node-router", sourceHandle: "out_next" },
      { id: "e-b1", source: "node-router", target: "node-form", sourceHandle: "branch_1" },
      { id: "e-b2", source: "node-router", target: "node-handover", sourceHandle: "branch_2" },
      { id: "e-b3", source: "node-router", target: "node-menu-katalog", sourceHandle: "branch_3" },
      { id: "e-sub", source: "node-menu-katalog", target: "node-router-katalog", sourceHandle: "out_next" },
      { id: "e-sub-b1", source: "node-router-katalog", target: "node-form", sourceHandle: "branch_1" },
      { id: "e-sub-b2", source: "node-router-katalog", target: "node-handover", sourceHandle: "branch_2" },
    ],
  };

  const testConfig: PipelineConfigData = {
    ...FLORIST_DECOR_PRESET,
    graph: testGraph,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Resolution Test",
      preset_key: "FLORIST_DECOR",
      config_json: testConfig,
      version: 1,
    });
  });

  function makeRequest(body: Record<string, unknown>) {
    return new Request("http://localhost:3000/api/internal/customer/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("1. Uji Transisi INIT: Menyimpan initialRouterId ke metadata.current_router_id", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-init-1",
      phone_e164: "+628123456789",
      state: "INIT",
      metadata: null,
      customer_name: "Budi",
    });

    const res = await customerHandlePOST(
      makeRequest({
        customer_phone: "+628123456789",
        message_text: "Halo",
        message_id: "msg-init-1",
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies[0].text).toContain("Selamat datang di Berseri");

    // Pastikan metadata sesi menyimpan current_router_id = "node-router"
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_CHOICE",
          metadata: expect.objectContaining({
            current_router_id: "node-router",
          }),
        }),
      })
    );
  });

  it("2. Uji Self-Healing Router: Panggilan alur dengan current_router_id kosong otomatis memulihkan router utama", () => {
    // Sesi berada di AWAITING_CHOICE namun currentRouterId null/undefined
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: null,
      },
      { text: "1" }
    );

    // Otomatis mengenali router utama dan mengeksekusi Cabang 1 (Order Form)
    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.replies[0]).toContain("FORMAT PESANAN BERSERI");
    expect(res.actions.length).toBeGreaterThan(0);
  });

  it("3. Uji Pilihan 1: Input '1' mengalir ke formulir order (bukan sapaan awal)", () => {
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-router",
      },
      { text: "1" }
    );

    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.replies[0]).toContain("FORMAT PESANAN BERSERI");
    expect(res.replies[0]).not.toContain("Halo Kak! Selamat datang");
  });

  it("4. Uji Pilihan 3: Input '3' menghasilkan teks katalog dan mengalirkan ke router katalog turunan", () => {
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-router",
      },
      { text: "3" }
    );

    expect(res.nextState).toBe("AWAITING_CHOICE");
    expect(res.nextRouterId).toBe("node-router-katalog");
    expect(res.replies[0]).toContain("https://berseri.id/katalog");
  });

  it("5. Uji Pilihan 1 Pasca-Katalog: Input '1' di router katalog mengalir ke Formulir Order", () => {
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-router-katalog",
      },
      { text: "1" }
    );

    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.replies[0]).toContain("FORMAT PESANAN BERSERI");
    expect(res.replies[0]).not.toContain("Halo Kak! Selamat datang");
  });

  it("6. Uji Input Salah: Input '4' menghasilkan pesan penolakan format dan tidak me-reset sesi ke sapaan awal", () => {
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-router",
      },
      { text: "4" }
    );

    expect(res.nextState).toBe("AWAITING_CHOICE");
    expect(res.nextRouterId).toBe("node-router");
    expect(res.replies[0]).toContain("pilihan belum sesuai format");
    expect(res.replies[0]).toContain("1, 2, atau 3");
    expect(res.replies[0]).not.toContain("Selamat datang di Berseri");
  });

  it("7. Uji Input Acak via Handler: Input '4' di AWAITING_CHOICE mengembalikan HTTP 200 dengan balasan fallback", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-choice-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      metadata: { current_router_id: "node-router", retry_count: 0 },
      customer_name: "Budi",
    });

    const res = await customerHandlePOST(
      makeRequest({
        customer_phone: "+628123456789",
        message_text: "4",
        message_id: "msg-invalid-4",
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toContain("pilihan belum sesuai format");
    expect(data.replies[0].text).toContain("1, 2, atau 3");

    // Pastikan router aktif dipertahankan
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_CHOICE",
          metadata: expect.objectContaining({
            current_router_id: "node-router",
            retry_count: 1,
          }),
        }),
      })
    );
  });
});

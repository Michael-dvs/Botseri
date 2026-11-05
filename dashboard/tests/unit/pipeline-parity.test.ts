import { describe, expect, it } from "vitest";
import { runPipelineStep } from "@/lib/pipeline/engine";
import { simulatePipelineExecution } from "@/lib/pipeline/simulator";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";
import type { PipelineConfigData, PipelineGraph } from "@/lib/pipeline/schema";
import type { CustomerSessionState } from "@prisma/client";

describe("S10: 20 Skenario Uji Paritas Pipeline Simulator vs Runtime", () => {
  // Preset alur kerja visual dengan sub-router dan cabang kustom
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
            { id: "branch_1", label: "Pesan", keywords: ["1", "pesan", "order", "beli"] },
            { id: "branch_2", label: "Tanya", keywords: ["2", "tanya", "konsultasi", "admin"] },
            { id: "branch_3", label: "Katalog", keywords: ["3", "katalog", "pricelist", "menu"] },
          ],
          fallback_reply_text: "Mohon maaf Kak, balas 1 untuk pesan atau 2 untuk tanya.",
        },
      },
      { id: "node-form", type: "ORDER_FORM_PROCESSOR", position: { x: 300, y: -50 }, data: { form_template_text: "*FORMAT PESANAN BERSERI*\n* Nama Pemesan:\n* Jenis Pesanan:\n* Tanggal Acara:\n* Alamat:" } },
      { id: "node-handover", type: "CS_HANDOVER", position: { x: 300, y: 50 }, data: { handover_customer_text: "Siap Kak! Bot kami jeda agar Owner dapat membalas langsung." } },
      { id: "node-reply-katalog", type: "CUSTOM_WA_REPLY", position: { x: 300, y: 150 }, data: { message_template: "Katalog lengkap dapat dilihat di https://berseri.id/katalog" } },
      {
        id: "node-sub-router",
        type: "CONDITION_ROUTER",
        position: { x: 450, y: 150 },
        data: {
          label: "Sub Menu Katalog",
          branches: [
            { id: "branch_sub_1", label: "Buket", keywords: ["buket", "bouquet"] },
            { id: "branch_sub_2", label: "Dekor", keywords: ["dekor", "dekorasi"] },
          ],
          fallback_reply_text: "Ketik 'buket' atau 'dekor' untuk info lebih detail.",
        },
      },
      { id: "node-reply-buket", type: "CUSTOM_WA_REPLY", position: { x: 600, y: 100 }, data: { message_template: "Pilihan Buket Mawar mulai Rp 150rb." } },
      { id: "node-reply-dekor", type: "CUSTOM_WA_REPLY", position: { x: 600, y: 200 }, data: { message_template: "Pilihan Dekorasi Lamaran mulai Rp 2jt." } },
      { id: "node-fulfillment", type: "ORDER_FULFILLMENT", position: { x: 500, y: -50 }, data: { customer_confirmation_template: "Yeay, pesanan tercatat! No Pesanan: {{order_id}}" } },
      { id: "node-owner-agent", type: "OWNER_AI_AGENT", position: { x: 100, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e-trig-cust", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
      { id: "e-trig-owner", source: "node-trigger", target: "node-owner-agent", sourceHandle: "out_owner" },
      { id: "e-greet-router", source: "node-greeting", target: "node-router", sourceHandle: "out_next" },
      { id: "e-r-b1", source: "node-router", target: "node-form", sourceHandle: "branch_1" },
      { id: "e-r-b2", source: "node-router", target: "node-handover", sourceHandle: "branch_2" },
      { id: "e-r-b3", source: "node-router", target: "node-reply-katalog", sourceHandle: "branch_3" },
      { id: "e-kat-sub", source: "node-reply-katalog", target: "node-sub-router", sourceHandle: "out_next" },
      { id: "e-sub-b1", source: "node-sub-router", target: "node-reply-buket", sourceHandle: "branch_sub_1" },
      { id: "e-sub-b2", source: "node-sub-router", target: "node-reply-dekor", sourceHandle: "branch_sub_2" },
      { id: "e-form-fulf", source: "node-form", target: "node-fulfillment", sourceHandle: "out_valid" },
    ],
  };

  const testConfig: PipelineConfigData = {
    ...FLORIST_DECOR_PRESET,
    graph: testGraph,
  };

  // Helper pembanding paritas
  function assertParity(
    scenarioName: string,
    state: CustomerSessionState,
    inputText: string,
    activeRouterId?: string,
    role: "CUSTOMER" | "OWNER" = "CUSTOMER",
    intent: "SUBMIT_ORDER" | null = null,
  ) {
    // 1. Eksekusi Engine Inti (Mode Runtime)
    const runtimeResult = runPipelineStep(
      {
        config: testConfig,
        sessionState: state,
        currentRouterId: activeRouterId,
        senderRole: role,
      },
      {
        text: inputText,
        intent,
      },
      { dryRun: false }
    );

    // 2. Eksekusi Simulator Studio (Mode Visual Simulator)
    const simResult = simulatePipelineExecution(
      testConfig,
      inputText,
      state,
      role,
      activeRouterId
    );

    // 3. Verifikasi Paritas 100%: nextState dan replies wajib identik
    expect(
      simResult.next_state,
      `[${scenarioName}] next_state simulator vs runtime harus sama`
    ).toBe(runtimeResult.nextState);

    expect(
      simResult.replies,
      `[${scenarioName}] replies simulator vs runtime harus sama persis`
    ).toEqual(runtimeResult.replies);

    // Verifikasi node trace
    expect(simResult.visited_node_ids).toEqual(runtimeResult.nodeTrace);
  }

  // --- Skenario 1 s.d. 20 ---

  it("Skenario 01: Chat pertama kali dari pelanggan baru (State INIT)", () => {
    assertParity("01-INIT", "INIT", "Halo selamat siang");
  });

  it("Skenario 02: Pilihan Menu 1 (Order/Pesan)", () => {
    assertParity("02-PILIHAN_1", "AWAITING_CHOICE", "1");
  });

  it("Skenario 03: Pilihan Menu 1 via kata kunci 'mau pesan buket'", () => {
    assertParity("03-ORDER_KEYWORD", "AWAITING_CHOICE", "mau pesan dong kak");
  });

  it("Skenario 04: Pilihan Menu 2 (Tanya-tanya / Konsultasi)", () => {
    assertParity("04-PILIHAN_2", "AWAITING_CHOICE", "2");
  });

  it("Skenario 05: Pilihan Menu 2 via kata kunci 'konsultasi admin'", () => {
    assertParity("05-ASK_KEYWORD", "AWAITING_CHOICE", "mau tanya admin");
  });

  it("Skenario 06: Pilihan Menu 3 Kustom (Katalog)", () => {
    assertParity("06-CUSTOM_BRANCH", "AWAITING_CHOICE", "3");
  });

  it("Skenario 07: Pilihan Menu 3 via kata kunci 'pricelist'", () => {
    assertParity("07-CUSTOM_KEYWORD", "AWAITING_CHOICE", "pricelist");
  });

  it("Skenario 08: Navigasi Sub-Router Bertingkat (Katalog -> Buket)", () => {
    assertParity("08-SUB_ROUTER_1", "AWAITING_CHOICE", "buket", "node-sub-router");
  });

  it("Skenario 09: Navigasi Sub-Router Bertingkat (Katalog -> Dekor)", () => {
    assertParity("09-SUB_ROUTER_2", "AWAITING_CHOICE", "dekorasi", "node-sub-router");
  });

  it("Skenario 10: Input kata kunci tidak dikenal pada Sub-Router (Fallback sub-router)", () => {
    assertParity("10-SUB_ROUTER_UNKNOWN", "AWAITING_CHOICE", "apa kabar", "node-sub-router");
  });

  it("Skenario 11: Input kata kunci tidak dikenal pada Router Utama (Fallback pengingat)", () => {
    assertParity("11-ROUTER_FALLBACK", "AWAITING_CHOICE", "selamat pagi!");
  });

  it("Skenario 12: Pengiriman formulir pesanan lengkap dalam satu gelembung pesan", () => {
    const fullForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Rina Melati\n* Jenis Pesanan: Buket Mawar\n* Tanggal Acara: 15 November 2026\n* Alamat: Jl Diponegoro No 10 Bandung";
    assertParity("12-COMPLETE_FORM", "AWAITING_ORDER", fullForm);
  });

  it("Skenario 13: Pengiriman formulir pesanan lengkap saat masih di state AWAITING_CHOICE", () => {
    const fullForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Budi Santoso\n* Jenis Pesanan: Dekor Lamaran\n* Tanggal Acara: 20 November 2026\n* Alamat: Jl Sudirman No 1 Jakarta";
    assertParity("13-DIRECT_FORM_CHOICE", "AWAITING_CHOICE", fullForm);
  });

  it("Skenario 14: Pengiriman formulir pesanan lengkap saat masih di state INIT", () => {
    const fullForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Citra Lestari\n* Jenis Pesanan: Bunga Meja\n* Tanggal Acara: 25 November 2026\n* Alamat: Surabaya Barat";
    assertParity("14-DIRECT_FORM_INIT", "INIT", fullForm);
  });

  it("Skenario 15: Formulir pesanan tidak lengkap (field alamat kosong)", () => {
    const incompleteForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Doni Kusuma\n* Jenis Pesanan: Buket Wisuda\n* Tanggal Acara: 12 Desember 2026\n* Alamat:";
    assertParity("15-INCOMPLETE_FORM", "AWAITING_ORDER", incompleteForm);
  });

  it("Skenario 16: Pesan biasa saat di state AWAITING_ORDER (mengulang formulir)", () => {
    assertParity("16-ORDER_REMINDER", "AWAITING_ORDER", "alamat saya nanti saya kabari");
  });

  it("Skenario 17: Pesan saat bot sedang dalam jeda manual (PAUSED_FOR_OWNER)", () => {
    assertParity("17-PAUSED_SILENT", "PAUSED_FOR_OWNER", "Halo apakah owner sudah baca?");
  });

  it("Skenario 18: Formulir pesanan masuk saat bot sedang dijeda PAUSED_FOR_OWNER", () => {
    const formInPause = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Eko Prasetyo\n* Jenis Pesanan: Buket Balon\n* Tanggal Acara: 18 November 2026\n* Alamat: Medan";
    assertParity("18-FORM_IN_PAUSE", "PAUSED_FOR_OWNER", formInPause);
  });

  it("Skenario 19: Pesan masuk dari Owner (Role OWNER menuju AI Agent)", () => {
    assertParity("19-OWNER_AGENT", "INIT", "Ingatkan beli bunga mawar jam 3 sore", undefined, "OWNER");
  });

  it("Skenario 20: Pesan baru setelah pesanan selesai (State ACTIVE ke AWAITING_CHOICE)", () => {
    assertParity("20-ACTIVE_NEW_CONVERSATION", "ACTIVE", "Halo mau nanya lagi");
  });

  it("Skenario 21: Pilihan 3 (Katalog) memindahkan current_router_id ke router turunan", () => {
    const res = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-router",
      },
      { text: "3" }
    );
    expect(res.nextState).toBe("AWAITING_CHOICE");
    expect(res.nextRouterId).toBe("node-sub-router");
    expect(res.replies[0]).toContain("https://berseri.id/katalog");
    assertParity("21-SUB_ROUTER_CHAINING", "AWAITING_CHOICE", "3");
  });

  it("Skenario 22: Pilihan 1 setelah di router turunan mengalir ke Formulir Order (bukan sapaan)", () => {
    // Buat konfigurasi dengan sub-router yang memiliki cabang 1 menuju node-form
    const graphWithSubOrder: PipelineGraph = {
      ...testGraph,
      edges: [
        ...testGraph.edges,
        { id: "e-sub-order", source: "node-sub-router", target: "node-form", sourceHandle: "branch_1" },
      ],
    };
    const subOrderConfig: PipelineConfigData = {
      ...testConfig,
      graph: graphWithSubOrder,
    };

    const res = runPipelineStep(
      {
        config: subOrderConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-sub-router",
      },
      { text: "1" }
    );
    expect(res.nextState).toBe("AWAITING_ORDER");
    expect(res.replies[0]).toContain("FORMAT PESANAN BERSERI");
    expect(res.replies[0]).not.toContain("Halo Kak! Selamat datang");
  });

  it("Skenario 23: Input di luar pilihan ('99' / 'halo') menghasilkan fallback dan mempertahankan router", () => {
    // 1. Pada router dengan custom fallback_reply_text: menggunakan teks kustom router
    const resCustom = runPipelineStep(
      {
        config: testConfig,
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-sub-router",
      },
      { text: "99" }
    );
    expect(resCustom.nextState).toBe("AWAITING_CHOICE");
    expect(resCustom.nextRouterId).toBe("node-sub-router");
    expect(resCustom.replies[0]).toContain("Ketik 'buket' atau 'dekor'");
    assertParity("23-FALLBACK_RETAIN_ROUTER", "AWAITING_CHOICE", "99", "node-sub-router");

    // 2. Pada router tanpa fallback_reply_text: menghasilkan fallback deterministik standar
    const graphNoFallbackText: PipelineGraph = {
      ...testGraph,
      nodes: testGraph.nodes.map((n) =>
        n.id === "node-sub-router" ? { ...n, data: { ...n.data, fallback_reply_text: undefined } } : n
      ),
    };
    const resStandard = runPipelineStep(
      {
        config: { ...testConfig, graph: graphNoFallbackText },
        sessionState: "AWAITING_CHOICE",
        currentRouterId: "node-sub-router",
      },
      { text: "99" }
    );
    expect(resStandard.nextState).toBe("AWAITING_CHOICE");
    expect(resStandard.nextRouterId).toBe("node-sub-router");
    expect(resStandard.replies[0]).toContain("pilihan belum sesuai format");
  });
});

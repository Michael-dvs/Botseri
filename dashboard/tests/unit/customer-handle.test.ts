import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/customer/handle/route";
import { OrderPaymentStatus } from "@prisma/client";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";

const {
  authMock,
  customerSessionFindUniqueMock,
  customerSessionCreateMock,
  customerSessionUpdateManyMock,
  customerSessionUpdateMock,
  authorizedNumberFindFirstMock,
  authorizedNumberUpdateMock,
  orderCreateMock,
  chatCompletionMock,
  pipelineConfigFindUniqueMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  customerSessionCreateMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  authorizedNumberFindFirstMock: vi.fn(),
  authorizedNumberUpdateMock: vi.fn(),
  orderCreateMock: vi.fn(),
  chatCompletionMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/llm-gateway", () => ({
  chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
}));

vi.mock("@/lib/db", () => {
  const txMock = {
    order: {
      create: (...args: unknown[]) => orderCreateMock(...args),
    },
    customerSession: {
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
    },
  };

  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      customerSession: {
        findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
        create: (...args: unknown[]) => customerSessionCreateMock(...args),
        updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
        update: (...args: unknown[]) => customerSessionUpdateMock(...args),
      },
      authorizedNumber: {
        findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
        update: (...args: unknown[]) => authorizedNumberUpdateMock(...args),
      },
      order: {
        create: (...args: unknown[]) => orderCreateMock(...args),
      },
      pipelineConfig: {
        findUnique: (...args: unknown[]) => pipelineConfigFindUniqueMock(...args),
        upsert: vi.fn(),
      },
    },
  };
});

function makeRequest(body: Record<string, unknown>, authorized = true) {
  authMock.mockReturnValue(authorized);
  return new Request("http://localhost:3000/api/internal/customer/handle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/customer/handle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });
    pipelineConfigFindUniqueMock.mockResolvedValue(null);
  });

  it("returns 401 when internal token is invalid", async () => {
    const req = makeRequest({ customer_phone: "+628123456789" }, false);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body schema", async () => {
    const req = makeRequest({ customer_phone: "" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // Case 1: Nomor asing pertama "halo" -> replies berisi T1, state AWAITING_CHOICE
  it("Case 1: First chat 'halo' creates session, sends T1 greeting, moves to AWAITING_CHOICE", async () => {
    customerSessionFindUniqueMock.mockResolvedValue(null);
    customerSessionCreateMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "INIT",
      metadata: null,
      paused_at: null,
      customer_name: null,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "halo",
      message_id: "msg-1",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_before).toBe("INIT");
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toContain("selamat datang di *Berseri Florist & Decor*");
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-1", state: "INIT" },
        data: expect.objectContaining({ state: "AWAITING_CHOICE" }),
      })
    );
  });

  // Case 2: Lanjut "2" -> replies berisi T3 (ke pelanggan) + T7 (ke owner primary), state PAUSED_FOR_OWNER
  it("Case 2: Choice '2' sends T3 to customer and T7 to primary owner, moves to PAUSED_FOR_OWNER", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      metadata: { retry_count: 0 },
      paused_at: null,
      customer_name: null,
    });
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "owner-1",
      phone_e164: "+628999999999",
      is_primary: true,
      is_owner: true,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "2",
      message_id: "msg-2",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("PAUSED_FOR_OWNER");
    expect(data.replies).toHaveLength(2);
    // Reply to customer
    expect(data.replies[0].to).toBe("+628123456789");
    expect(data.replies[0].text).toContain("Saat ini bot kami jeda sejenak");
    // Alert to primary owner
    expect(data.replies[1].to).toBe("+628999999999");
    expect(data.replies[1].text).toContain("Halo Owner Berseri! Ada Pelanggan Butuh Bantuan Manual");
    expect(data.replies[1].text).toContain("+628123456789");
  });

  // Case 3: Lanjut "kapan buka?" saat PAUSED -> replies: [], state tetap PAUSED_FOR_OWNER
  it("Case 3: Message 'kapan buka?' when PAUSED_FOR_OWNER returns empty replies", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "PAUSED_FOR_OWNER",
      metadata: { retry_count: 0 },
      paused_at: new Date(),
      customer_name: null,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "kapan buka?",
      message_id: "msg-3",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("PAUSED_FOR_OWNER");
    expect(data.replies).toEqual([]);
  });

  // Case 4: Lanjut form lengkap -> order tersimpan 1 baris, replies berisi T4, state ACTIVE
  it("Case 4: Complete order form creates order in DB, replies with T4, moves to ACTIVE", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "PAUSED_FOR_OWNER",
      metadata: { retry_count: 0 },
      paused_at: new Date(),
      customer_name: null,
    });
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "owner-1",
      phone_e164: "+628999999999",
      is_owner: true,
      is_primary: true,
    });

    orderCreateMock.mockResolvedValue({
      id: "9c3c5d6e-1111-2222-3333-444455556666",
      customer_name: "Maya Safira",
      customer_contact: "+628123456789",
      description: "Buket Bunga Mawar Merah",
      event_date: new Date("2026-11-15T00:00:00+07:00"),
      delivery_address: "Jl. Melati No. 8 Jakarta",
      payment_status: OrderPaymentStatus.UNPAID,
      notes: "Jam Pengiriman: 10:00 WIB | Request Khusus: Pita warna emas",
    });

    const formText = `*FORMAT PESANAN BERSERI*
• Nama Pemesan: Maya Safira
• Jenis Pesanan (Buket / Bunga Meja / Dekor Lamaran / dll): Buket Bunga Mawar Merah
• Tanggal Acara / Pengiriman: 15 November 2026
• Jam Pengiriman: 10:00 WIB
• Alamat / Lokasi: Jl. Melati No. 8 Jakarta
• Request Khusus (Warna bunga / Tulisan kartu ucapan): Pita warna emas`;

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: formText,
      message_id: "msg-4",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("ACTIVE");
    expect(orderCreateMock).toHaveBeenCalledTimes(1);
    expect(orderCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customer_name: "Maya Safira",
          customer_contact: "+628123456789",
          description: "Buket Bunga Mawar Merah",
          payment_status: OrderPaymentStatus.UNPAID,
          delivery_address: "Jl. Melati No. 8 Jakarta",
        }),
      })
    );
    expect(data.replies).toHaveLength(2);
    // Message 1: Customer confirmation
    expect(data.replies[0].to).toBe("+628123456789");
    expect(data.replies[0].text).toContain("Yeay, terima kasih Kak! 🌸");
    expect(data.replies[0].text).toContain("#ORD-9C3C5D6E");
    expect(data.replies[0].text).toContain("Maya Safira");
    expect(data.replies[0].trigger_type).toBe("CUSTOMER_REPLY");

    // Message 2: Owner instant alert
    expect(data.replies[1].to).toBe("+628999999999");
    expect(data.replies[1].text).toContain("Pesanan Baru Masuk!");
    expect(data.replies[1].text).toContain("Maya Safira");
    expect(data.replies[1].trigger_type).toBe("NEW_ORDER_ALERT");
  });

  it("auto-heals is_primary if owner exists without is_primary: true", async () => {
    // First call (with is_primary: true) returns null
    // Second call (fallback without is_primary: true) returns the owner
    authorizedNumberFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "owner-2",
        phone_e164: "+628777777777",
        is_owner: true,
        is_primary: false,
      });
    authorizedNumberUpdateMock.mockResolvedValue({
      id: "owner-2",
      is_primary: true,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      metadata: { retry_count: 0 },
      paused_at: null,
      customer_name: null,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "2",
      message_id: "msg-auto-heal",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(authorizedNumberUpdateMock).toHaveBeenCalledWith({
      where: { id: "owner-2" },
      data: { is_primary: true },
    });
    expect(data.replies).toHaveLength(2);
    expect(data.replies[1].to).toBe("+628777777777");
    expect(data.replies[1].text).toContain("Halo Owner Berseri! Ada Pelanggan Butuh Bantuan Manual");
  });

  // Case 5: Kirim form yang sama dengan message_id sama -> idempotensi aktif, tidak ada order kedua
  it("Case 5: Re-sending with same message_id is idempotent (no duplicate order)", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "ACTIVE",
      metadata: { last_message_id: "msg-4" },
      paused_at: null,
      customer_name: "Maya Safira",
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "any text",
      message_id: "msg-4",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.replies).toEqual([]);
    expect(orderCreateMock).not.toHaveBeenCalled();
  });

  // Case 6: Form kurang Alamat -> T6 menyebut Alamat saja, tidak ada order dibuat
  it("Case 6: Missing required field (Alamat) replies with T6 listing Alamat, no order created", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "AWAITING_ORDER",
      metadata: { retry_count: 0 },
      paused_at: null,
      customer_name: null,
    });

    const incompleteForm = `*FORMAT PESANAN BERSERI*
• Nama Pemesan: Maya Safira
• Jenis Pesanan: Buket Bunga
• Tanggal Acara: 15/11/2026
• Alamat / Lokasi: -`;

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: incompleteForm,
      message_id: "msg-5",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_ORDER");
    expect(orderCreateMock).not.toHaveBeenCalled();
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toContain("belum lengkap");
    expect(data.replies[0].text).toContain("Alamat / Lokasi");
    expect(data.replies[0].text).not.toContain("Nama Pemesan");
  });

  // Case 7: Tidak ada owner is_primary -> T3 tetap terkirim, tidak crash
  it("Case 7: When no is_primary owner exists, T3 is still sent to customer without crash", async () => {
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      metadata: { retry_count: 0 },
      paused_at: null,
      customer_name: null,
    });
    authorizedNumberFindFirstMock.mockResolvedValue(null);

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "2",
      message_id: "msg-6",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].to).toBe("+628123456789");
    expect(data.replies[0].text).toContain("Saat ini bot kami jeda sejenak");
  });

  // Case 8: Paused session expired -> behaves as ACTIVE, text 'halo' restarts menu
  it("Case 8: Paused session past TTL behaves as ACTIVE, sends greeting menu", async () => {
    const expiredPausedDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-1",
      phone_e164: "+628123456789",
      state: "PAUSED_FOR_OWNER",
      metadata: { retry_count: 0 },
      paused_at: expiredPausedDate,
      customer_name: null,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "halo kak",
      message_id: "msg-7",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toContain("selamat datang di *Berseri Florist & Decor*");
  });

  it("Case 9: Uses dynamic greeting text from customized pipeline configuration", async () => {
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Custom Retail Pipeline",
      preset_key: "GENERIC_COMMERCE",
      config_json: {
        inbound_gate: {
          enabled: true,
          allow_unregistered_customers: true,
          ignore_groups: true,
          rate_limit_per_minute: 20,
          mute_bot_on_active_order: true,
        },
        customer_greeting: {
          enabled: true,
          greeting_text: "Halo Kak! Ini toko kue lezat, mau pesan apa hari ini?",
          order_trigger_keywords: ["beli kue", "1"],
          ask_trigger_keywords: ["tanya admin", "2"],
          unrecognized_choice_text: "Ketik 1 atau 2 ya.",
        },
        order_form: {
          enabled: true,
          form_template_text: "Format pemesanan kue: Nama Pemesan:",
          required_fields: ["nama_pemesan"],
          missing_fields_prefix: "Kurang lengkap:",
          enable_llm_fallback: false,
        },
        cs_handover: {
          enabled: true,
          handover_customer_text: "Tunggu sebentar ya Kak, admin akan segera membalas.",
          pause_ttl_hours: 24,
          notify_owner: true,
          owner_handover_alert_template: "Pemberitahuan pelanggan butuh bantuan: {{customer_phone}}",
        },
        order_confirmation: {
          enabled: true,
          customer_confirmation_template: "Kue diproses: {{order_id}} atas nama {{customer_name}}",
          notify_owner_on_new_order: true,
          owner_new_order_alert_template: "Pesanan kue baru masuk: {{order_id}}",
        },
        owner_assistant: {
          enabled: true,
          enable_todo_tools: true,
          enable_order_tools: true,
          enable_voice_note_stt: true,
        },
      },
      version: 2,
    });

    customerSessionFindUniqueMock.mockResolvedValue(null);
    customerSessionCreateMock.mockResolvedValue({
      id: "sess-custom-1",
      phone_e164: "+628123456789",
      state: "INIT",
      metadata: null,
      paused_at: null,
      customer_name: null,
    });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "halo",
      message_id: "msg-custom-greeting",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toBe("Halo Kak! Ini toko kue lezat, mau pesan apa hari ini?");
  });

  it("Case 10: Executes custom branch from graph in database when customer sends '3' in AWAITING_CHOICE", async () => {
    const customConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-router",
            type: "CONDITION_ROUTER" as const,
            position: { x: 400, y: 0 },
            data: {
              branches: [
                { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
                { id: "branch_3", label: "Katalog Menu", keywords: ["3", "katalog", "menu"] },
              ],
            },
          },
          {
            id: "node-katalog",
            type: "CUSTOM_WA_REPLY" as const,
            position: { x: 700, y: 150 },
            data: {
              recipient_type: "CUSTOMER",
              message_template: "Silakan cek katalog lengkap kami di https://berseri.id/katalog ya Kak {{customer_name}}!",
            },
          },
        ],
        edges: [
          {
            id: "edge-katalog",
            source: "node-router",
            sourceHandle: "branch_3",
            target: "node-katalog",
            label: "Pilihan · Katalog Menu",
          },
        ],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline with Catalog Branch",
      preset_key: "FLORIST_DECOR",
      config_json: customConfig,
      version: 3,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-awaiting-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Budi",
      paused_at: null,
      metadata: { retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "3",
      message_id: "msg-choose-catalog",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].text).toContain("https://berseri.id/katalog");
    expect(data.replies[0].trigger_type).toBe("CUSTOMER_REPLY");
  });

  it("Case 11: Defensive Anti-Bisu fallback returns reminder message when input is unrecognized in AWAITING_CHOICE", async () => {
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Default Pipeline",
      preset_key: "FLORIST_DECOR",
      config_json: {
        inbound_gate: { enabled: true, allow_unregistered_customers: true, ignore_groups: true, rate_limit_per_minute: 20, mute_bot_on_active_order: true },
        customer_greeting: { enabled: true, greeting_text: "Menu...", order_trigger_keywords: ["1", "pesan"], ask_trigger_keywords: ["2", "tanya"], unrecognized_choice_text: "Mohon maaf Kak, kami belum menangkap pilihannya." },
        order_form: { enabled: true, form_template_text: "Form...", required_fields: ["nama_pemesan"], missing_fields_prefix: "Kurang:", enable_llm_fallback: false },
        cs_handover: { enabled: true, handover_customer_text: "Tunggu...", pause_ttl_hours: 24, notify_owner: false, owner_handover_alert_template: "Alert..." },
        order_confirmation: { enabled: true, customer_confirmation_template: "Order OK", notify_owner_on_new_order: false, owner_new_order_alert_template: "Alert..." },
        owner_assistant: { enabled: true, enable_todo_tools: true, enable_order_tools: true, enable_voice_note_stt: true },
        graph: { nodes: [], edges: [] },
      },
      version: 1,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-awaiting-2",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Budi",
      paused_at: null,
      metadata: { retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "999",
      message_id: "msg-unrecognized-999",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies.length).toBeGreaterThanOrEqual(1);
    expect(data.replies[0].text).toContain("belum menangkap pilihannya");
  });

  it("Case 12: Chained sub-menu navigates to sub-router, sets current_router_id, and executes next choice", async () => {
    const subMenuConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-router",
            type: "CONDITION_ROUTER" as const,
            position: { x: 400, y: 0 },
            data: {
              branches: [
                { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
                { id: "branch_3", label: "Katalog Menu", keywords: ["3", "katalog", "menu"] },
              ],
            },
          },
          {
            id: "node-menu-katalog",
            type: "MESSAGE_MENU" as const,
            position: { x: 700, y: 100 },
            data: {
              greeting_text: "Halo kak, untuk melihat katalog Berseri dapat melihat dari link berikut ya!! 🏷️\n\n1. Pesan Sekarang\n2. Tanya Admin",
            },
          },
          {
            id: "node-router-sub",
            type: "CONDITION_ROUTER" as const,
            position: { x: 950, y: 100 },
            data: {
              label: "Router Sub-Menu Katalog",
              branches: [
                { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
              ],
            },
          },
          {
            id: "node-order-form",
            type: "ORDER_FORM_PROCESSOR" as const,
            position: { x: 1200, y: 60 },
            data: {
              form_template_text: "FORMAT PESANAN BERSERI:\n* Nama Pemesan:",
            },
          },
        ],
        edges: [
          { id: "e-katalog", source: "node-router", target: "node-menu-katalog", sourceHandle: "branch_3" },
          { id: "e-sub-router", source: "node-menu-katalog", target: "node-router-sub", sourceHandle: "out_next" },
          { id: "e-sub-order", source: "node-router-sub", target: "node-order-form", sourceHandle: "branch_1" },
        ],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline with Sub-Router",
      preset_key: "FLORIST_DECOR",
      config_json: subMenuConfig,
      version: 4,
    });

    // Step 1: Customer chooses 3
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-sub-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Budi",
      paused_at: null,
      metadata: { retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const reqStep1 = makeRequest({
      customer_phone: "+628123456789",
      message_text: "3",
      message_id: "msg-step-1",
    });

    const resStep1 = await POST(reqStep1);
    expect(resStep1.status).toBe(200);
    const dataStep1 = await resStep1.json();
    expect(dataStep1.ok).toBe(true);
    expect(dataStep1.state_after).toBe("AWAITING_CHOICE");
    expect(dataStep1.replies[0].text).toContain("Halo kak, untuk melihat katalog Berseri dapat melihat dari link berikut ya!! 🏷️");

    // Verify that the session update included current_router_id: "node-router-sub"
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            current_router_id: "node-router-sub",
          }),
        }),
      })
    );

    // Step 2: Customer then sends 1 (which will be evaluated by node-router-sub)
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-sub-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Budi",
      paused_at: null,
      metadata: { current_router_id: "node-router-sub", retry_count: 0 },
    });

    const reqStep2 = makeRequest({
      customer_phone: "+628123456789",
      message_text: "1",
      message_id: "msg-step-2",
    });

    const resStep2 = await POST(reqStep2);
    expect(resStep2.status).toBe(200);
    const dataStep2 = await resStep2.json();
    expect(dataStep2.ok).toBe(true);
    expect(dataStep2.state_after).toBe("AWAITING_ORDER");
    expect(dataStep2.replies[0].text).toContain("FORMAT PESANAN BERSERI");
  });

  it("Case 13: Initial chat in INIT traces trigger edge to root greeting and does not send sub-menu catalog message", async () => {
    const pipelineWithCatalogSubMenu = {
      ...FLORIST_DECOR_PRESET,
      customer_greeting: {
        ...FLORIST_DECOR_PRESET.customer_greeting,
        greeting_text: "Halo kak, untuk melihat katalog Berseri dapat melihat dari link drive.google.com/xyz",
      },
      graph: {
        nodes: [
          {
            id: "node-trigger",
            type: "TRIGGER_INBOUND" as const,
            position: { x: 0, y: 0 },
            data: { allow_unregistered_customers: true },
          },
          {
            id: "node-greeting",
            type: "MESSAGE_MENU" as const,
            position: { x: 200, y: 0 },
            data: {
              greeting_text: "Halo, selamat datang di Berseri Florist & Decor!\nAda yang bisa kami bantu hari ini?",
            },
          },
          {
            id: "custom-message_menu-1197",
            type: "MESSAGE_MENU" as const,
            position: { x: 700, y: 200 },
            data: {
              greeting_text: "Halo kak, untuk melihat katalog Berseri dapat melihat dari link drive.google.com/xyz",
            },
          },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-greeting", sourceHandle: "out_customer" },
        ],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Operasional Berseri",
      preset_key: "FLORIST_DECOR",
      config_json: pipelineWithCatalogSubMenu,
      version: 5,
    });

    customerSessionFindUniqueMock.mockResolvedValue(null);
    customerSessionCreateMock.mockResolvedValue({
      id: "sess-init-1",
      phone_e164: "+628123456789",
      state: "INIT",
      customer_name: null,
      paused_at: null,
      metadata: null,
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "halo",
      message_id: "msg-first-chat",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_before).toBe("INIT");
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies[0].text).toContain("Berseri Florist & Decor");
    expect(data.replies[0].text).not.toContain("drive.google.com");
  });

  it("Case 14: Sub-menu chaining with non-root MESSAGE_MENU extracts message and updates current_router_id", async () => {
    const pipelineConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-router",
            type: "CONDITION_ROUTER" as const,
            position: { x: 400, y: 0 },
            data: {
              branches: [
                { id: "branch_1", label: "Pilihan 1 (Order)", keywords: ["1", "pesan"] },
                { id: "branch_2", label: "Pilihan 2 (Tanya)", keywords: ["2", "tanya"] },
                { id: "branch_3", label: "Katalog", keywords: ["3", "katalog"] },
              ],
            },
          },
          {
            id: "node-menu-katalog",
            type: "MESSAGE_MENU" as const,
            position: { x: 700, y: 100 },
            data: {
              label: "Menu / Sapaan Baru",
              message_text: "Silakan pilih katalog:\n1. Buket Bunga\n2. Bunga Meja\nLink: https://berseri.id/katalog",
            },
          },
          {
            id: "node-router-katalog",
            type: "CONDITION_ROUTER" as const,
            position: { x: 950, y: 100 },
            data: {
              branches: [
                { id: "branch_1", label: "Pesan Buket", keywords: ["1", "buket"] },
                { id: "branch_2", label: "Tanya CS", keywords: ["2", "tanya"] },
              ],
            },
          },
        ],
        edges: [
          { id: "e-katalog", source: "node-router", target: "node-menu-katalog", sourceHandle: "branch_3" },
          { id: "e-sub-router", source: "node-menu-katalog", target: "node-router-katalog", sourceHandle: "out_next" },
        ],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline with Catalog Sub-Menu",
      preset_key: "FLORIST_DECOR",
      config_json: pipelineConfig,
      version: 5,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-sub-chain-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Andi",
      paused_at: null,
      metadata: { retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "3",
      message_id: "msg-choose-3",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies[0].text).toContain("https://berseri.id/katalog");
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            current_router_id: "node-router-katalog",
          }),
        }),
      })
    );
  });

  it("Case 15: Post-catalog choice 1 flows to Order Form without resetting to greeting", async () => {
    const pipelineConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-greeting",
            type: "MESSAGE_MENU" as const,
            position: { x: 100, y: 0 },
            data: { greeting_text: "Halo Kak! Ini sapaan awal toko." },
          },
          {
            id: "node-router-katalog",
            type: "CONDITION_ROUTER" as const,
            position: { x: 400, y: 0 },
            data: {
              branches: [
                { id: "branch_1", label: "Pesan Sekarang", keywords: ["1", "pesan"] },
                { id: "branch_2", label: "Tanya CS", keywords: ["2", "tanya"] },
              ],
            },
          },
          {
            id: "node-form",
            type: "ORDER_FORM_PROCESSOR" as const,
            position: { x: 700, y: 0 },
            data: { form_template_text: "*FORMAT PESANAN BERSERI*\n* Nama Pemesan:" },
          },
        ],
        edges: [
          { id: "e-sub-order", source: "node-router-katalog", target: "node-form", sourceHandle: "branch_1" },
        ],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Post Catalog",
      preset_key: "FLORIST_DECOR",
      config_json: pipelineConfig,
      version: 5,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-sub-chain-2",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Andi",
      paused_at: null,
      metadata: { current_router_id: "node-router-katalog", retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "1",
      message_id: "msg-choose-1-post-cat",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_ORDER");
    expect(data.replies[0].text).toContain("FORMAT PESANAN BERSERI");
    expect(data.replies[0].text).not.toContain("Ini sapaan awal toko");
  });

  it("Case 16: Unrecognized input in AWAITING_CHOICE returns deterministic fallback and retains current_router_id", async () => {
    const pipelineConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          {
            id: "node-router-sub",
            type: "CONDITION_ROUTER" as const,
            position: { x: 400, y: 0 },
            data: {
              branches: [
                { id: "branch_1", label: "Pilihan 1", keywords: ["1"] },
                { id: "branch_2", label: "Pilihan 2", keywords: ["2"] },
              ],
              // fallback_reply_text sengaja tidak diisi agar menguji default deterministik
            },
          },
        ],
        edges: [],
      },
    };

    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Pipeline Fallback",
      preset_key: "FLORIST_DECOR",
      config_json: pipelineConfig,
      version: 5,
    });

    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-sub-chain-3",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      customer_name: "Andi",
      paused_at: null,
      metadata: { current_router_id: "node-router-sub", retry_count: 0 },
    });
    customerSessionUpdateManyMock.mockResolvedValue({ count: 1 });

    const req = makeRequest({
      customer_phone: "+628123456789",
      message_text: "99",
      message_id: "msg-invalid-99",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.state_after).toBe("AWAITING_CHOICE");
    expect(data.replies[0].text).toContain("pilihan belum sesuai format");
    expect(customerSessionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_CHOICE",
          metadata: expect.objectContaining({
            current_router_id: "node-router-sub",
            retry_count: 1,
          }),
        }),
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPaymentStatus, OrderStatus } from "@prisma/client";
import { POST as customerHandlePOST } from "@/app/api/internal/customer/handle/route";
import { POST as inboundAcceptPOST } from "@/app/api/internal/inbound/accept/route";
import { POST as updateOrderToolPOST } from "@/app/api/internal/tools/update-order/route";
import { PUT as pipelinePUT } from "@/app/api/pipeline/route";
import { POST as llmCompletionPOST } from "@/app/api/internal/llm/v1/chat/completions/route";
import { completeOrder } from "@/lib/orders/service";
import { tick } from "@/lib/scheduler/tick";
import { sendHumanizedMessage, __resetHumanizerState } from "@/lib/waha/humanizer";
import { FLORIST_DECOR_PRESET } from "@/lib/pipeline/presets";

const {
  prismaMock,
  recordEventMock,
  sendTextDirectMock,
  getSessionMock,
  authMock,
  decryptSecretMock,
} = vi.hoisted(() => ({
  prismaMock: {
    botSettings: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    authorizedNumber: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    customerSession: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    pendingConfirmation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    todo: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    systemEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    llmConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    pipelineConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    pipelineConfigVersion: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    holiday: {
      findMany: vi.fn(),
    },
    dailyExecutionLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    messageLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn().mockImplementation((arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prismaMock);
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    }),
  },
  recordEventMock: vi.fn(),
  sendTextDirectMock: vi.fn(),
  getSessionMock: vi.fn(),
  authMock: vi.fn(),
  decryptSecretMock: vi.fn(),
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
  checkInternalAuth: () => null,
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: (...args: unknown[]) => decryptSecretMock(...args),
}));

vi.mock("@/lib/waha/client", () => ({
  sendTextDirect: (...args: unknown[]) => sendTextDirectMock(...args),
  sendSeen: vi.fn().mockResolvedValue({}),
  startTyping: vi.fn().mockResolvedValue({}),
  stopTyping: vi.fn().mockResolvedValue({}),
}));

describe("S13: 8 Skenario Test Integrasi End-to-End Sistem Botseri", () => {
  const baseNow = new Date("2026-11-05T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    __resetHumanizerState();
    authMock.mockReturnValue(true);
    recordEventMock.mockResolvedValue({});
    decryptSecretMock.mockReturnValue("secret-test-key");
    getSessionMock.mockResolvedValue({ sub: "user-test", username: "admin" });

    // Mock bot settings default
    prismaMock.botSettings.findUnique.mockResolvedValue({
      id: 1,
      brand_name: "TEST-Florist",
      timezone: "Asia/Jakarta",
      bot_enabled: true,
      setup_completed: true,
      enable_orders: true,
      working_days: [1, 2, 3, 4, 5],
      early_brief_time: "07:00",
      brief_window_minutes: 60,
      work_hours_start: "08:00",
      work_hours_end: "17:00",
      reminder_max_per_day: 3,
      reminder_max_rank: 5,
      customer_data_retention_days: 365,
    });

    // Mock owner utama terdaftar
    prismaMock.authorizedNumber.findFirst.mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
      const or = args?.where?.OR as Array<Record<string, unknown>> | undefined;
      if (or) {
        const matchesOwner = or.some(
          (cond) => cond.phone_e164 === "+6281299990001" || cond.chat_id === "6281299990001@c.us"
        );
        if (matchesOwner) {
          return {
            id: "owner-1",
            chat_id: "6281299990001@c.us",
            phone_e164: "+6281299990001",
            is_owner: true,
            is_primary: true,
          };
        }
        return null;
      }
      if (args?.where?.is_primary === true || args?.where?.is_owner === true) {
        return {
          id: "owner-1",
          chat_id: "6281299990001@c.us",
          phone_e164: "+6281299990001",
          is_owner: true,
          is_primary: true,
        };
      }
      return null;
    });

    prismaMock.authorizedNumber.findUnique.mockResolvedValue({
      id: "owner-1",
      chat_id: "6281299990001@c.us",
      phone_e164: "+6281299990001",
      is_owner: true,
      is_primary: true,
    });

    // Default mock data untuk relasi lainnya
    prismaMock.customerSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.customerSession.update.mockResolvedValue({});
    prismaMock.customerSession.findMany.mockResolvedValue([]);
    prismaMock.pendingConfirmation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.pendingConfirmation.update.mockResolvedValue({});
    prismaMock.holiday.findMany.mockResolvedValue([]);
    prismaMock.messageLog.count.mockResolvedValue(0);
    prismaMock.messageLog.create.mockResolvedValue({ id: "msg-log-1" });
    prismaMock.messageLog.findFirst.mockResolvedValue(null);
    prismaMock.messageLog.findUnique.mockResolvedValue(null);
    prismaMock.order.count.mockResolvedValue(1);
    prismaMock.order.update.mockResolvedValue({});
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.todo.findMany.mockResolvedValue([]);
    prismaMock.dailyExecutionLog.findUnique.mockResolvedValue(null);
    prismaMock.dailyExecutionLog.findFirst.mockResolvedValue(null);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);

    // Mock visual pipeline config
    prismaMock.pipelineConfig.findUnique.mockResolvedValue({
      id: 1,
      name: "TEST-Pipeline",
      preset_key: "FLORIST_DECOR",
      version: 1,
      config_json: FLORIST_DECOR_PRESET,
    });

    // Mock default send WAHA
    sendTextDirectMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "wa-msg-123" }),
      status: 200,
    });

    process.env.WAHA_FAST_TEST = "1";
    process.env.WAHA_MOCK_OUTBOUND = "0";
  });

  function makeJsonRequest(url: string, body: unknown, method = "POST"): Request {
    return new Request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer staging-internal-token",
      },
      body: JSON.stringify(body),
    });
  }

  // 1. Skenario 1 (Alur Pelanggan Baru)
  it("Skenario 1: Alur lengkap pelanggan baru dari sapaan hingga pesanan tercatat", async () => {
    // Langkah 1: Chat pertama masuk (INIT) -> Bot mengirimkan sapaan T1
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-new-1",
      phone_e164: "+628123456789",
      state: "INIT",
      metadata: null,
    });

    const res1 = await customerHandlePOST(
      makeJsonRequest("http://localhost/api/internal/customer/handle", {
        customer_phone: "+628123456789",
        message_text: "Halo kak mau tanya",
      })
    );
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);
    expect(data1.state_after).toBe("AWAITING_CHOICE");
    expect(data1.replies[0].text).toContain("Halo, selamat datang di *Berseri Florist & Decor*!");

    // Langkah 2: Pelanggan memilih menu "1" -> Bot mengirim formulir pesanan T2
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-new-1",
      phone_e164: "+628123456789",
      state: "AWAITING_CHOICE",
      metadata: null,
    });

    const res2 = await customerHandlePOST(
      makeJsonRequest("http://localhost/api/internal/customer/handle", {
        customer_phone: "+628123456789",
        message_text: "1",
      })
    );
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);
    expect(data2.state_after).toBe("AWAITING_ORDER");
    expect(data2.replies[0].text).toContain("*FORMAT PESANAN BERSERI*");

    // Langkah 3: Pelanggan mengirimkan formulir lengkap -> Pesanan tersimpan di DB & alert terkirim ke owner
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-new-1",
      phone_e164: "+628123456789",
      state: "AWAITING_ORDER",
      metadata: null,
    });
    prismaMock.order.create.mockResolvedValueOnce({
      id: "ord-test-uuid-001",
      customer_name: "Dewi Sartika",
      customer_contact: "+628123456789",
      customer_chat_id: "628123456789@c.us",
      description: "Buket Mawar Pink",
      status: OrderStatus.PENDING,
      payment_status: OrderPaymentStatus.UNPAID,
      delivery_address: "Bandung Kota",
      event_date: new Date("2026-11-20T10:00:00Z"),
      notes: null,
      created_at: baseNow,
    });

    const fullForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Dewi Sartika\n* Jenis Pesanan: Buket Mawar Pink\n* Tanggal Acara: 20 November 2026\n* Alamat: Bandung Kota";
    const res3 = await customerHandlePOST(
      makeJsonRequest("http://localhost/api/internal/customer/handle", {
        customer_phone: "+628123456789",
        message_text: fullForm,
      })
    );
    const data3 = await res3.json();
    expect(data3.ok).toBe(true);
    expect(data3.state_after).toBe("ACTIVE");
    expect(prismaMock.order.create).toHaveBeenCalled();
    expect(data3.replies.length).toBeGreaterThanOrEqual(1);
    expect(data3.replies[0].text).toContain("Pesanan Kakak sudah otomatis tercatat");
  });

  // 2. Skenario 2 (Formulir Tidak Lengkap)
  it("Skenario 2: Formulir kurang lengkap meminta kelengkapan field, lalu sukses setelah dilengkapi", async () => {
    // Pelanggan mengirim formulir tanpa alamat
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-incomplete-1",
      phone_e164: "+628123456789",
      state: "AWAITING_ORDER",
      metadata: null,
    });

    const partialForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Rian Pratama\n* Jenis Pesanan: Bunga Meja\n* Tanggal Acara: 15 November 2026\n* Alamat:";
    const res1 = await customerHandlePOST(
      makeJsonRequest("http://localhost/api/internal/customer/handle", {
        customer_phone: "+628123456789",
        message_text: partialForm,
      })
    );
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);
    expect(data1.state_after).toBe("AWAITING_ORDER");

    // Pelanggan melengkapi alamat
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-incomplete-1",
      phone_e164: "+628123456789",
      state: "AWAITING_ORDER",
      metadata: {
        draft: {
          nama_pemesan: "Rian Pratama",
          jenis_pesanan: "Bunga Meja",
          tanggal_acara: "15 November 2026",
          parsed_date: new Date("2026-11-15T10:00:00Z").toISOString(),
        },
      },
    });
    prismaMock.order.create.mockResolvedValueOnce({
      id: "ord-test-uuid-002",
      customer_name: "Rian Pratama",
      customer_contact: "+628123456789",
      customer_chat_id: "628123456789@c.us",
      description: "Bunga Meja",
      status: OrderStatus.PENDING,
      payment_status: OrderPaymentStatus.UNPAID,
      delivery_address: "Jl Gatot Subroto No 5 Jakarta",
      event_date: new Date("2026-11-15T10:00:00Z"),
      notes: null,
      created_at: baseNow,
    });

    const completedForm = "*FORMAT PESANAN BERSERI*\n* Nama Pemesan: Rian Pratama\n* Jenis Pesanan: Bunga Meja\n* Tanggal Acara: 15 November 2026\n* Alamat: Jl Gatot Subroto No 5 Jakarta";
    const res2 = await customerHandlePOST(
      makeJsonRequest("http://localhost/api/internal/customer/handle", {
        customer_phone: "+628123456789",
        message_text: completedForm,
      })
    );
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);
    expect(data2.state_after).toBe("ACTIVE");
  });

  // 3. Skenario 3 (Siklus Mute, Digest, & Unmute)
  it("Skenario 3: Mute pelanggan aktif, pencatatan waiting_since, notifikasi digest, dan pembukaan sesi saat pesanan selesai", async () => {
    // 1. Pelanggan dengan pesanan aktif mengirim pesan -> Inbound accept menahan bot (ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED)
    prismaMock.order.findFirst.mockResolvedValueOnce({
      id: "ord-active-1",
      status: OrderStatus.IN_PROGRESS,
      created_at: baseNow,
    });
    prismaMock.customerSession.findUnique.mockResolvedValueOnce({
      id: "sess-mute-1",
      phone_e164: "+628123456789",
      metadata: {},
    });

    const resInbound = await inboundAcceptPOST(
      makeJsonRequest("http://localhost/api/internal/inbound/accept", {
        wa_message_id: "msg-cust-1",
        from: "628123456789@c.us",
        body: "Halo status buket saya bagaimana ya?",
        received_at: baseNow.toISOString(),
      })
    );
    const dataInbound = await resInbound.json();
    expect(dataInbound.accept).toBe(false);
    expect(dataInbound.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");

    // 2. Scheduler tick memicu notifikasi digest untuk pelanggan yang menunggu
    prismaMock.customerSession.findMany.mockResolvedValueOnce([
      {
        id: "sess-mute-1",
        phone_e164: "+628123456789",
        customer_name: "Pelanggan Menunggu",
        metadata: {
          waiting_since: new Date(baseNow.getTime() - 7 * 3600_000).toISOString(),
          unread_count: 2,
        },
      },
    ]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ name: "tick" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    const tickRes = await tick(baseNow);
    const digestJob = tickRes.jobs.find((j) => j.job_type === "OWNER_DIGEST");
    expect(digestJob).toBeDefined();

    // 3. Owner menyelesaikan pesanan -> Order service membuka kunci sesi pelanggan (unmute)
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: "ord-active-1",
      customer_chat_id: "628123456789@c.us",
      customer_contact: "+628123456789",
    });
    prismaMock.order.findFirst.mockResolvedValueOnce(null);
    prismaMock.customerSession.findMany.mockResolvedValueOnce([
      { id: "sess-mute-1", phone_e164: "+628123456789", state: "PAUSED_FOR_OWNER" },
    ]);

    await completeOrder("ord-active-1");
    expect(prismaMock.customerSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "ACTIVE",
          paused_at: null,
        }),
      })
    );
  });

  // 4. Skenario 4 (Konfirmasi Destruktif Dua Langkah)
  it("Skenario 4: Tindakan destruktif DELETE/ALL menahan eksekusi hingga owner mengirim 'YA' secara idempoten", async () => {
    const orderUuid = "11111111-2222-3333-4444-555555555555";
    // 1. Panggilan tool update-order dengan action DELETE menahan eksekusi
    prismaMock.order.findFirst.mockResolvedValueOnce({
      id: orderUuid,
      customer_name: "Budi",
      description: "Buket",
    });
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: orderUuid,
      customer_name: "Budi",
      description: "Buket",
    });

    const resTool = await updateOrderToolPOST(
      makeJsonRequest("http://localhost/api/internal/tools/update-order", {
        order_id: orderUuid,
        action: "DELETE",
        owner_chat_id: "6281299990001@c.us",
      })
    );
    const dataTool = await resTool.json();
    expect(dataTool.ok).toBe(true);
    expect(dataTool.requires_confirmation).toBe(true);
    expect(prismaMock.pendingConfirmation.create).toHaveBeenCalled();

    // 2. Inbound chat dari Owner mengirimkan kata konfirmasi "YA"
    prismaMock.pendingConfirmation.findFirst.mockResolvedValueOnce({
      id: "conf-1",
      owner_chat_id: "6281299990001@c.us",
      action: "DELETE",
      payload_json: { order_id: orderUuid, action: "DELETE" },
      expires_at: new Date(baseNow.getTime() + 5 * 60_000),
      executed_at: null,
    });
    prismaMock.pendingConfirmation.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: orderUuid,
      customer_name: "Budi",
    });

    const resConfirm = await inboundAcceptPOST(
      makeJsonRequest("http://localhost/api/internal/inbound/accept", {
        wa_message_id: "msg-owner-ya",
        from: "6281299990001@c.us",
        body: "ya",
        received_at: baseNow.toISOString(),
      })
    );
    const dataConfirm = await resConfirm.json();
    expect(dataConfirm.accept).toBe(true);
    expect(dataConfirm.reason).toBe("CONFIRMED_ACTION_EXECUTED");
    expect(dataConfirm.reply_text).toContain("berhasil dihapus");

    // 3. Pengiriman kata "YA" kedua kali bersifat idempoten (pending confirmation sudah executed)
    prismaMock.pendingConfirmation.findFirst.mockResolvedValueOnce(null);
    const resIdempotent = await inboundAcceptPOST(
      makeJsonRequest("http://localhost/api/internal/inbound/accept", {
        wa_message_id: "msg-owner-ya-again",
        from: "6281299990001@c.us",
        body: "ya",
        received_at: baseNow.toISOString(),
      })
    );
    const dataIdempotent = await resIdempotent.json();
    expect(dataIdempotent.role).toBe("OWNER");
    expect(dataIdempotent.accept).toBe(true);
  });

  // 5. Skenario 5 (Siklus Alarm & Pencegahan Duplikasi)
  it("Skenario 5: Scheduler tick mengirim alarm TASK_ALARM dan pemanggilan berikutnya tidak mengirimkan duplikat", async () => {
    const dueAlarm = {
      id: "todo-alarm-e2e",
      title: "Kirim invoice vendor",
      due_at: new Date(baseNow.getTime() + 10 * 60_000),
      remind_at: baseNow,
      reminder_attempts: 1,
    };

    // Panggilan tick 1: Dapat lock dan klaim 1 alarm
    prismaMock.$queryRaw.mockResolvedValueOnce([{ name: "tick" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([dueAlarm]);

    const tick1 = await tick(baseNow);
    const alarmJobs1 = tick1.jobs.filter((j) => j.job_type === "TASK_ALARM");
    expect(alarmJobs1).toHaveLength(1);
    expect(alarmJobs1[0].body).toContain("Kirim invoice vendor");

    // Panggilan tick 2 (detik berikutnya): Klaim alarm mengembalikan 0 (sudah diklaim / skip locked)
    prismaMock.$queryRaw.mockResolvedValueOnce([{ name: "tick" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    const tick2 = await tick(new Date(baseNow.getTime() + 1000));
    const alarmJobs2 = tick2.jobs.filter((j) => j.job_type === "TASK_ALARM");
    expect(alarmJobs2).toHaveLength(0);
  });

  // 6. Skenario 6 (Validasi Graf & Kontrol Versi Optimistik)
  it("Skenario 6: Endpoint pipeline menolak graf siklik (HTTP 422) dan expected_version usang (HTTP 409)", async () => {
    // 1. Graf siklik (A -> B -> A) ditolak HTTP 422
    const cyclicConfig = {
      ...FLORIST_DECOR_PRESET,
      graph: {
        nodes: [
          { id: "node-trigger", type: "TRIGGER_INBOUND", position: { x: 0, y: 0 }, data: {} },
          { id: "node-a", type: "CUSTOM_WA_REPLY", position: { x: 100, y: 0 }, data: { message_template: "A" } },
          { id: "node-b", type: "CUSTOM_WA_REPLY", position: { x: 200, y: 0 }, data: { message_template: "B" } },
        ],
        edges: [
          { id: "e1", source: "node-trigger", target: "node-a" },
          { id: "e2", source: "node-a", target: "node-b" },
          { id: "e3", source: "node-b", target: "node-a" },
        ],
      },
    };

    const resCyclic = await pipelinePUT(
      makeJsonRequest("http://localhost/api/pipeline", {
        expected_version: 1,
        config: cyclicConfig,
      }, "PUT")
    );
    expect(resCyclic.status).toBe(422);

    // 2. Expected version usang (database v2, request v1) ditolak HTTP 409 Conflict
    prismaMock.pipelineConfig.findUnique.mockResolvedValueOnce({
      id: 1,
      version: 2,
      config_json: FLORIST_DECOR_PRESET,
    });

    const resConflict = await pipelinePUT(
      makeJsonRequest("http://localhost/api/pipeline", {
        expected_version: 1,
        config: FLORIST_DECOR_PRESET,
      }, "PUT")
    );
    expect(resConflict.status).toBe(409);
    const dataConflict = await resConflict.json();
    expect(dataConflict.current_version).toBe(2);
  });

  // 7. Skenario 7 (Ketahanan Antrean Prioritas)
  it("Skenario 7: Pesan darurat P0 diproses mendahului antrean pesan P2 dan kuota reservasi dihormati", async () => {
    const executedOrder: string[] = [];
    sendTextDirectMock.mockImplementation(async (_chatId: string, text: string) => {
      executedOrder.push(text);
      return { ok: true, text: async () => "{}", status: 200 };
    });

    const p2_1 = sendHumanizedMessage({
      chatId: "6281299990002@c.us",
      text: "P2-Cust-1",
      trigger: "CUSTOMER_REPLY",
      skipDelay: true,
    });
    const p2_2 = sendHumanizedMessage({
      chatId: "6281299990002@c.us",
      text: "P2-Cust-2",
      trigger: "CUSTOMER_REPLY",
      skipDelay: true,
    });
    const p0_alarm = sendHumanizedMessage({
      chatId: "6281299990001@c.us",
      text: "P0-ALARM",
      trigger: "TASK_ALARM",
      skipDelay: true,
    });

    await Promise.all([p2_1, p2_2, p0_alarm]);

    expect(executedOrder).toEqual(["P2-Cust-1", "P0-ALARM", "P2-Cust-2"]);
  });

  // 8. Skenario 8 (Failover Otomatis LLM Gateway)
  it("Skenario 8: Gateway melakukan retry 1x saat primary 429 lalu otomatis failover ke model fallback", async () => {
    const primaryConfig = {
      id: "llm-primary",
      provider: "OPENROUTER",
      model: "google/gemini-2.0-flash:free",
      base_url: "https://openrouter.ai/api/v1",
      api_key_enc: "enc-key",
      temperature: 0.3,
      max_output_tokens: 1000,
      is_active: true,
      is_fallback: false,
    };

    const fallbackConfig = {
      id: "llm-fallback",
      provider: "OPENAI",
      model: "openai/gpt-4o-mini",
      base_url: "https://api.openai.com/v1",
      api_key_enc: "enc-key",
      temperature: 0.3,
      max_output_tokens: 2000,
      is_active: true,
      is_fallback: true,
    };

    prismaMock.llmConfig.findFirst
      .mockResolvedValueOnce(primaryConfig)
      .mockResolvedValueOnce(fallbackConfig);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("openrouter.ai")) {
        return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-fallback",
          choices: [{ message: { role: "assistant", content: "Jawaban sukses dari model fallback!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const res = await llmCompletionPOST(
      makeJsonRequest("http://localhost/api/internal/llm/v1/chat/completions", {
        messages: [{ role: "user", content: "Halo bot" }],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices[0].message.content).toBe("Jawaban sukses dari model fallback!");
    expect(recordEventMock).toHaveBeenCalledWith(
      "WARN",
      "llm-gateway",
      "LLM_FALLBACK_TRIGGERED",
      expect.any(Object)
    );

    globalThis.fetch = originalFetch;
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/internal/inbound/accept/route";
import { pairingHash } from "../../src/lib/pairing";
import { OrderStatus } from "@prisma/client";
import { PERSONAL_ASSISTANT_PRESET } from "../../src/lib/pipeline/presets";
const {
  authMock,
  pairingCodeFindFirstMock,
  pairingCodeUpdateManyMock,
  authorizedNumberFindFirstMock,
  authorizedNumberUpsertMock,
  messageLogFindUniqueMock,
  messageLogFindFirstMock,
  messageLogCountMock,
  messageLogCreateMock,
  botSettingsFindUniqueMock,
  recordEventMock,
  lookupLidContactMock,
  customerSessionFindUniqueMock,
  orderFindFirstMock,
  orderFindUniqueMock,
  orderUpdateMock,
  orderFindManyMock,
  orderUpdateManyMock,
  pipelineConfigFindUniqueMock,
  customerSessionFindManyMock,
  customerSessionUpdateManyMock,
  customerSessionUpdateMock,
  pendingConfirmationFindFirstMock,
  pendingConfirmationUpdateManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  pairingCodeFindFirstMock: vi.fn(),
  pairingCodeUpdateManyMock: vi.fn(),
  authorizedNumberFindFirstMock: vi.fn(),
  authorizedNumberUpsertMock: vi.fn(),
  messageLogFindUniqueMock: vi.fn(),
  messageLogFindFirstMock: vi.fn(),
  messageLogCountMock: vi.fn(),
  messageLogCreateMock: vi.fn(),
  botSettingsFindUniqueMock: vi.fn(),
  recordEventMock: vi.fn(),
  lookupLidContactMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
  orderFindFirstMock: vi.fn(),
  orderFindUniqueMock: vi.fn(),
  orderUpdateMock: vi.fn(),
  orderFindManyMock: vi.fn(),
  orderUpdateManyMock: vi.fn(),
  pipelineConfigFindUniqueMock: vi.fn(),
  customerSessionFindManyMock: vi.fn(),
  customerSessionUpdateManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  pendingConfirmationFindFirstMock: vi.fn(),
  pendingConfirmationUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/waha/client", () => ({
  lookupLidContact: (...args: unknown[]) => lookupLidContactMock(...args),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

vi.mock("@/lib/db", () => {
  const txMock = {
    pairingCode: {
      findFirst: (...args: unknown[]) => pairingCodeFindFirstMock(...args),
      updateMany: (...args: unknown[]) => pairingCodeUpdateManyMock(...args),
    },
    authorizedNumber: {
      findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
      upsert: (...args: unknown[]) => authorizedNumberUpsertMock(...args),
    },
  };

  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      messageLog: {
        findUnique: (...args: unknown[]) => messageLogFindUniqueMock(...args),
        findFirst: (...args: unknown[]) => messageLogFindFirstMock(...args),
        count: (...args: unknown[]) => messageLogCountMock(...args),
        create: (...args: unknown[]) => messageLogCreateMock(...args),
      },
      botSettings: {
        findUnique: (...args: unknown[]) => botSettingsFindUniqueMock(...args),
      },
      customerSession: {
        findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
        findMany: (...args: unknown[]) => customerSessionFindManyMock(...args),
        updateMany: (...args: unknown[]) => customerSessionUpdateManyMock(...args),
        update: (...args: unknown[]) => customerSessionUpdateMock(...args),
      },
      authorizedNumber: {
        findFirst: (...args: unknown[]) => authorizedNumberFindFirstMock(...args),
        upsert: (...args: unknown[]) => authorizedNumberUpsertMock(...args),
      },
      pendingConfirmation: {
        findFirst: (...args: unknown[]) => pendingConfirmationFindFirstMock(...args),
        updateMany: (...args: unknown[]) => pendingConfirmationUpdateManyMock(...args),
      },
      order: {
        findFirst: (...args: unknown[]) => orderFindFirstMock(...args),
        findUnique: (...args: unknown[]) => orderFindUniqueMock(...args),
        update: (...args: unknown[]) => orderUpdateMock(...args),
        findMany: (...args: unknown[]) => orderFindManyMock(...args),
        updateMany: (...args: unknown[]) => orderUpdateManyMock(...args),
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
  return new Request("http://localhost:3000/api/internal/inbound/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/inbound/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    pendingConfirmationFindFirstMock.mockResolvedValue(null);
    pendingConfirmationUpdateManyMock.mockResolvedValue({ count: 1 });
    botSettingsFindUniqueMock.mockResolvedValue({
      id: 1,
      setup_completed: true,
      bot_enabled: true,
    });
    messageLogFindUniqueMock.mockResolvedValue(null);
    messageLogFindFirstMock.mockResolvedValue(null);
    messageLogCountMock.mockResolvedValue(0);
    orderFindFirstMock.mockResolvedValue(null);
    pipelineConfigFindUniqueMock.mockResolvedValue(null);
  });

  it("returns 400 with invalid_sender if non-LID sender cannot be normalized", async () => {
    const req = makeRequest({
      wa_message_id: "msg-invalid-01",
      chat_id: "invalid_sender_name",
      from: "invalid_sender_name",
      body: "PAIR-ABC234",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ accept: false, error: "invalid_sender" });
    expect(pairingCodeFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 400 with unresolvable_lid if @lid cannot be resolved via payload or lookup", async () => {
    lookupLidContactMock.mockResolvedValue(null);
    const req = makeRequest({
      wa_message_id: "msg-invalid-lid-01",
      chat_id: "160275344937145@lid",
      from: "160275344937145@lid",
      body: "PAIR-ABC234",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ accept: false, error: "unresolvable_lid" });
    expect(pairingCodeFindFirstMock).not.toHaveBeenCalled();
  });

  it("successfully pairs real observed WAHA NOWEB @lid sender carrying remote_jid_alt", async () => {
    const rawCode = "PAIR-8KJ84L";
    pairingCodeFindFirstMock.mockResolvedValue({
      id: "pair-lid-1",
      code_hash: pairingHash(rawCode),
      used_at: null,
      expires_at: new Date(Date.now() + 600000),
    });
    pairingCodeUpdateManyMock.mockResolvedValue({ count: 1 });
    authorizedNumberUpsertMock.mockResolvedValue({
      phone_e164: "+6287881820571",
      chat_id: "160275344937145@lid",
      is_owner: true,
    });

    const req = makeRequest({
      wa_message_id: "false_160275344937145@lid_3B754E6DE938F57735EB",
      chat_id: "160275344937145@lid",
      from: "160275344937145@lid",
      remote_jid_alt: "6287881820571@s.whatsapp.net",
      body: rawCode,
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.paired).toBe(true);
    expect(data.phone_e164).toBe("+6287881820571");
    expect(data.chat_id).toBe("160275344937145@lid");
    expect(data.reply_text).toContain("berhasil diotorisasi sebagai Owner");
  });

  it("successfully pairs on valid code + valid sender", async () => {
    const rawCode = "PAIR-XYZ789";
    pairingCodeFindFirstMock.mockResolvedValue({
      id: "pair-1",
      code_hash: pairingHash(rawCode),
      used_at: null,
      expires_at: new Date(Date.now() + 600000),
    });
    pairingCodeUpdateManyMock.mockResolvedValue({ count: 1 });
    authorizedNumberUpsertMock.mockResolvedValue({
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });

    const req = makeRequest({
      wa_message_id: "msg-pair-01",
      chat_id: "6281234567890@c.us",
      body: rawCode,
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.paired).toBe(true);
    expect(data.phone_e164).toBe("+6281234567890");
    expect(data.reply_text).toContain("berhasil diotorisasi sebagai Owner");

    expect(pairingCodeUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pair-1", used_at: null },
      }),
    );
    expect(authorizedNumberUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone_e164: "+6281234567890" },
        create: expect.objectContaining({
          phone_e164: "+6281234567890",
          chat_id: "6281234567890@c.us",
          is_owner: true,
        }),
      }),
    );
  });

  it("handles valid code retry from already paired owner without duplicates", async () => {
    pairingCodeFindFirstMock.mockResolvedValue(null);
    authorizedNumberFindFirstMock.mockResolvedValue({
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });

    const req = makeRequest({
      wa_message_id: "msg-pair-02",
      chat_id: "6281234567890@c.us",
      body: "PAIR-XYZ789",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.paired).toBe(true);
    expect(data.reply_text).toContain("sudah terhubung sebagai Owner");
    expect(authorizedNumberUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects invalid/expired pairing code from unauthorized sender without replying (INV-07)", async () => {
    pairingCodeFindFirstMock.mockResolvedValue(null);
    authorizedNumberFindFirstMock.mockResolvedValue(null);

    const req = makeRequest({
      wa_message_id: "msg-pair-03",
      chat_id: "6289999999999@c.us",
      body: "PAIR-EXPIRE",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("INVALID_PAIRING_CODE");
    expect(data.reply_text).toBeNull();
    expect(recordEventMock).toHaveBeenCalledWith(
      "WARN",
      "inbound",
      "inbound.invalid_pairing",
      expect.objectContaining({ phone_e164: "+6289999999999" }),
    );
  });

  it("routes unauthorized non-pairing sender to CUSTOMER role", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    const req = makeRequest({
      wa_message_id: "msg-norm-01",
      chat_id: "6289999999999@c.us",
      body: "Halo bot!",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.role).toBe("CUSTOMER");
    expect(data.customer_phone).toBe("+6289999999999");
    expect(data.intent).toBeNull();
  });

  it("accepts fromMe=true on customer chat if it contains full order format", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    const orderBody = `*FORMAT PESANAN BERSERI*
• Nama Pemesan: Bu Anita
• Jenis Pesanan: Buket Mawar
• Tanggal Acara: 15 November 2026
• Alamat: Jakarta`;

    const req = makeRequest({
      wa_message_id: "msg-from-me-order",
      chat_id: "6288888888888@c.us",
      body: orderBody,
      from_me: true,
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.role).toBe("CUSTOMER");
    expect(data.intent).toBe("SUBMIT_ORDER");
    expect(data.customer_phone).toBe("+6288888888888");
  });

  it("rejects fromMe=true on customer chat if regular chat message", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    const req = makeRequest({
      wa_message_id: "msg-from-me-regular",
      chat_id: "6288888888888@c.us",
      body: "Baik kak, ditunggu ya",
      from_me: true,
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("OWNER_MANUAL_MESSAGE");
  });

  it("ignores WhatsApp group messages (@g.us)", async () => {
    const req = makeRequest({
      wa_message_id: "msg-group-01",
      chat_id: "123456789-987654@g.us",
      from: "123456789-987654@g.us",
      phone: "628123456789",
      body: "Halo grup!",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("GROUP_IGNORED");
  });

  it("rejects duplicate message matching customer session last_message_id", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue({
      phone_e164: "+6289999999999",
      metadata: { last_message_id: "msg-dupe-customer" },
    });

    const req = makeRequest({
      wa_message_id: "msg-dupe-customer",
      chat_id: "6289999999999@c.us",
      body: "Halo lagi",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("DUPLICATE");
  });

  it("applies rate limiting for customer messages > 20 per minute", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    let lastRes: Response | undefined;
    for (let i = 0; i < 21; i++) {
      const req = makeRequest({
        wa_message_id: `msg-rate-${i}`,
        chat_id: "6287777777777@c.us",
        body: `Spam ${i}`,
        received_at: new Date().toISOString(),
      });
      lastRes = await POST(req);
    }

    expect(lastRes).toBeDefined();
    expect(lastRes!.status).toBe(200);
    const data = await lastRes!.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("RATE_LIMITED");
  });

  it("returns role OWNER for authorized owner messages", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-owner-1",
      wa_message_id: "msg-owner-role",
      chat_id: "6281234567890@c.us",
    });

    const req = makeRequest({
      wa_message_id: "msg-owner-role",
      chat_id: "6281234567890@c.us",
      body: "Halo dari owner",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.role).toBe("OWNER");
  });
  it("mutes bot when customer has active incomplete order (ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED)", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);
    orderFindFirstMock.mockResolvedValue({
      id: "ord-active-1",
      customer_contact: "+6289999999999",
      notes: "Jam Pengiriman: 10:00 WIB",
      payment_status: "UNPAID",
    });

    const req = makeRequest({
      wa_message_id: "msg-cust-active-order",
      chat_id: "6289999999999@c.us",
      body: "Halo bot, tolong cek lagi dong",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");
  });

  it("strictly mutes bot when customer has active order, even if sending 'MENU'", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);
    orderFindFirstMock.mockResolvedValue({
      id: "active-ord-1",
      customer_chat_id: "6289999999999@c.us",
      customer_contact: "+6289999999999",
      status: "IN_PROGRESS",
      created_at: new Date(),
    });

    const req = makeRequest({
      wa_message_id: "msg-cust-bypass",
      chat_id: "6289999999999@c.us",
      body: "MENU",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("ACTIVE_ORDER_IN_PROGRESS_BOT_MUTED");
  });

  it("sends reminder once when mute TTL is exceeded (MUTE_TTL_EXPIRED_REMINDER_SENT)", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    const pastDate = new Date(Date.now() - 50 * 3600 * 1000); // 50 jam lalu (> 48 jam)
    orderFindFirstMock.mockResolvedValue({
      id: "active-ord-old",
      customer_chat_id: "6289999999999@c.us",
      customer_contact: "+6289999999999",
      status: "IN_PROGRESS",
      created_at: pastDate,
    });

    const session = {
      id: "sess-cust-old",
      phone_e164: "+6289999999999",
      metadata: {},
    };
    customerSessionFindUniqueMock.mockResolvedValue(session);
    customerSessionUpdateMock.mockResolvedValue({});

    const req = makeRequest({
      wa_message_id: "msg-cust-ttl-expired",
      chat_id: "6289999999999@c.us",
      body: "halo gimana pesanan saya?",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.reason).toBe("MUTE_TTL_EXPIRED_REMINDER_SENT");
    expect(data.reply_text).toContain("Pesanan Anda sedang dikonfirmasi/ditangani admin");
    expect(data.reply_text).toContain("Ketik MENU");
    expect(customerSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-cust-old" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            ttl_warning_sent_at: expect.any(String),
          }),
        }),
      })
    );
  });

  it("auto-heals customer session and accepts chat when customer has no active orders", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "sess-heal-1",
      phone_e164: "+6289999999999",
      state: "PAUSED_FOR_OWNER",
      paused_at: null,
      metadata: { waiting_since: "2026-11-04T10:00:00Z", unread_count: 2 },
    });
    customerSessionFindManyMock.mockResolvedValue([
      {
        id: "sess-heal-1",
        phone_e164: "+6289999999999",
        state: "PAUSED_FOR_OWNER",
        metadata: { waiting_since: "2026-11-04T10:00:00Z", unread_count: 2 },
      },
    ]);
    customerSessionUpdateMock.mockResolvedValue({});
    orderFindFirstMock.mockResolvedValue(null); // No active order

    const req = makeRequest({
      wa_message_id: "msg-cust-auto-heal",
      chat_id: "6289999999999@c.us",
      body: "Halo Berseri",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.role).toBe("CUSTOMER");
    expect(customerSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-heal-1" },
        data: expect.objectContaining({
          state: "ACTIVE",
          paused_at: null,
          metadata: expect.objectContaining({
            waiting_since: null,
            unread_count: 0,
          }),
        }),
      })
    );
  });

  it("rejects non-owner when allow_unregistered_customers is false (PUBLIC_CUSTOMER_DISABLED)", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue(null);
    pipelineConfigFindUniqueMock.mockResolvedValue({
      id: 1,
      name: "Private Pipeline",
      preset_key: "PERSONAL_ASSISTANT",
      config_json: PERSONAL_ASSISTANT_PRESET,
      version: 1,
    });

    const req = makeRequest({
      wa_message_id: "msg-cust-unregistered",
      chat_id: "6289999999999@c.us",
      body: "Halo bot",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(false);
    expect(data.reason).toBe("PUBLIC_CUSTOMER_DISABLED");
  });


  it("accepts normal chat message from authorized owner", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-1",
      wa_message_id: "msg-norm-02",
      chat_id: "6281234567890@c.us",
    });

    const req = makeRequest({
      wa_message_id: "msg-norm-02",
      chat_id: "6281234567890@c.us",
      body: "Apa to-do saya hari ini?",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.paired).toBe(false);
    expect(data.reason).toBe("OK");
    expect(messageLogCreateMock).toHaveBeenCalled();
  });

  it("executes pending confirmation deterministically when owner replies 'ya' and sends CONFIRMATION_REPLY", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-confirm-1",
      wa_message_id: "msg-owner-ya",
      chat_id: "6281234567890@c.us",
    });

    pendingConfirmationFindFirstMock.mockResolvedValue({
      id: "conf-1",
      owner_chat_id: "6281234567890@c.us",
      action: "DELETE",
      payload_json: { order_id: "order-uuid-123" },
      created_message_id: "msg-prev-command",
      expires_at: new Date(Date.now() + 180_000), // 3 menit lagi
    });

    orderFindUniqueMock.mockResolvedValue({
      id: "order-uuid-123",
      customer_name: "Budi Santoso",
      customer_contact: "+628111222333",
    });
    orderUpdateMock.mockResolvedValue({});

    const req = makeRequest({
      wa_message_id: "msg-owner-ya",
      chat_id: "6281234567890@c.us",
      body: "ya",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accept).toBe(true);
    expect(data.reason).toBe("CONFIRMED_ACTION_EXECUTED");
    expect(data.trigger_type).toBe("CONFIRMATION_REPLY");
    expect(data.reply_text).toContain("berhasil dihapus");
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-uuid-123" },
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          deleted_at: expect.any(Date),
        }),
      })
    );
    expect(customerSessionFindManyMock).toHaveBeenCalled();
  });

  it("prevents self-confirmation when message_id matches created_message_id", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-confirm-2",
      wa_message_id: "msg-same-id",
      chat_id: "6281234567890@c.us",
    });

    pendingConfirmationFindFirstMock.mockResolvedValue({
      id: "conf-2",
      owner_chat_id: "6281234567890@c.us",
      action: "DELETE",
      payload_json: { order_id: "order-uuid-123" },
      created_message_id: "msg-same-id", // Same ID as incoming
      expires_at: new Date(Date.now() + 180_000),
    });

    const req = makeRequest({
      wa_message_id: "msg-same-id",
      chat_id: "6281234567890@c.us",
      body: "ya",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Not confirmed because message_id matches created_message_id
    expect(data.reason).toBe("OK");
    expect(orderUpdateMock).not.toHaveBeenCalled();
  });

  it("returns CONFIRMATION_EXPIRED when pending confirmation has expired and owner replies 'ya'", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-confirm-3",
      wa_message_id: "msg-late-ya",
      chat_id: "6281234567890@c.us",
    });

    pendingConfirmationFindFirstMock
      .mockResolvedValueOnce(null) // active pending check
      .mockResolvedValueOnce({
        id: "conf-expired",
        owner_chat_id: "6281234567890@c.us",
        expires_at: new Date(Date.now() - 60_000), // 1 menit lalu
      });

    const req = makeRequest({
      wa_message_id: "msg-late-ya",
      chat_id: "6281234567890@c.us",
      body: "ya",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reason).toBe("CONFIRMATION_EXPIRED");
    expect(data.trigger_type).toBe("CONFIRMATION_REPLY");
    expect(data.reply_text).toContain("telah kedaluwarsa");
    expect(orderUpdateMock).not.toHaveBeenCalled();
  });

  it("cancels pending confirmation when owner sends any other non-confirmation message", async () => {
    authorizedNumberFindFirstMock.mockResolvedValue({
      id: "auth-1",
      phone_e164: "+6281234567890",
      chat_id: "6281234567890@c.us",
      is_owner: true,
    });
    messageLogCreateMock.mockResolvedValue({
      id: "log-other-msg",
      wa_message_id: "msg-other-1",
      chat_id: "6281234567890@c.us",
    });

    pendingConfirmationFindFirstMock.mockResolvedValue({
      id: "conf-to-cancel",
      owner_chat_id: "6281234567890@c.us",
      created_message_id: "msg-prev-cmd",
      expires_at: new Date(Date.now() + 180_000),
    });

    const req = makeRequest({
      wa_message_id: "msg-other-1",
      chat_id: "6281234567890@c.us",
      body: "apa agenda hari ini?",
      received_at: new Date().toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reason).toBe("OK");
    expect(pendingConfirmationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conf-to-cancel", executed_at: null },
        data: { expires_at: new Date(0) },
      })
    );
  });
});

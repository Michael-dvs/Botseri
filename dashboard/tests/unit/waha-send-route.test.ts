import type * as HumanizerModule from "@/lib/waha/humanizer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/internal/waha/send/route";

const {
  authMock,
  findFirstMock,
  createMock,
  sendHumanizedMessageMock,
  authorizedFindUniqueMock,
  customerSessionFindUniqueMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  sendHumanizedMessageMock: vi.fn(),
  authorizedFindUniqueMock: vi.fn(),
  customerSessionFindUniqueMock: vi.fn(),
}));

// Mock internal auth
vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    messageLog: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
    authorizedNumber: {
      findUnique: (...args: unknown[]) => authorizedFindUniqueMock(...args),
    },
    customerSession: {
      findUnique: (...args: unknown[]) => customerSessionFindUniqueMock(...args),
    },
  },
}));

// Mock humanizer
vi.mock("@/lib/waha/humanizer", async (importOriginal) => {
  const actual = await importOriginal<typeof HumanizerModule>();
  return {
    ...actual,
    sendHumanizedMessage: (...args: unknown[]) =>
      sendHumanizedMessageMock(...args),
  };
});

describe("POST /api/internal/waha/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "log-uuid-123" });
    authorizedFindUniqueMock.mockResolvedValue({ chat_id: "6281234567890@c.us" });
    customerSessionFindUniqueMock.mockResolvedValue(null);
    sendHumanizedMessageMock.mockResolvedValue({
      ok: true,
      response: { id: "waha-msg-123" },
    });
  });
  it("returns 401 if internal authorization fails", async () => {
    authMock.mockReturnValue(false);
    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6281234567890@c.us",
        body: "Halo",
        trigger_type: "CHAT_MASUK",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("sends message and creates message_log record", async () => {
    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6281234567890@c.us",
        body: "Pesanan Anda sudah siap.",
        trigger_type: "CHAT_MASUK",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message_id).toBe("log-uuid-123");
    expect(sendHumanizedMessageMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "OUTBOUND",
          chat_id: "6281234567890@c.us",
          body: "Pesanan Anda sudah siap.",
        }),
      }),
    );
  });

  it("suppresses duplicate outbound message within 45s", async () => {
    findFirstMock.mockResolvedValue({
      id: "previous-log-uuid",
      body: "Pesan yang sama persis",
      created_at: new Date(Date.now() - 10000),
    });

    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6281234567890@c.us",
        body: "Pesan yang sama persis",
        trigger_type: "CHAT_MASUK",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.skipped).toBe(true);
    expect(data.reason).toBe("DUPLICATE_OUTBOUND_SUPPRESSED");
    expect(data.message_id).toBe("previous-log-uuid");

    expect(sendHumanizedMessageMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("suppresses a repeated scheduler job by idempotency key", async () => {
    findFirstMock.mockResolvedValue({ id: "scheduler-log-uuid" });
    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6281234567890@c.us",
        body: "Brief yang sama",
        trigger_type: "MORNING_BRIEF",
        idempotency_key: "job-uuid-123",
      }),
    });

    const res = await POST(req);
    expect(await res.json()).toMatchObject({
      ok: true,
      skipped: true,
      reason: "IDEMPOTENT_OUTBOUND_SUPPRESSED",
      message_id: "scheduler-log-uuid",
    });
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { direction: "OUTBOUND", in_reply_to: "scheduler:job-uuid-123" },
      select: { id: true },
    });
    expect(sendHumanizedMessageMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("converts @lid chat_id to @c.us when phone_e164 is provided", async () => {
    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "160275344937145@lid",
        phone_e164: "+6287881820571",
        body: "Nomor Anda berhasil diotorisasi sebagai Owner Botseri!",
        trigger_type: "PAIRING",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(sendHumanizedMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "6287881820571@c.us",
        isPairing: true,
      }),
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chat_id: "6287881820571@c.us",
        }),
      }),
    );
  });

  it("allows recipient registered in customer_sessions with trigger CUSTOMER_REPLY", async () => {
    authorizedFindUniqueMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue({
      id: "cust-sess-1",
      phone_e164: "+6281234567890",
    });

    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6281234567890@c.us",
        phone_e164: "+6281234567890",
        body: "Halo Kak, ada yang bisa dibantu?",
        trigger_type: "CUSTOMER_REPLY",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(sendHumanizedMessageMock).toHaveBeenCalledTimes(1);
  });

  it("rejects recipient neither in authorized_numbers nor customer_sessions with 403", async () => {
    authorizedFindUniqueMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6289999999999@c.us",
        phone_e164: "+6289999999999",
        body: "Halo stranger",
        trigger_type: "CHAT_MASUK",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe("UNAUTHORIZED_RECIPIENT");
    expect(data.error).toContain("Nomor tujuan tidak terdaftar");
    expect(sendHumanizedMessageMock).not.toHaveBeenCalled();
  });

  it("allows NEW_ORDER_ALERT to bypass recipient check", async () => {
    authorizedFindUniqueMock.mockResolvedValue(null);
    customerSessionFindUniqueMock.mockResolvedValue(null);

    const req = new Request("http://localhost/api/internal/waha/send", {
      method: "POST",
      body: JSON.stringify({
        chat_id: "6289999999999@c.us",
        phone_e164: "+6289999999999",
        body: "🔔 Pesanan Baru Masuk!",
        trigger_type: "NEW_ORDER_ALERT",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(sendHumanizedMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isPairing: true,
      }),
    );
  });
});

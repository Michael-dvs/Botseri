import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePhone, toChatId } from "@/lib/customer/phone";
import { unmuteCustomerSessionByOrder } from "@/lib/customer/session";
import { buildOwnerDigestJob } from "@/lib/scheduler/tick";

const {
  customerSessionFindManyMock,
  customerSessionUpdateMock,
  systemEventFindFirstMock,
  recordEventMock,
} = vi.hoisted(() => ({
  customerSessionFindManyMock: vi.fn(),
  customerSessionUpdateMock: vi.fn(),
  systemEventFindFirstMock: vi.fn(),
  recordEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customerSession: {
      findMany: (...args: unknown[]) => customerSessionFindManyMock(...args),
      update: (...args: unknown[]) => customerSessionUpdateMock(...args),
    },
    systemEvent: {
      findFirst: (...args: unknown[]) => systemEventFindFirstMock(...args),
    },
  },
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

describe("S05: Phone Normalization (normalizePhone & toChatId)", () => {
  it("case 1: normalizes local 08xx with spaces and dashes", () => {
    expect(normalizePhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizePhone("0812 3456 7890")).toBe("6281234567890");
  });

  it("case 2: normalizes +628xx with plus and spaces", () => {
    expect(normalizePhone("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalizePhone("+6281234567890")).toBe("6281234567890");
  });

  it("case 3: normalizes WhatsApp JID with @c.us suffix", () => {
    expect(normalizePhone("6281234567890@c.us")).toBe("6281234567890");
    expect(normalizePhone("081234567890@c.us")).toBe("6281234567890");
  });

  it("case 4: normalizes JID with device index suffix (e.g. :1@c.us)", () => {
    expect(normalizePhone("6281234567890:1@c.us")).toBe("6281234567890");
    expect(normalizePhone("+6281234567890:22@s.whatsapp.net")).toBe("6281234567890");
  });

  it("case 5: normalizes numbers with dots and parentheses", () => {
    expect(normalizePhone("0812.3456.7890")).toBe("6281234567890");
    expect(normalizePhone("(0812) 3456-7890")).toBe("6281234567890");
  });

  it("case 6: normalizes number without leading 0 or 62 (starting directly with 8xx)", () => {
    expect(normalizePhone("81234567890")).toBe("6281234567890");
    expect(normalizePhone("85712345678")).toBe("6285712345678");
  });

  it("case 7: normalizes +08xx format", () => {
    expect(normalizePhone("+081234567890")).toBe("6281234567890");
  });

  it("case 8: returns null for invalid strings or non-numeric text", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("halo")).toBeNull();
    expect(normalizePhone("@instagram_handle")).toBeNull();
  });

  it("case 9: returns null for group JID (@g.us), broadcast, newsletter", () => {
    expect(normalizePhone("1234567890-987654@g.us")).toBeNull();
    expect(normalizePhone("status@broadcast")).toBeNull();
    expect(normalizePhone("123456@newsletter")).toBeNull();
  });

  it("case 10: returns null for numbers that are too short (< 8 digits) or too long (> 16 digits)", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("0812")).toBeNull();
    expect(normalizePhone("12345678901234567890")).toBeNull();
  });

  it("case 11: preserves opaque lid JID safely or extracts digits if valid", () => {
    const res = normalizePhone("120363025244@lid");
    expect(res === "120363025244" || res === null).toBe(true);
  });

  it("case 12: toChatId converts normalized or raw phone to proper WhatsApp JID", () => {
    expect(toChatId("081234567890")).toBe("6281234567890@c.us");
    expect(toChatId("+6281234567890")).toBe("6281234567890@c.us");
    expect(toChatId("6281234567890@c.us")).toBe("6281234567890@c.us");
    expect(toChatId("6281234567890")).toBe("6281234567890@c.us");
  });
});

describe("S05: Unified Session Unmuter (unmuteCustomerSessionByOrder)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unmutes session using customer_chat_id even if customer_contact differs", async () => {
    const realSession = {
      id: "sess-real-whatsapp",
      phone_e164: "+6289999999999",
      state: "PAUSED_FOR_OWNER",
      metadata: {
        draft: { some: "data" },
        retry_count: 2,
        waiting_since: "2026-11-04T10:00:00Z",
        unread_count: 3,
      },
    };

    customerSessionFindManyMock.mockResolvedValue([realSession]);
    customerSessionUpdateMock.mockResolvedValue({});

    // Order was submitted with a different receiver phone in form ("081111111111"),
    // but customer_chat_id is the real WhatsApp sender JID ("6289999999999@c.us")
    const order = {
      customer_chat_id: "6289999999999@c.us",
      customer_contact: "081111111111",
    };

    const count = await unmuteCustomerSessionByOrder(order);
    expect(count).toBe(1);
    expect(customerSessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess-real-whatsapp" },
        data: expect.objectContaining({
          state: "ACTIVE",
          paused_at: null,
          metadata: expect.objectContaining({
            draft: null,
            retry_count: 0,
            waiting_since: null,
            unread_count: 0,
          }),
        }),
      })
    );
  });
});

describe("S05: Owner Digest Evaluation (buildOwnerDigestJob)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no customers are waiting", async () => {
    customerSessionFindManyMock.mockResolvedValue([]);
    const job = await buildOwnerDigestJob(new Date(), "Asia/Jakarta", "owner@c.us");
    expect(job).toBeNull();
  });

  it("returns null when recent OWNER_DIGEST was sent within 2 hours", async () => {
    customerSessionFindManyMock.mockResolvedValue([
      {
        id: "s1",
        phone_e164: "+628123456789",
        customer_name: "Budi",
        metadata: { waiting_since: new Date(Date.now() - 3600_000).toISOString(), unread_count: 2 },
      },
    ]);

    // System event within 2 hours
    systemEventFindFirstMock.mockResolvedValue({ id: "event-recent-digest" });

    // 10:00 AM WIB (reasonable hour)
    const testNow = new Date("2026-11-04T03:00:00Z"); // 10:00 WIB
    const job = await buildOwnerDigestJob(testNow, "Asia/Jakarta", "owner@c.us");
    expect(job).toBeNull();
  });

  it("creates OWNER_DIGEST job summarizing waiting customers when cooldown passed and hour is reasonable", async () => {
    const waitingSessions = [
      {
        id: "s1",
        phone_e164: "+628123456789",
        customer_name: "Ani",
        metadata: { waiting_since: new Date(Date.now() - 45 * 60_000).toISOString(), unread_count: 2 },
      },
      {
        id: "s2",
        phone_e164: "+628987654321",
        customer_name: null,
        metadata: { waiting_since: new Date(Date.now() - 15 * 60_000).toISOString(), unread_count: 1 },
      },
    ];

    customerSessionFindManyMock.mockResolvedValue(waitingSessions);
    systemEventFindFirstMock.mockResolvedValue(null); // No recent digest

    // 10:00 AM WIB
    const testNow = new Date("2026-11-04T03:00:00Z");
    const job = await buildOwnerDigestJob(testNow, "Asia/Jakarta", "6281234567890@c.us");
    expect(job).not.toBeNull();
    expect(job?.job_type).toBe("OWNER_DIGEST");
    expect(job?.chat_id).toBe("6281234567890@c.us");
    expect(job?.body).toContain("Ada 2 pelanggan yang sedang menunggu");
    expect(job?.body).toContain("Ani");
    expect(job?.skip_llm).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetHumanizerState,
  calculateTypingDuration,
  HumanizerError,
  sendHumanizedMessage,
} from "../../src/lib/waha/humanizer";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    authorizedNumber: {
      findUnique: vi.fn(async ({ where }: { where: { chat_id: string } }) => {
        if (where.chat_id === "6281111111111@c.us") {
          return { chat_id: "6281111111111@c.us", is_owner: true };
        }
        return null;
      }),
    },
    messageLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock events
vi.mock("@/lib/events", () => ({
  recordEvent: vi.fn(async () => {}),
}));

// Mock waha client
const sendTextDirectMock = vi.fn();
const startTypingMock = vi.fn();
const stopTypingMock = vi.fn();
const sendSeenMock = vi.fn();

vi.mock("../../src/lib/waha/client", () => ({
  sendSeen: (...args: unknown[]) => sendSeenMock(...args),
  startTyping: (...args: unknown[]) => startTypingMock(...args),
  stopTyping: (...args: unknown[]) => stopTypingMock(...args),
  sendTextDirect: (...args: unknown[]) => sendTextDirectMock(...args),
}));

describe("WAHA Anti-Ban Humanizer (INV-13)", () => {
  beforeEach(() => {
    __resetHumanizerState();
    vi.clearAllMocks();
    startTypingMock.mockResolvedValue(true);
    stopTypingMock.mockResolvedValue(true);
    sendSeenMock.mockResolvedValue(true);
    sendTextDirectMock.mockImplementation(
      () =>
        new Response(JSON.stringify({ id: "msg-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
  });

  describe("1. Typing Duration Calculation", () => {
    it("clamps short text (e.g. 'ok') to minimum 1,500ms", () => {
      const duration = calculateTypingDuration("ok", () => 0.5);
      expect(duration).toBe(1500);
    });

    it("clamps long text (>250 chars) to maximum 7,500ms", () => {
      const longText = "A".repeat(300);
      const duration = calculateTypingDuration(longText, () => 0.5);
      expect(duration).toBe(7500);
    });

    it("calculates realistic human typing duration between 1,500ms and 7,500ms", () => {
      const sample = "Halo, pesanan buket Anda sedang dipersiapkan untuk dikirim.";
      for (let i = 0; i < 20; i++) {
        const duration = calculateTypingDuration(sample);
        expect(duration).toBeGreaterThanOrEqual(1500);
        expect(duration).toBeLessThanOrEqual(7500);
      }
    });
  });

  describe("2. Recipient Validation", () => {
    it("rejects non-personal chats (groups, broadcasts)", async () => {
      await expect(
        sendHumanizedMessage({
          chatId: "123456789-987654@g.us",
          text: "Halo grup",
          skipDelay: true,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "NON_PERSONAL_CHAT_FORBIDDEN",
          status: 400,
        }),
      );

      await expect(
        sendHumanizedMessage({
          chatId: "status@broadcast",
          text: "Halo broadcast",
          skipDelay: true,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "NON_PERSONAL_CHAT_FORBIDDEN",
          status: 400,
        }),
      );
    });

    it("rejects unauthorized recipients unless isPairing is true", async () => {
      await expect(
        sendHumanizedMessage({
          chatId: "6289999999999@c.us",
          text: "Halo orang asing",
          skipDelay: true,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "UNAUTHORIZED_RECIPIENT",
          status: 403,
        }),
      );

      // Pairing message to any number is allowed
      const result = await sendHumanizedMessage({
        chatId: "6289999999999@c.us",
        text: "Konfirmasi pairing",
        isPairing: true,
        skipDelay: true,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("3. Sliding-Window Rate Limiter (Max 4 msgs / 60s)", () => {
    it("allows up to 4 messages within 1 minute, and blocks the 5th with 429", async () => {
      const chatId = "6281111111111@c.us";

      // 4 messages must succeed
      for (let i = 1; i <= 4; i++) {
        const res = await sendHumanizedMessage({
          chatId,
          text: `Pesan nomor ${i}`,
          trigger: "TASK_ALARM",
          skipDelay: true,
        });
        expect(res.ok).toBe(true);
      }

      // 5th message must be blocked by rate-limiter
      await expect(
        sendHumanizedMessage({
          chatId,
          text: "Pesan nomor 5 yang melanggar batas",
          trigger: "TASK_ALARM",
          skipDelay: true,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "WAHA_RATE_LIMIT_BLOCKED",
          status: 429,
        }),
      );
    });
  });

  describe("4. Circuit Breaker (Auto-Cooldown on 3 Failures)", () => {
    it("trips circuit breaker after 3 consecutive failures, blocking 4th call without hitting WAHA", async () => {
      const chatId = "6281111111111@c.us";

      // Mock WAHA failure (e.g. 500 error)
      sendTextDirectMock.mockImplementation(
        () => new Response("Internal Server Error in WAHA", { status: 500 }),
      );

      // Fail 1
      await expect(
        sendHumanizedMessage({ chatId, text: "Gagal 1", skipDelay: true }),
      ).rejects.toThrowError(HumanizerError);

      // Fail 2
      await expect(
        sendHumanizedMessage({ chatId, text: "Gagal 2", skipDelay: true }),
      ).rejects.toThrowError(HumanizerError);

      // Fail 3
      await expect(
        sendHumanizedMessage({ chatId, text: "Gagal 3", skipDelay: true }),
      ).rejects.toThrowError(HumanizerError);

      expect(sendTextDirectMock).toHaveBeenCalledTimes(3);

      // 4th call must be blocked immediately by circuit breaker without calling WAHA!
      await expect(
        sendHumanizedMessage({ chatId, text: "Panggilan 4", skipDelay: true }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "WAHA_CIRCUIT_BREAKER_OPEN",
          status: 503,
        }),
      );

      // Verify sendTextDirect was NOT called a 4th time
      expect(sendTextDirectMock).toHaveBeenCalledTimes(3);
    });
  });
});

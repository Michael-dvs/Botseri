import type { LlmConfig } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/internal/llm/v1/chat/completions/route";
import { NoActiveLlmError, ProviderError } from "../../src/lib/llm-gateway";
const { authMock, chatCompletionMock, safeRecordUsageMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  chatCompletionMock: vi.fn(),
  safeRecordUsageMock: vi.fn(),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/llm-gateway", () => {
  class MockNoActiveLlmError extends Error {
    constructor() {
      super("LLM aktif belum dikonfigurasi");
      this.name = "NoActiveLlmError";
    }
  }
  class MockProviderError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly config: unknown = {},
      readonly provider: string = "OPENROUTER",
      readonly latencyMs: number = 25000,
    ) {
      super(message);
      this.name = "ProviderError";
    }
  }
  return {
    NoActiveLlmError: MockNoActiveLlmError,
    ProviderError: MockProviderError,
    chatCompletion: (...args: unknown[]) => chatCompletionMock(...args),
  };
});

vi.mock("@/lib/llm-gateway/usage", () => ({
  safeRecordUsage: (...args: unknown[]) => safeRecordUsageMock(...args),
}));

function makeReq(body: unknown, authorized = true) {
  authMock.mockReturnValue(authorized);
  return new Request("http://localhost/api/internal/llm/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/internal/llm/v1/chat/completions (Hardened Gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue(true);
    safeRecordUsageMock.mockResolvedValue(undefined);
  });

  describe("Failure-mode tests (Step 6.2)", () => {
    it("immediately returns 401 with OpenAI-style error when internal token is invalid", async () => {
      const start = Date.now();
      const res = await POST(
        makeReq(
          {
            messages: [{ role: "user", content: "Halo" }],
          },
          false,
        ),
      );
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toEqual({
        message: "Unauthorized",
        type: "invalid_request_error",
        code: "unauthorized",
      });
      expect(chatCompletionMock).not.toHaveBeenCalled();
    });

    it("returns 503 with OpenAI-style error in well under a second when no active provider config exists", async () => {
      chatCompletionMock.mockRejectedValue(new NoActiveLlmError());
      const start = Date.now();
      const res = await POST(
        makeReq({
          messages: [{ role: "user", content: "Halo" }],
        }),
      );
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toEqual({
        message: "No active LLM configuration available",
        type: "server_error",
        code: "no_active_llm_config",
      });
    });

    it("returns 504 with OpenAI-style error when upstream times out", async () => {
      chatCompletionMock.mockRejectedValue(
        new ProviderError("Upstream provider timeout", 504, {} as unknown as LlmConfig, "OPENROUTER", 25000),
      );
      const res = await POST(
        makeReq({
          messages: [{ role: "user", content: "Halo" }],
        }),
      );
      expect(res.status).toBe(504);
      const data = await res.json();
      expect(data.error).toEqual({
        message: "Upstream provider timeout",
        type: "timeout_error",
        code: "upstream_timeout",
      });
      expect(safeRecordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        }),
      );
    });

    it("returns 502 with OpenAI-style error when upstream provider fails with 5xx", async () => {
      chatCompletionMock.mockRejectedValue(
        new ProviderError("Upstream 500 error", 502, {} as unknown as LlmConfig, "OPENROUTER", 1000),
      );
      const res = await POST(
        makeReq({
          messages: [{ role: "user", content: "Halo" }],
        }),
      );
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toEqual({
        message: "Upstream 500 error",
        type: "upstream_error",
        code: "upstream_error",
      });
    });
  });

  describe("Success modes", () => {
    it("returns non-streaming completion successfully", async () => {
      chatCompletionMock.mockResolvedValue({
        body: {
          id: "chatcmpl-test-123",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Halo! Ada yang bisa dibantu?" },
              finish_reason: "stop",
            },
          ],
        },
        config: {},
        provider: "OPENROUTER",
        latencyMs: 1200,
      });

      const res = await POST(
        makeReq({
          messages: [{ role: "user", content: "Halo" }],
          stream: false,
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("chatcmpl-test-123");
      expect(data.choices[0].message.content).toBe("Halo! Ada yang bisa dibantu?");
      expect(safeRecordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it("returns streaming SSE completion ending with [DONE]", async () => {
      chatCompletionMock.mockResolvedValue({
        body: {
          id: "chatcmpl-stream-123",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Streaming halo" },
              finish_reason: "stop",
            },
          ],
        },
        config: {},
        provider: "OPENROUTER",
        latencyMs: 900,
      });

      const res = await POST(
        makeReq({
          messages: [{ role: "user", content: "Halo" }],
          stream: true,
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const text = await res.text();
      expect(text).toContain("data: [DONE]");
      expect(text).toContain("Streaming halo");
    });
  });
});

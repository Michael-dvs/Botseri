import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/llm/v1/chat/completions/route";
import { chatCompletion } from "@/lib/llm-gateway";

const {
  prismaMock,
  recordEventMock,
  safeRecordUsageMock,
  authMock,
  decryptSecretMock,
} = vi.hoisted(() => ({
  prismaMock: {
    llmConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
  },
  recordEventMock: vi.fn(),
  safeRecordUsageMock: vi.fn(),
  authMock: vi.fn(),
  decryptSecretMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/events", () => ({
  recordEvent: (...args: unknown[]) => recordEventMock(...args),
}));

vi.mock("@/lib/internal/auth", () => ({
  authorizeInternal: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: (...args: unknown[]) => decryptSecretMock(...args),
}));

vi.mock("@/lib/llm-gateway/usage", () => ({
  safeRecordUsage: (...args: unknown[]) => safeRecordUsageMock(...args),
}));

describe("S11: LLM Gateway Parameter Override, Error Classification & Failover", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    authMock.mockReturnValue(true);
    recordEventMock.mockResolvedValue({});
    safeRecordUsageMock.mockResolvedValue({});
    decryptSecretMock.mockReturnValue("decrypted-api-key-123");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeChatRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/internal/llm/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify(body),
    });
  }

  describe("1. Uji Penimpaan Parameter Otoritatif", () => {
    it("menimpa max_tokens dan temperature dari n8n dengan nilai database aktif", async () => {
      // Database aktif memiliki konfigurasi otoritatif: max_output_tokens: 8192, temperature: 0.7
      prismaMock.llmConfig.findFirst.mockResolvedValueOnce({
        id: "cfg-main",
        provider: "OPENROUTER",
        model: "openai/gpt-4o",
        base_url: "https://openrouter.ai/api/v1",
        api_key_enc: "enc-key",
        temperature: 0.7,
        max_output_tokens: 8192,
        is_active: true,
        is_fallback: false,
      });

      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [{ message: { role: "assistant", content: "Halo dari LLM!" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      // Request dari n8n membawa nilai default statis: max_tokens: 2048, temperature: 0.2
      const res = await POST(
        makeChatRequest({
          messages: [{ role: "user", content: "Halo" }],
          temperature: 0.2,
          max_tokens: 2048,
        })
      );

      expect(res.status).toBe(200);
      expect(capturedBody).not.toBeNull();
      // Parameter wajib ditimpa oleh konfigurasi database
      expect(capturedBody.temperature).toBe(0.7);
      expect(capturedBody.max_tokens).toBe(8192);
    });

    it("memberlakukan batas lantai 4096 untuk model thinking", async () => {
      prismaMock.llmConfig.findFirst.mockResolvedValueOnce({
        id: "cfg-thinking",
        provider: "GEMINI",
        model: "gemini-2.5-flash-thinking",
        base_url: null,
        api_key_enc: "enc-key",
        temperature: 0.3,
        max_output_tokens: 1000, // Di bawah batas lantai model thinking
        is_active: true,
        is_fallback: false,
      });

      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Thinking result" }] }, finishReason: "STOP" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const res = await POST(
        makeChatRequest({
          messages: [{ role: "user", content: "Halo thinking" }],
        })
      );

      expect(res.status).toBe(200);
      expect(capturedBody).not.toBeNull();
      // Model thinking harus dikompensasi minimal 4096 tokens
      expect(capturedBody.generationConfig?.maxOutputTokens).toBe(4096);
    });
  });

  describe("2. Uji Deteksi Output Terpotong (finish_reason: length)", () => {
    it("respons dengan finish_reason length dan teks terputus/kosong menghasilkan error TRUNCATED dan log LLM_TRUNCATED", async () => {
      prismaMock.llmConfig.findFirst.mockResolvedValueOnce({
        id: "cfg-main",
        provider: "OPENROUTER",
        model: "anthropic/claude-3.5-sonnet",
        base_url: "https://openrouter.ai/api/v1",
        api_key_enc: "enc-key",
        temperature: 0.3,
        max_output_tokens: 100,
        is_active: true,
        is_fallback: false,
      });

      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl-truncated",
            choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await POST(
        makeChatRequest({
          messages: [{ role: "user", content: "Tulis cerita panjang" }],
        })
      );

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe("TRUNCATED");
      expect(data.error.message).toContain("terpotong");

      expect(recordEventMock).toHaveBeenCalledWith(
        "WARN",
        "llm-gateway",
        "LLM_TRUNCATED",
        expect.objectContaining({
          model: "anthropic/claude-3.5-sonnet",
        })
      );
    });
  });

  describe("3. Uji Retry dan Failover ke Model Fallback", () => {
    it("saat model utama mengembalikan HTTP 429 berulang, gateway retry 1x lalu failover ke model fallback", async () => {
      // Model utama (OpenRouter free tier yang terkena 429)
      const mainConfig = {
        id: "cfg-main-429",
        provider: "OPENROUTER",
        model: "google/gemini-2.0-flash:free",
        base_url: "https://openrouter.ai/api/v1",
        api_key_enc: "enc-key-1",
        temperature: 0.2,
        max_output_tokens: 2048,
        is_active: true,
        is_fallback: false,
      };

      // Model fallback cadangan (Anthropic atau OpenAI berbayar)
      const fallbackConfig = {
        id: "cfg-fallback",
        provider: "OPENAI_COMPATIBLE",
        model: "openai/gpt-4o-mini",
        base_url: "https://api.openai.com/v1",
        api_key_enc: "enc-key-2",
        temperature: 0.3,
        max_output_tokens: 4096,
        is_active: true,
        is_fallback: true,
      };

      prismaMock.llmConfig.findFirst
        .mockResolvedValueOnce(mainConfig) // Primary call
        .mockResolvedValueOnce(fallbackConfig); // Fallback lookup

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        // Panggilan ke main model menghasilkan 429
        if (url.includes("openrouter.ai")) {
          return new Response(
            JSON.stringify({ error: { message: "Rate limit exceeded" } }),
            { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "1" } }
          );
        }
        // Panggilan ke fallback model berhasil
        return new Response(
          JSON.stringify({
            id: "chatcmpl-fallback-success",
            choices: [{ message: { role: "assistant", content: "Jawaban sukses dari fallback!" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 15, completion_tokens: 8 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const res = await POST(
        makeChatRequest({
          messages: [{ role: "user", content: "Tolong jadwalkan to-do" }],
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices[0].message.content).toBe("Jawaban sukses dari fallback!");

      // Memastikan event LLM_FALLBACK_TRIGGERED tercatat
      expect(recordEventMock).toHaveBeenCalledWith(
        "WARN",
        "llm-gateway",
        "LLM_FALLBACK_TRIGGERED",
        expect.objectContaining({
          primary_model: "google/gemini-2.0-flash:free",
          fallback_model: "openai/gpt-4o-mini",
        })
      );
    });
  });
});

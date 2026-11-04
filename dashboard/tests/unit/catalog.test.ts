import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnthropicCatalog,
  fetchCustomCatalog,
  fetchGeminiCatalog,
  fetchModelCatalog,
  fetchOpenAiCatalog,
  fetchOpenRouterCatalog,
} from "@/lib/llm-gateway/catalog";
import {
  ANTHROPIC_CURATED_MODELS,
  GEMINI_CURATED_MODELS,
  OPENAI_CURATED_MODELS,
} from "@/lib/llm-gateway/pricing-tables";

describe("LLM Model Discovery & Catalog Normalization", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("OpenRouter Adapter", () => {
    it("menormalisasi model OpenRouter dengan harga per 1M token dan kapabilitas yang akurat", async () => {
      const mockOpenRouterResponse = {
        data: [
          {
            id: "openai/gpt-4o-mini",
            name: "OpenAI: GPT-4o mini",
            description: "Fast model with vision",
            context_length: 128000,
            architecture: {
              modality: "text+image->text",
            },
            pricing: {
              prompt: "0.00000015", // $0.15 per 1M token
              completion: "0.0000006", // $0.60 per 1M token
            },
            top_provider: {
              max_completion_tokens: 16384,
            },
            supported_parameters: ["tools", "tool_choice"],
          },
          {
            id: "meta-llama/llama-3.3-70b-instruct:free",
            name: "Llama 3.3 70B (Free)",
            context_length: 131072,
            pricing: {
              prompt: "0",
              completion: "0",
            },
            top_provider: {
              max_completion_tokens: 8192,
            },
            supported_parameters: ["tools"],
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenRouterResponse,
      } as Response);

      const items = await fetchOpenRouterCatalog("test-openrouter-key");

      expect(items).toHaveLength(2);

      // Model 1: gpt-4o-mini
      const m1 = items[0];
      expect(m1.id).toBe("openai/gpt-4o-mini");
      expect(m1.provider).toBe("OPENROUTER");
      expect(m1.context_length).toBe(128000);
      expect(m1.max_output_tokens).toBe(16384);
      expect(m1.pricing.input_per_mtok_usd).toBe(0.15);
      expect(m1.pricing.output_per_mtok_usd).toBe(0.6);
      expect(m1.pricing.is_free).toBe(false);
      expect(m1.capabilities.vision).toBe(true);
      expect(m1.capabilities.function_calling).toBe(true);
      expect(m1.recommended_stt_model).toBe("openai/whisper-1");

      // Model 2: Free model
      const m2 = items[1];
      expect(m2.id).toBe("meta-llama/llama-3.3-70b-instruct:free");
      expect(m2.pricing.is_free).toBe(true);
      expect(m2.pricing.input_per_mtok_usd).toBe(0);
      expect(m2.pricing.output_per_mtok_usd).toBe(0);
    });

    it("menangani error status response dari OpenRouter", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid API Key",
      } as Response);

      await expect(fetchOpenRouterCatalog("bad-key")).rejects.toThrow(
        /OpenRouter API mengembalikan status 401/,
      );
    });
  });

  describe("OpenAI Adapter", () => {
    it("memfilter hanya model chat dan menggabungkan metadata kurasi", async () => {
      const mockOpenAiResponse = {
        data: [
          { id: "gpt-4o-mini", object: "model" },
          { id: "text-embedding-3-small", object: "model" }, // harus di-filter keluar
          { id: "dall-e-3", object: "model" }, // harus di-filter keluar
          { id: "o1-mini", object: "model" },
          { id: "gpt-4o-custom-new", object: "model" }, // model heuristik
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenAiResponse,
      } as Response);

      const items = await fetchOpenAiCatalog("sk-test");

      // Harus menyaring model non-chat
      const ids = items.map((i) => i.id);
      expect(ids).toContain("gpt-4o-mini");
      expect(ids).toContain("o1-mini");
      expect(ids).toContain("gpt-4o-custom-new");
      expect(ids).not.toContain("text-embedding-3-small");
      expect(ids).not.toContain("dall-e-3");

      // Verifikasi metadata kurasi untuk gpt-4o-mini
      const mini = items.find((i) => i.id === "gpt-4o-mini");
      expect(mini?.pricing.input_per_mtok_usd).toBe(0.15);
      expect(mini?.pricing.output_per_mtok_usd).toBe(0.6);
      expect(mini?.context_length).toBe(128000);
      expect(mini?.capabilities.vision).toBe(true);
      expect(mini?.capabilities.function_calling).toBe(true);

      // Verifikasi model reasoning o1-mini
      const o1 = items.find((i) => i.id === "o1-mini");
      expect(o1?.capabilities.reasoning).toBe(true);
      expect(o1?.max_output_tokens).toBe(65536);
    });
  });

  describe("Gemini Adapter", () => {
    it("mengekstrak model Gemini, membersihkan prefix, dan membaca batas token", async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/text-embedding-004",
            displayName: "Embedding Model",
            supportedGenerationMethods: ["embedContent"], // harus di-filter keluar
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGeminiResponse,
      } as Response);

      const items = await fetchGeminiCatalog("test-gemini-key");

      expect(items).toHaveLength(1);
      const flash = items[0];
      expect(flash.id).toBe("gemini-2.5-flash"); // tanpa prefix "models/"
      expect(flash.provider).toBe("GEMINI");
      expect(flash.context_length).toBe(1048576);
      expect(flash.max_output_tokens).toBe(8192);
      expect(flash.capabilities.audio_stt).toBe(true);
      expect(flash.capabilities.vision).toBe(true);
      expect(flash.capabilities.function_calling).toBe(true);
      expect(flash.recommended_stt_model).toBe("gemini-2.5-flash");
    });
  });

  describe("Anthropic Adapter", () => {
    it("fallback ke katalog terkurasi jika request API gagal atau tanpa key", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failed"));

      const items = await fetchAnthropicCatalog("some-key");

      expect(items.length).toBeGreaterThanOrEqual(4);
      const sonnet = items.find((i) => i.id === "claude-3-5-sonnet-latest");
      expect(sonnet).toBeDefined();
      expect(sonnet?.pricing.input_per_mtok_usd).toBe(3.0);
      expect(sonnet?.pricing.output_per_mtok_usd).toBe(15.0);
      expect(sonnet?.context_length).toBe(200000);
      expect(sonnet?.capabilities.vision).toBe(true);
    });

    it("memetakan daftar model dari API resmi saat tersedia", async () => {
      const mockAnthropicResponse = {
        data: [
          {
            id: "claude-3-5-sonnet-latest",
            display_name: "Claude 3.5 Sonnet",
            type: "model",
          },
          {
            id: "claude-3-5-haiku-latest",
            display_name: "Claude 3.5 Haiku",
            type: "model",
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAnthropicResponse,
      } as Response);

      const items = await fetchAnthropicCatalog("valid-anthropic-key");
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("claude-3-5-sonnet-latest");
      expect(items[1].id).toBe("claude-3-5-haiku-latest");
      expect(items[1].pricing.input_per_mtok_usd).toBe(0.8);
      expect(items[1].pricing.output_per_mtok_usd).toBe(4.0);
    });
  });

  describe("Custom OpenAI Compatible Adapter", () => {
    it("menormalisasi model dari endpoint lokal (Ollama / vLLM)", async () => {
      const mockCustomResponse = {
        data: [
          { id: "llama3.2:latest" },
          { id: "qwen2.5-coder:7b" },
          { id: "deepseek-r1:14b" },
          { id: "llava:13b" },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockCustomResponse,
      } as Response);

      const items = await fetchCustomCatalog("http://localhost:11434/v1");

      expect(items).toHaveLength(4);

      // Model reasoning r1
      const r1 = items.find((i) => i.id === "deepseek-r1:14b");
      expect(r1?.capabilities.reasoning).toBe(true);
      expect(r1?.pricing.is_free).toBe(true);

      // Model vision llava
      const llava = items.find((i) => i.id === "llava:13b");
      expect(llava?.capabilities.vision).toBe(true);

      // Default pricing & context length
      expect(items[0].pricing.is_free).toBe(true);
      expect(items[0].context_length).toBe(8192);
      expect(items[0].max_output_tokens).toBe(2048);
    });
  });

  describe("Master fetchModelCatalog Dispatcher", () => {
    it("mengembalikan katalog kurasi untuk OpenAI dan Gemini bila belum ada API key", async () => {
      const openAiCurated = await fetchModelCatalog({ provider: "OPENAI" });
      expect(openAiCurated.length).toBe(Object.keys(OPENAI_CURATED_MODELS).length);
      expect(openAiCurated[0].provider).toBe("OPENAI");

      const geminiCurated = await fetchModelCatalog({ provider: "GEMINI" });
      expect(geminiCurated.length).toBe(Object.keys(GEMINI_CURATED_MODELS).length);
      expect(geminiCurated[0].provider).toBe("GEMINI");
    });

    it("melempar error jika provider kustom tidak menyertakan base_url", async () => {
      await expect(
        fetchModelCatalog({ provider: "CUSTOM_OPENAI_COMPAT" }),
      ).rejects.toThrow(/Base URL wajib diisi/);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callGemini,
  cleanGeminiSchema,
  geminiToOpenAi,
  toGeminiPayload,
} from "@/lib/llm-gateway/gemini";
import type { ChatConfig, ChatPayload } from "@/lib/llm-gateway/openai-compatible";

describe("Gemini Adapter (toGeminiPayload & geminiToOpenAi)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockConfig: ChatConfig = {
    provider: "GEMINI",
    model: "gemini-2.5-flash",
    base_url: null,
    temperature: 0.2,
    max_output_tokens: 2048,
  };

  describe("cleanGeminiSchema Sanitizer", () => {
    it("menghapus field yang dilarang dari skema tingkat atas", () => {
      const raw = {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "TestSchema",
        $id: "http://example.com",
        $comment: "test",
        additionalProperties: false,
        definitions: { Sub: {} },
        $defs: { Sub2: {} },
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const cleaned = cleanGeminiSchema(raw);
      expect(cleaned.$schema).toBeUndefined();
      expect(cleaned.title).toBeUndefined();
      expect(cleaned.$id).toBeUndefined();
      expect(cleaned.$comment).toBeUndefined();
      expect(cleaned.additionalProperties).toBeUndefined();
      expect(cleaned.definitions).toBeUndefined();
      expect(cleaned.$defs).toBeUndefined();
      expect(cleaned.type).toBe("object");
      expect(cleaned.properties).toEqual({
        name: { type: "string" },
      });
    });

    it("menambahkan default type: object bila tidak ada di input", () => {
      const cleaned = cleanGeminiSchema({ properties: { a: { type: "string" } } });
      expect(cleaned.type).toBe("object");
    });
  });

  describe("toGeminiPayload Translation", () => {
    it("mengekstrak role system ke dalam systemInstruction dan memisahkan contents", () => {
      const payload: ChatPayload = {
        messages: [
          { role: "system", content: "Kamu adalah asisten Botseri." },
          { role: "user", content: "Halo bot" },
        ],
      };

      const geminiBody = toGeminiPayload(payload, mockConfig);

      expect(geminiBody.systemInstruction).toBeDefined();
      expect(geminiBody.systemInstruction?.parts[0]?.text).toBe(
        "Kamu adalah asisten Botseri.",
      );

      expect(geminiBody.contents).toHaveLength(1);
      expect(geminiBody.contents[0].role).toBe("user");
      expect(geminiBody.contents[0].parts[0]).toEqual({ text: "Halo bot" });
    });

    it("mengonversi skema tools OpenAI ke functionDeclarations Gemini", () => {
      const payload: ChatPayload = {
        messages: [{ role: "user", content: "Catat tugas jemur baju" }],
        tools: [
          {
            type: "function",
            function: {
              name: "tool_create_todo_and_order",
              description: "Menyimpan to-do operasional",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  due_at: { type: "string" },
                },
                required: ["title"],
              },
            },
          },
        ],
      };

      const geminiBody = toGeminiPayload(payload, mockConfig);

      expect(geminiBody.tools).toBeDefined();
      expect(geminiBody.tools).toHaveLength(1);
      const decls = geminiBody.tools?.[0].functionDeclarations;
      expect(decls).toHaveLength(1);
      expect(decls?.[0].name).toBe("tool_create_todo_and_order");
      expect(decls?.[0].description).toBe("Menyimpan to-do operasional");
      expect(decls?.[0].parameters).toEqual({
        type: "object",
        properties: {
          title: { type: "string" },
          due_at: { type: "string" },
        },
        required: ["title"],
      });
    });

    it("membersihkan field terlarang seperti $schema, title, dan additionalProperties dari skema tools", () => {
      const payload: ChatPayload = {
        messages: [{ role: "user", content: "Catat tugas" }],
        tools: [
          {
            type: "function",
            function: {
              name: "tool_create_todo_and_order",
              description: "Simpan to-do",
              parameters: {
                $schema: "http://json-schema.org/draft-07/schema#",
                title: "ToolCreateTodoInput",
                type: "object",
                additionalProperties: false,
                $id: "https://example.com/schema.json",
                $comment: "Internal comment",
                properties: {
                  title: {
                    type: "string",
                    title: "Judul Tugas",
                    description: "Judul to-do",
                  },
                  tags: {
                    type: "array",
                    title: "Daftar Label",
                    items: {
                      type: "string",
                      title: "Nama Label",
                    },
                  },
                },
                required: ["title"],
              },
            },
          },
        ],
      };

      const geminiBody = toGeminiPayload(payload, mockConfig);
      const params = geminiBody.tools?.[0]?.functionDeclarations?.[0]?.parameters;
      expect(params).toBeDefined();

      // Root schema harus bebas dari field terlarang
      expect(params?.$schema).toBeUndefined();
      expect(params?.title).toBeUndefined();
      expect(params?.additionalProperties).toBeUndefined();
      expect(params?.$id).toBeUndefined();
      expect(params?.$comment).toBeUndefined();

      // Type dan properties harus tetap ada
      expect(params?.type).toBe("object");
      expect(params?.required).toEqual(["title"]);

      // Nested properties harus dibersihkan
      const props = params?.properties as Record<string, Record<string, unknown>>;
      expect(props.title.type).toBe("string");
      expect(props.title.title).toBeUndefined();
      expect(props.title.description).toBe("Judul to-do");

      // Nested array items harus dibersihkan
      const tagsItems = props.tags.items as Record<string, unknown>;
      expect(tagsItems.type).toBe("string");
      expect(tagsItems.title).toBeUndefined();
    });

    it("mengabaikan properti tools jika payload tidak memuat tools", () => {
      const payload: ChatPayload = {
        messages: [{ role: "user", content: "Hai" }],
      };

      const geminiBody = toGeminiPayload(payload, mockConfig);
      expect(geminiBody.tools).toBeUndefined();
    });

    it("menerjemahkan riwayat assistant tool_calls dan tool response ke format Gemini", () => {
      const payload: ChatPayload = {
        messages: [
          { role: "user", content: "Tolong catat jemur baju" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: {
                  name: "tool_create_todo_and_order",
                  arguments: JSON.stringify({ title: "Jemur baju" }),
                },
              },
            ],
          },
          {
            role: "tool",
            name: "tool_create_todo_and_order",
            tool_call_id: "call_abc123",
            content: JSON.stringify({ ok: true, id: "todo-123" }),
          },
        ],
      };

      const geminiBody = toGeminiPayload(payload, mockConfig);

      expect(geminiBody.contents).toHaveLength(3);

      // Model functionCall
      expect(geminiBody.contents[1].role).toBe("model");
      expect(geminiBody.contents[1].parts[0]).toEqual({
        functionCall: {
          name: "tool_create_todo_and_order",
          args: { title: "Jemur baju" },
        },
      });

      // User functionResponse
      expect(geminiBody.contents[2].role).toBe("user");
      expect(geminiBody.contents[2].parts[0]).toEqual({
        functionResponse: {
          name: "tool_create_todo_and_order",
          response: { ok: true, id: "todo-123" },
        },
      });
    });
  });

  describe("geminiToOpenAi Normalization", () => {
    it("mengonversi balasan teks biasa Gemini ke format OpenAI choices", () => {
      const geminiRaw = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Halo! Ada yang bisa saya bantu hari ini?" }],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 15,
          totalTokenCount: 65,
        },
      };

      const openAiSpec = geminiToOpenAi(geminiRaw);

      expect(openAiSpec.choices).toHaveLength(1);
      const choice = (openAiSpec.choices as Array<Record<string, unknown>>)[0];
      expect(choice.finish_reason).toBe("stop");
      const msg = choice.message as Record<string, unknown>;
      expect(msg.role).toBe("assistant");
      expect(msg.content).toBe("Halo! Ada yang bisa saya bantu hari ini?");
      expect(msg.tool_calls).toBeUndefined();

      expect(openAiSpec.usage).toEqual({
        prompt_tokens: 50,
        completion_tokens: 15,
        total_tokens: 65,
      });
    });

    it("mengonversi balasan functionCall Gemini ke tool_calls OpenAI", () => {
      const geminiRaw = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "tool_create_todo_and_order",
                    args: {
                      title: "Ngejemur baju",
                      due_at: "2026-10-28T08:00:00+07:00",
                    },
                  },
                },
              ],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 40,
          totalTokenCount: 160,
        },
      };

      const openAiSpec = geminiToOpenAi(geminiRaw);

      expect(openAiSpec.choices).toHaveLength(1);
      const choice = (openAiSpec.choices as Array<Record<string, unknown>>)[0];
      expect(choice.finish_reason).toBe("tool_calls");
      const msg = choice.message as Record<string, unknown>;
      expect(msg.role).toBe("assistant");
      expect(msg.content).toBeNull();
      expect(msg.tool_calls).toBeDefined();

      const toolCalls = msg.tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].type).toBe("function");
      const fn = toolCalls[0].function as Record<string, unknown>;
      expect(fn.name).toBe("tool_create_todo_and_order");
      expect(JSON.parse(fn.arguments as string)).toEqual({
        title: "Ngejemur baju",
        due_at: "2026-10-28T08:00:00+07:00",
      });
    });

    it("memetakan finishReason MAX_TOKENS ke length", () => {
      const geminiRaw = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Teks terpotong..." }],
            },
            finishReason: "MAX_TOKENS",
            index: 0,
          },
        ],
      };

      const openAiSpec = geminiToOpenAi(geminiRaw);
      const choice = (openAiSpec.choices as Array<Record<string, unknown>>)[0];
      expect(choice.finish_reason).toBe("length");
    });
  });

  describe("callGemini Network Call", () => {
    it("memanggil endpoint generateContent dengan parameter model dan api key yang benar", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Siap!" }] },
              finishReason: "STOP",
            },
          ],
        }),
      } as Response);

      const response = await callGemini(
        { ...mockConfig, model: "models/gemini-2.5-flash" },
        "AIzaSyDummyKey123",
        {
          messages: [{ role: "user", content: "Hai" }],
        },
      );

      expect(response.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-goog-api-key": "AIzaSyDummyKey123",
          }),
        }),
      );
      const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
      expect(calledUrl).not.toContain("?key=");
    });
  });
});

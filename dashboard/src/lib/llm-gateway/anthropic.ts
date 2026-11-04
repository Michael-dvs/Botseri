import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ChatConfig, ChatPayload } from "./openai-compatible";

type AnthropicBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicBlock[] | string };

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.unknown().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        function: z.object({
          name: z.string(),
          arguments: z.string().optional(),
        }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

const toolSchema = z.object({
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.unknown().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.string(),
  z.object({ function: z.object({ name: z.string() }) }),
]);

const contentBlockSchema = z.object({ text: z.string() }).passthrough();

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  const parsed = z.array(contentBlockSchema).safeParse(content);
  if (!parsed.success) return "";
  return parsed.data.map((item) => item.text).join("\n");
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function convertTools(raw: unknown): unknown[] | undefined {
  const parsed = z.array(toolSchema).safeParse(raw);
  if (!parsed.success) return undefined;
  const tools = parsed.data.map((item) => {
    const parameters = z
      .record(z.string(), z.unknown())
      .safeParse(item.function.parameters);
    return {
      name: item.function.name,
      description: item.function.description,
      input_schema: parameters.success
        ? parameters.data
        : { type: "object", properties: {} },
    };
  });
  return tools.length > 0 ? tools : undefined;
}

function convertToolChoice(raw: unknown): unknown {
  const parsed = toolChoiceSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  if (parsed.data === "auto") return { type: "auto" };
  if (parsed.data === "required") return { type: "any" };
  if (typeof parsed.data === "object") {
    return { type: "tool", name: parsed.data.function.name };
  }
  return undefined;
}

function toAnthropic(payload: ChatPayload) {
  const parsedMessages = z.array(messageSchema).safeParse(payload.messages);
  if (!parsedMessages.success) throw new Error("messages tidak valid");
  const system: string[] = [];
  const messages: AnthropicMessage[] = [];

  for (const raw of parsedMessages.data) {
    if (raw.role === "system") {
      const text = textFromContent(raw.content);
      if (text) system.push(text);
      continue;
    }
    if (raw.role === "tool") {
      if (!raw.tool_call_id) continue;
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: raw.tool_call_id,
            content: textFromContent(raw.content),
          },
        ],
      });
      continue;
    }
    if (raw.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      const text = textFromContent(raw.content);
      if (text) blocks.push({ type: "text", text });
      for (const call of raw.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
        });
      }
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      continue;
    }
    messages.push({ role: "user", content: textFromContent(raw.content) });
  }

  return {
    system: system.length > 0 ? system.join("\n\n") : undefined,
    messages,
    tools: convertTools(payload.tools),
    tool_choice: convertToolChoice(payload.tool_choice),
  };
}

export async function callAnthropic(
  config: ChatConfig,
  apiKey: string,
  payload: ChatPayload,
  signal?: AbortSignal,
): Promise<Response> {
  const converted = toAnthropic(payload);
  const body = {
    model: config.model,
    max_tokens: payload.max_tokens ?? Math.max(1, config.max_output_tokens),
    temperature: payload.temperature ?? config.temperature,
    ...converted,
  };

  for (let attempt = 0; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(25_000);
    const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt > 0) return response;
    await response.body?.cancel();
    await delay(500);
  }
}

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("tool_use"),
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
      }),
    ]),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

export function anthropicToOpenAi(raw: unknown) {
  const body = responseSchema.parse(raw);
  const text = body.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const toolCalls = body.content
    .filter((block) => block.type === "tool_use")
    .map((block, index) => ({
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
      index,
    }));

  return {
    id: body.id ?? `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: body.usage?.input_tokens ?? 0,
      completion_tokens: body.usage?.output_tokens ?? 0,
      total_tokens:
        (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0),
    },
  };
}

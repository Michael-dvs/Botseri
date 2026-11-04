import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternal } from "@/lib/internal/auth";
import {
  NoActiveLlmError,
  ProviderError,
  OutputTruncatedError,
  chatCompletion,
  getActiveConfig,
} from "@/lib/llm-gateway";
import { safeRecordUsage } from "@/lib/llm-gateway/usage";
import { log } from "@/lib/logger";

const schema = z
  .object({
    messages: z.array(z.unknown()).min(1),
    tools: z.unknown().optional(),
    tool_choice: z.unknown().optional(),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
  })
  .passthrough();

const usageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
  })
  .passthrough();

function usageFromBody(body: unknown) {
  const parsed = z
    .object({ usage: usageSchema.optional() })
    .passthrough()
    .safeParse(body);
  return parsed.success ? parsed.data.usage : undefined;
}

function headerValue(request: Request, name: string, fallback: string, max: number) {
  const value = request.headers.get(name)?.trim();
  return value ? value.slice(0, max) : fallback;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorizeInternal(request)) {
    return NextResponse.json(
      {
        error: {
          message: "Unauthorized",
          type: "invalid_request_error",
          code: "unauthorized",
        },
      },
      { status: 401 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          message: "Payload tidak valid",
          type: "invalid_request_error",
          code: "invalid_payload",
        },
      },
      { status: 400 },
    );
  }
  const callType = headerValue(request, "x-botseri-call-type", "chat", 50);
  const executionId = request.headers
    .get("x-botseri-execution-id")
    ?.trim()
    .slice(0, 100) ?? null;

  try {
    const activeConfig = await getActiveConfig();
    const effectiveTemperature = activeConfig.temperature ?? 0.3;
    let effectiveMaxTokens = activeConfig.max_output_tokens ?? 1000;

    const isThinkingModel =
      activeConfig.provider === "GEMINI" &&
      (activeConfig.model.includes("2.5") || activeConfig.model.toLowerCase().includes("thinking"));

    if (isThinkingModel && effectiveMaxTokens < 4096) {
      effectiveMaxTokens = 4096;
    }

    const result = await chatCompletion(
      {
        messages: parsed.data.messages,
        tools: parsed.data.tools,
        tool_choice: parsed.data.tool_choice,
        temperature: effectiveTemperature,
        max_tokens: effectiveMaxTokens,
        frequency_penalty: parsed.data.frequency_penalty,
        presence_penalty: parsed.data.presence_penalty,
      },
      request.signal,
      activeConfig,
    );
    await safeRecordUsage({
      config: result.config,
      callType,
      usage: usageFromBody(result.body),
      latencyMs: result.latencyMs,
      executionId,
      success: true,
    });
    if (parsed.data.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const body = result.body as Record<string, unknown>;
          const chunkId = (body.id as string) || `chatcmpl-${Date.now()}`;
          const model = (body.model as string) || "botseri-default";
          const choices = (body.choices as Array<Record<string, unknown>>) || [];
          const choice = choices[0];
          const message = (choice?.message as Record<string, unknown>) || {};
          const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;

          if (toolCalls && toolCalls.length > 0) {
            const toolCallChunk = {
              id: chunkId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: toolCalls.map((tc, idx) => ({
                      index: idx,
                      id: tc.id,
                      type: tc.type,
                      function: tc.function,
                    })),
                  },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolCallChunk)}\n\n`));
          } else if (message.content) {
            const contentChunk = {
              id: chunkId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: message.content,
                  },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
          }

          const doneChunk = {
            id: chunkId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: choice?.finish_reason || "stop",
              },
            ],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    return NextResponse.json(result.body);
  } catch (error) {
    if (error instanceof OutputTruncatedError) {
      return NextResponse.json(
        {
          error: {
            message: error.message,
            type: "invalid_request_error",
            code: "TRUNCATED",
            model: error.model,
          },
        },
        { status: error.status },
      );
    }
    if (error instanceof NoActiveLlmError) {
      return NextResponse.json(
        {
          error: {
            message: "No active LLM configuration available",
            type: "server_error",
            code: "no_active_llm_config",
          },
        },
        { status: 503 },
      );
    }
    if (error instanceof ProviderError) {
      log("ERROR", "llm-gateway", `Upstream provider error (${error.provider}): ${error.message}`, {
        status: error.status,
        model: error.config?.model,
      });
      await safeRecordUsage({
        config: error.config,
        callType,
        latencyMs: error.latencyMs,
        executionId,
        success: false,
        error: error.message,
      });
      const isTimeout = error.status === 504;
      return NextResponse.json(
        {
          error: {
            message: error.message,
            type: isTimeout ? "timeout_error" : "upstream_error",
            code: isTimeout ? "upstream_timeout" : (error.kind ?? "upstream_error"),
            provider: error.provider,
            model: error.config?.model,
          },
        },
        { status: error.status },
      );
    }
    log("ERROR", "llm-gateway", "chat completion failed", undefined, error);
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM",
          message: "Gateway gagal memproses permintaan",
          provider: "GATEWAY",
          model: "unknown",
        },
      },
      { status: 502 },
    );
  }
}

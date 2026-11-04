import { setTimeout as delay } from "node:timers/promises";
import type { LlmConfig } from "@prisma/client";

export type ChatConfig = Pick<
  LlmConfig,
  "provider" | "model" | "base_url" | "temperature" | "max_output_tokens"
>;

const DEFAULT_BASE_URLS: Record<string, string> = {
  OPENAI: "https://api.openai.com/v1",
  OPENROUTER: "https://openrouter.ai/api/v1",
  GEMINI: "https://generativelanguage.googleapis.com/v1beta/openai",
};

export function openAiBaseUrl(config: ChatConfig): string {
  const base = config.base_url ?? DEFAULT_BASE_URLS[config.provider];
  if (!base) {
    throw new Error(`base_url belum diatur untuk provider ${config.provider}`);
  }
  return base.replace(/\/+$/, "");
}

export type ChatPayload = {
  messages: unknown[];
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
};
export async function callOpenAiCompatible(
  config: ChatConfig,
  apiKey: string,
  payload: ChatPayload,
  signal?: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: payload.messages,
    temperature: payload.temperature ?? config.temperature ?? 0.2,
    max_tokens: payload.max_tokens ?? config.max_output_tokens ?? 600,
  };
  if (payload.frequency_penalty !== undefined) {
    body.frequency_penalty = payload.frequency_penalty;
  }
  if (payload.presence_penalty !== undefined) {
    body.presence_penalty = payload.presence_penalty;
  }
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    body.tools = payload.tools;
    if (payload.tool_choice !== undefined) body.tool_choice = payload.tool_choice;
  }

  for (let attempt = 0; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(25_000);
    const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(`${openAiBaseUrl(config)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
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
